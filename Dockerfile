FROM n8nio/n8n:latest

USER root

# Install required packages
RUN echo "Installing required packages..." && \
    apk add --no-cache \
    curl \
    gettext \
    coreutils \
    openssl \
    ca-certificates \
    musl-dev \
    jq \
    bash \
    netcat-openbsd

# Switch to n8n's installation directory
WORKDIR /usr/local/lib/node_modules/n8n

# Install Node.js OpenTelemetry dependencies
RUN npm install \
    @opentelemetry/api@1.4.1 \
    @opentelemetry/sdk-node@0.39.1 \
    @opentelemetry/auto-instrumentations-node@0.37.0 \
    @opentelemetry/context-async-hooks@1.13.0 \
    @opentelemetry/resources@1.13.0 \
    @opentelemetry/semantic-conventions@1.13.0 \
    @opentelemetry/instrumentation@0.37.0 \
    @opentelemetry/instrumentation-http@0.37.0 \
    @opentelemetry/core@1.13.0 \
    @opentelemetry/sdk-trace-base@1.13.0 \
    winston@3.10.0 \
    flat@5.0.2

# Copy instrumentation files to n8n directory
COPY tracing.js n8n-otel-instrumentation.js langwatch-exporter.js debug-exporter.js otel-debug-endpoint.js ./
RUN chmod 644 ./*.js && \
    chown node:node ./*.js

# Copy entrypoint script
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh && \
    chown node:node /docker-entrypoint.sh

# Create health check script
RUN echo '#!/bin/sh\ncurl -f http://localhost:5678/healthz > /dev/null 2>&1 || exit 1' > /health-check.sh && \
    chmod +x /health-check.sh

# Install sqlite for database management
RUN apk add --no-cache sqlite

# Create disk cleanup script
RUN echo '#!/bin/bash\n\
echo "Running disk cleanup..."\n\
# Check disk usage\n\
DISK_USAGE=$(df -h /home/node/.n8n | awk "NR==2 {print \$5}" | sed "s/%//")\n\
echo "Current disk usage: ${DISK_USAGE}%"\n\
\n\
# If disk usage is over 80%, clean up old executions\n\
if [ "${DISK_USAGE}" -gt 80 ]; then\n\
  echo "Disk usage is high, cleaning up old executions..."\n\
  # Find and remove old execution files\n\
  find /home/node/.n8n -name "*.json" -type f -mtime +7 -delete\n\
  # Vacuum SQLite database if it exists\n\
  if [ -f /home/node/.n8n/database.sqlite ]; then\n\
    echo "Vacuuming SQLite database..."\n\
    sqlite3 /home/node/.n8n/database.sqlite "VACUUM;"\n\
  fi\n\
  echo "Cleanup completed."\n\
fi' > /usr/local/bin/disk-cleanup.sh && \
    chmod +x /usr/local/bin/disk-cleanup.sh && \
    ln -sf /usr/local/bin/disk-cleanup.sh /disk-cleanup.sh

# Add cron job to run disk cleanup daily
RUN mkdir -p /etc/crontabs && \
    echo "0 0 * * * /usr/local/bin/disk-cleanup.sh >> /home/node/.n8n/disk-cleanup.log 2>&1" > /etc/crontabs/node

# Add crond startup to the entrypoint
RUN echo '#!/bin/sh\n\
# Start crond in background\n\
crond -b -L /home/node/.n8n/cron.log\n\
\n\
# Execute the original entrypoint\n\
exec "$@"' > /usr/local/bin/with-cron.sh && \
    chmod +x /usr/local/bin/with-cron.sh && \
    cp /usr/local/bin/with-cron.sh /with-cron.sh && \
    chmod +x /with-cron.sh

# Add host.docker.internal hostname resolution for Linux hosts
# This is needed for the debug endpoint to work properly
RUN echo "#!/bin/sh\n\
# Add host.docker.internal to /etc/hosts if running on Linux\n\
if [ ! -z \"\$(grep -E '^[0-9]+\\.[0-9]+\\.[0-9]+\\.[0-9]+ host\\.docker\\.internal$' /etc/hosts)\" ]; then\n\
  echo 'host.docker.internal entry already exists in /etc/hosts'\n\
else\n\
  echo 'Adding host.docker.internal entry to /etc/hosts'\n\
  HOST_IP=\$(ip route | grep default | awk '{print \$3}')\n\
  if [ -z \"\$HOST_IP\" ]; then\n\
    echo 'Could not determine host IP, using fallback 172.17.0.1'\n\
    HOST_IP='172.17.0.1'\n\
  fi\n\
  echo \"\$HOST_IP host.docker.internal\" >> /etc/hosts\n\
fi\n\
" > /usr/local/bin/add-host-docker-internal.sh && \
    chmod +x /usr/local/bin/add-host-docker-internal.sh

# Ensure proper permissions
RUN mkdir -p /home/node/.n8n && \
    chown -R node:node /home/node/.n8n

# Switch back to node user
USER node

# Set up health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 CMD [ "/health-check.sh" ]

# Define environment variables with defaults
ENV LANGWATCH_ENDPOINT=https://app.langwatch.ai \
    LANGWATCH_LOG_LEVEL=info \
    OTEL_SERVICE_NAME=n8n \
    OTEL_LOG_LEVEL=info \
    USE_DEBUG_EXPORTER=false \
    DEBUG_ENDPOINT=http://localhost:3000/debug-otel \
    DEBUG_SEND_TO_LANGWATCH=true \
    DEBUG_EXPORTER_LOG_LEVEL=info

# Set the entrypoint
ENTRYPOINT ["tini", "--", "/docker-entrypoint.sh"]
