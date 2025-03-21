#!/bin/sh
# docker-entrypoint.sh

echo "n8n with LangWatch API integration"

# Set LangWatch configuration
export LANGWATCH_API_KEY="${LANGWATCH_API_KEY}"
export LANGWATCH_ENDPOINT="${LANGWATCH_ENDPOINT:-https://app.langwatch.ai}"
export LANGWATCH_LOG_LEVEL="${LANGWATCH_LOG_LEVEL:-info}"

# Print debug info (without exposing API key)
echo "LANGWATCH_ENDPOINT: ${LANGWATCH_ENDPOINT}"
echo "LANGWATCH_API_KEY is ${LANGWATCH_API_KEY:+set}"
echo "LANGWATCH_LOG_LEVEL: ${LANGWATCH_LOG_LEVEL}"

# Start n8n with LangWatch instrumentation
echo "Starting n8n with LangWatch integration..."
exec node --require /usr/local/lib/node_modules/n8n/index.js /usr/local/bin/n8n "$@"