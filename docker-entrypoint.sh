#!/bin/sh
# Enhanced docker-entrypoint.sh for n8n LangWatch integration

echo "n8n with LangWatch API integration - Enhanced Debugging"

# Set LangWatch configuration
export LANGWATCH_API_KEY="${LANGWATCH_API_KEY}"
export LANGWATCH_ENDPOINT="${LANGWATCH_ENDPOINT:-https://app.langwatch.ai}"
export LANGWATCH_LOG_LEVEL="debug"

# Set n8n logging to maximum detail
export N8N_LOG_LEVEL="debug"

# Enable Node.js debugging
export NODE_DEBUG="http,fs,module,net"

# Enable direct logging for OpenAI API calls
export OPENAI_DEBUG="true"
export DEBUG="langchain:*,n8n:*,openai:*"

# Print active configuration
echo "===== n8n LangWatch Integration Configuration ====="
echo "LANGWATCH_ENDPOINT: ${LANGWATCH_ENDPOINT}"
echo "LANGWATCH_API_KEY is ${LANGWATCH_API_KEY:+set}"
echo "LANGWATCH_LOG_LEVEL: ${LANGWATCH_LOG_LEVEL}"
echo "N8N_LOG_LEVEL: ${N8N_LOG_LEVEL}"
echo "=================================================="

# Start n8n with LangWatch instrumentation
echo "Starting n8n with enhanced LangWatch integration..."
exec node --require /usr/local/lib/node_modules/n8n/tracing.js /usr/local/bin/n8n "$@"