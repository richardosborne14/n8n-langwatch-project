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
    musl-dev

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
COPY tracing.js n8n-otel-instrumentation.js langwatch-exporter.js ./
RUN chmod 644 ./*.js && \
    chown node:node ./*.js

# Copy entrypoint script
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh && \
    chown node:node /docker-entrypoint.sh

# Create health check script
RUN echo '#!/bin/sh\ncurl -f http://localhost:5678/healthz > /dev/null 2>&1 || exit 1' > /health-check.sh && \
    chmod +x /health-check.sh

# Switch back to node user
USER node

# Set up health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 CMD [ "/health-check.sh" ]

# Define environment variables with defaults
ENV LANGWATCH_ENDPOINT=https://app.langwatch.ai \
    LANGWATCH_LOG_LEVEL=info \
    OTEL_SERVICE_NAME=n8n \
    OTEL_LOG_LEVEL=info

# Set the entrypoint
ENTRYPOINT ["tini", "--", "/docker-entrypoint.sh"]