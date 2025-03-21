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

# Install dependencies
RUN npm install winston flat

# Copy instrumentation files
COPY index.js ./
COPY logger.js ./
COPY trace-manager.js ./
COPY langwatch-client.js ./

# Create subdirectories
RUN mkdir -p ./instrumentation ./utils

# Copy instrumentation files
COPY instrumentation/index.js ./instrumentation/
COPY instrumentation/node-instrumentation.js ./instrumentation/
COPY instrumentation/workflow-instrumentation.js ./instrumentation/

# Copy utility files
COPY utils/helpers.js ./utils/
COPY utils/model-detection.js ./utils/

# Copy entrypoint script
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh && \
    chown -R node:node /usr/local/lib/node_modules/n8n /docker-entrypoint.sh

USER node

ENTRYPOINT ["tini", "--", "/docker-entrypoint.sh"]