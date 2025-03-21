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

# Install dependencies (much simpler now)
WORKDIR /usr/local/lib/node_modules/n8n
RUN npm install winston

# Copy instrumentation file
COPY n8n-langwatch-direct.js ./
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh && \
    chown node:node ./n8n-langwatch-direct.js /docker-entrypoint.sh

USER node

ENTRYPOINT ["tini", "--", "/docker-entrypoint.sh"]