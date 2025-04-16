FROM n8nio/n8n:latest

USER root

# Install required packages
RUN echo "Installing required packages..." && \
    apk add --no-cache \
    curl \
    gettext \
    openssl \
    ca-certificates \
    musl-dev

# Switch to n8n's installation directory
WORKDIR /usr/local/lib/node_modules/n8n

# Install more complete dependencies for instrumentation
RUN npm install \
    @opentelemetry/api@1.4.1 \
    @opentelemetry/context-async-hooks@1.13.0 \
    @opentelemetry/auto-instrumentations-node@0.37.0 \
    @opentelemetry/instrumentation@0.37.0 \
    @opentelemetry/instrumentation-http@0.37.0 \
    @opentelemetry/sdk-node@0.37.0 \
    @opentelemetry/resources@1.13.0 \
    @opentelemetry/semantic-conventions@1.13.0 \
    winston@3.10.0 \
    flat@5.0.2

# Create subdirectories
RUN mkdir -p ./instrumentation ./utils

# Copy instrumentation files from instrumentation directory
COPY instrumentation/* ./instrumentation/

# Copy utility files
COPY utils/* ./utils/

# Copy core files
COPY index.js ./
COPY logger.js ./
COPY trace-manager.js ./
COPY langwatch-client.js ./

# Copy the n8n-langwatch-instrumentation.js file to the root directory for tracing.js to find
COPY instrumentation/n8n-langwatch-instrumentation.js ./

# Copy tracing.js file
COPY tracing.js ./

# Copy entrypoint script
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh && \
    chown -R node:node /usr/local/lib/node_modules/n8n /docker-entrypoint.sh

USER node

ENTRYPOINT ["tini", "--", "/docker-entrypoint.sh"]