#!/bin/sh
# Enhanced docker-entrypoint.sh for n8n LangWatch integration

echo "n8n with LangWatch integration starting..."

# Set LangWatch configuration
export LANGWATCH_API_KEY="${LANGWATCH_API_KEY}"
export LANGWATCH_ENDPOINT="${LANGWATCH_ENDPOINT:-https://app.langwatch.ai}"
export LANGWATCH_LOG_LEVEL="${LANGWATCH_LOG_LEVEL:-info}"

# Set OpenTelemetry configuration
export OTEL_SERVICE_NAME="${OTEL_SERVICE_NAME:-n8n}"
export OTEL_SERVICE_VERSION="${N8N_VERSION:-unknown}"
export OTEL_LOG_LEVEL="${OTEL_LOG_LEVEL:-info}"

# Print active configuration
echo "===== n8n LangWatch Integration Configuration ====="
echo "LANGWATCH_ENDPOINT: ${LANGWATCH_ENDPOINT}"
echo "LANGWATCH_API_KEY is ${LANGWATCH_API_KEY:+set}"
echo "LANGWATCH_LOG_LEVEL: ${LANGWATCH_LOG_LEVEL}"
echo "OTEL_SERVICE_NAME: ${OTEL_SERVICE_NAME}"
echo "N8N_LOG_LEVEL: ${N8N_LOG_LEVEL:-info}"
echo "===================================================="

# Verify required files exist
N8N_DIR="/usr/local/lib/node_modules/n8n"
TRACING_FILE="${N8N_DIR}/tracing.js"
INSTRUMENTATION_FILE="${N8N_DIR}/n8n-otel-instrumentation.js"
EXPORTER_FILE="${N8N_DIR}/langwatch-exporter.js"

if [ ! -f "${TRACING_FILE}" ]; then
  echo "ERROR: Required file not found: ${TRACING_FILE}"
  exit 1
fi

if [ ! -f "${INSTRUMENTATION_FILE}" ]; then
  echo "ERROR: Required file not found: ${INSTRUMENTATION_FILE}"
  exit 1
fi

if [ ! -f "${EXPORTER_FILE}" ]; then
  echo "ERROR: Required file not found: ${EXPORTER_FILE}"
  exit 1
fi

# Make sure all JS files have correct permissions
find "${N8N_DIR}" -name "*.js" -type f -exec chmod 644 {} \; 2>/dev/null || true

# Start n8n with LangWatch tracing
echo "Starting n8n with LangWatch integration..."

if [ -z "${LANGWATCH_API_KEY}" ]; then
  echo "WARNING: LANGWATCH_API_KEY is not set. Traces will not be sent to LangWatch."
fi

# Start n8n with OpenTelemetry tracing
exec node --require "${TRACING_FILE}" /usr/local/bin/n8n "$@" || {
  # If fails with tracing, try without it
  echo "ERROR: Failed to start with tracing enabled. Trying without tracing..."
  n8n "$@"
}