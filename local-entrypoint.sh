#!/bin/sh
# Modified entrypoint script for n8n LangWatch integration (local environment)

echo "n8n with LangWatch integration starting..."

# Load environment variables from .env file if it exists
if [ -f .env ]; then
  echo "Loading environment variables from .env file..."
  while IFS='=' read -r key value; do
    # Skip empty lines and comments
    if [ -z "$key" ] || [ "${key#\#}" != "$key" ]; then
      continue
    fi
    # Remove leading/trailing whitespace and quotes
    key=$(echo "$key" | xargs)
    value=$(echo "$value" | xargs | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//")
    # Export the variable
    export "$key"="$value"
  done < .env
fi

# Set LangWatch configuration
export LANGWATCH_API_KEY="${LANGWATCH_API_KEY}"
export LANGWATCH_ENDPOINT="${LANGWATCH_ENDPOINT:-https://app.langwatch.ai}"
export LANGWATCH_LOG_LEVEL="${LANGWATCH_LOG_LEVEL:-info}"

# Print active configuration
echo "===== n8n LangWatch Integration Configuration ====="
echo "LANGWATCH_ENDPOINT: ${LANGWATCH_ENDPOINT}"
echo "LANGWATCH_API_KEY is ${LANGWATCH_API_KEY:+set}"
echo "LANGWATCH_LOG_LEVEL: ${LANGWATCH_LOG_LEVEL}"
echo "N8N_LOG_LEVEL: ${N8N_LOG_LEVEL:-info}"
echo "===================================================="

# Check required paths - use current directory instead of /usr/local/lib/node_modules/n8n
CURRENT_DIR="$(pwd)"
TRACING_FILE="${CURRENT_DIR}/tracing.js"
ADAPTER_FILE="${CURRENT_DIR}/tracing-adapter.js"
INSTRUMENTATION_ROOT="${CURRENT_DIR}/n8n-langwatch-instrumentation.js"
INSTRUMENTATION_SUBDIR="${CURRENT_DIR}/instrumentation/n8n-langwatch-instrumentation.js"

# Create n8n cache directory with proper permissions if it doesn't exist
N8N_CACHE_DIR="${HOME}/.cache/n8n"
mkdir -p "${N8N_CACHE_DIR}/public"
chmod -R 755 "${N8N_CACHE_DIR}"

# Create tracing-adapter.js if not exists (using the existing one in the current directory)
if [ ! -f "${ADAPTER_FILE}" ]; then
  echo "Creating adapter file: ${ADAPTER_FILE}"
  # Copy from the existing file in the repo
  cp "${CURRENT_DIR}/tracing-adapter.js" "${ADAPTER_FILE}"
  chmod 644 "${ADAPTER_FILE}"
fi

# Create or update tracing.js (using the existing one in the current directory)
echo "Updating tracing file: ${TRACING_FILE}"
# Copy from the existing file in the repo
cp "${CURRENT_DIR}/tracing.js" "${TRACING_FILE}"
chmod 644 "${TRACING_FILE}"

# Check if instrumentation file exists in the subdirectory
if [ ! -f "${INSTRUMENTATION_SUBDIR}" ]; then
  echo "WARNING: No instrumentation file found in ${INSTRUMENTATION_SUBDIR}. LangWatch tracking will be limited."
fi

# Make sure all JS files have correct permissions
find "${CURRENT_DIR}" -name "*.js" -type f -exec chmod 644 {} \; 2>/dev/null || true

# Start n8n with LangWatch tracing
echo "Starting n8n with LangWatch integration..."
# Use the compatible Node.js version
NODE_PATH="/Users/richardosborne/.nvm/versions/node/v18.20.5/bin/node"
echo "Using Node.js version: $($NODE_PATH --version)"
$NODE_PATH --require "${TRACING_FILE}" "$(which n8n)" "$@" || {
  # If fails with tracing, try without it
  echo "ERROR: Failed to start with tracing enabled. Trying without tracing..."
  $NODE_PATH "$(which n8n)" "$@"
}
