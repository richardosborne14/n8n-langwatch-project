#!/bin/sh
# Enhanced docker-entrypoint.sh for n8n LangWatch integration

echo "n8n with LangWatch integration starting..."

# Add host.docker.internal to /etc/hosts if needed (for Linux hosts)
if [ -f /usr/local/bin/add-host-docker-internal.sh ]; then
  echo "Setting up host.docker.internal hostname..."
  # We need to run this as root, so use su if available
  if command -v su >/dev/null 2>&1; then
    su -c "/usr/local/bin/add-host-docker-internal.sh" root
  else
    # Try with sudo if su is not available
    if command -v sudo >/dev/null 2>&1; then
      sudo /usr/local/bin/add-host-docker-internal.sh
    else
      echo "WARNING: Could not run add-host-docker-internal.sh as root. Debug endpoint may not work properly."
    fi
  fi
fi

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
echo "USE_DEBUG_EXPORTER: ${USE_DEBUG_EXPORTER:-false}"
if [ "${USE_DEBUG_EXPORTER}" = "true" ]; then
  echo "DEBUG_ENDPOINT: ${DEBUG_ENDPOINT}"
  echo "DEBUG_SEND_TO_LANGWATCH: ${DEBUG_SEND_TO_LANGWATCH}"
  echo "DEBUG_EXPORTER_LOG_LEVEL: ${DEBUG_EXPORTER_LOG_LEVEL}"
fi
echo "===================================================="

# Verify required files exist
N8N_DIR="/usr/local/lib/node_modules/n8n"
TRACING_FILE="${N8N_DIR}/tracing.js"
INSTRUMENTATION_FILE="${N8N_DIR}/n8n-otel-instrumentation.js"
EXPORTER_FILE="${N8N_DIR}/langwatch-exporter.js"
DEBUG_EXPORTER_FILE="${N8N_DIR}/debug-exporter.js"
DEBUG_ENDPOINT_FILE="${N8N_DIR}/otel-debug-endpoint.js"
CONFIG_FILE="/home/node/.n8n/config"

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

if [ "${USE_DEBUG_EXPORTER}" = "true" ]; then
  if [ ! -f "${DEBUG_EXPORTER_FILE}" ]; then
    echo "ERROR: Debug exporter file not found: ${DEBUG_EXPORTER_FILE}"
    exit 1
  fi
  
  if [ ! -f "${DEBUG_ENDPOINT_FILE}" ]; then
    echo "ERROR: Debug endpoint file not found: ${DEBUG_ENDPOINT_FILE}"
    exit 1
  fi
fi

# Create n8n directory if it doesn't exist
mkdir -p /home/node/.n8n

# Check if config file exists and is valid JSON
echo "Checking n8n config file at ${CONFIG_FILE}..."
if [ -f "${CONFIG_FILE}" ]; then
  echo "Config file exists. Checking if it's valid JSON..."
  if jq empty "${CONFIG_FILE}" 2>/dev/null; then
    echo "Config file is valid JSON. Setting proper permissions..."
    # Ensure proper permissions if file is valid
    chmod 600 "${CONFIG_FILE}"
    chown node:node "${CONFIG_FILE}"
    echo "Config file permissions set to 600."
  else
    echo "WARNING: Invalid JSON in config file. Backing up and creating a new one."
    echo "Content of invalid config file:"
    cat "${CONFIG_FILE}" || echo "Failed to read config file"
    
    # Create backup with timestamp
    BACKUP_FILE="${CONFIG_FILE}.bak.$(date +%s)"
    mv "${CONFIG_FILE}" "${BACKUP_FILE}" 2>/dev/null || true
    echo "Created backup at ${BACKUP_FILE}"
    
    # Create new empty config file
    echo "{}" > "${CONFIG_FILE}"
    chmod 600 "${CONFIG_FILE}"
    chown node:node "${CONFIG_FILE}"
    echo "Created new empty config file with permissions 600."
    
    # Verify the new file
    if jq empty "${CONFIG_FILE}" 2>/dev/null; then
      echo "New config file is valid JSON."
    else
      echo "ERROR: Failed to create valid config file!"
    fi
  fi
else
  echo "Config file does not exist. Creating empty config file..."
  # Create empty config file with proper permissions
  echo "{}" > "${CONFIG_FILE}"
  chmod 600 "${CONFIG_FILE}"
  chown node:node "${CONFIG_FILE}"
  echo "Created new empty config file with permissions 600."
  
  # Verify the new file
  if jq empty "${CONFIG_FILE}" 2>/dev/null; then
    echo "New config file is valid JSON."
  else
    echo "ERROR: Failed to create valid config file!"
  fi
fi

# Double-check file permissions and content
echo "Final config file check:"
ls -la "${CONFIG_FILE}" || echo "Failed to list config file"
echo "Config file content:"
cat "${CONFIG_FILE}" || echo "Failed to read config file"

# Ensure n8n directory has correct permissions
chown -R node:node /home/node/.n8n

# Make sure all JS files have correct permissions
find "${N8N_DIR}" -name "*.js" -type f -exec chmod 644 {} \; 2>/dev/null || true

# Check disk space before starting
echo "Checking disk space..."
DISK_USAGE=$(df -h /home/node/.n8n | awk 'NR==2 {print $5}' | sed 's/%//')
echo "Current disk usage: ${DISK_USAGE}%"

if [ "${DISK_USAGE}" -gt 90 ]; then
  echo "WARNING: Disk usage is very high (${DISK_USAGE}%). Running emergency cleanup..."
  # Run disk cleanup script - check multiple possible locations
  if [ -f "/disk-cleanup.sh" ]; then
    echo "Running cleanup script from /disk-cleanup.sh"
    /disk-cleanup.sh
  elif [ -f "/usr/local/bin/disk-cleanup.sh" ]; then
    echo "Running cleanup script from /usr/local/bin/disk-cleanup.sh"
    /usr/local/bin/disk-cleanup.sh
  else
    echo "Disk cleanup script not found. Performing basic cleanup..."
    # Create a basic cleanup script in case it's missing
    cat > /tmp/basic-cleanup.sh << 'EOF'
#!/bin/sh
echo "Running basic disk cleanup..."
find /home/node/.n8n -name "*.json" -type f -mtime +1 -delete 2>/dev/null || true
if [ -f "/home/node/.n8n/database.sqlite" ]; then
  echo "Attempting to vacuum SQLite database..."
  sqlite3 /home/node/.n8n/database.sqlite "VACUUM;" 2>/dev/null || true
fi
echo "Basic cleanup completed."
EOF
    chmod +x /tmp/basic-cleanup.sh
    /tmp/basic-cleanup.sh
  fi
fi

# Start crond in background for scheduled disk cleanup
if command -v crond >/dev/null 2>&1; then
  echo "Starting crond for scheduled disk cleanup..."
  crond -b -L /home/node/.n8n/cron.log || echo "Failed to start crond, scheduled cleanup will not work"
else
  echo "crond not found, scheduled cleanup will not work"
fi

# Check if debug endpoint is accessible
if [ "${USE_DEBUG_EXPORTER}" = "true" ]; then
  echo "Checking connection to debug endpoint at ${DEBUG_ENDPOINT}..."
  # Extract hostname and port from DEBUG_ENDPOINT
  DEBUG_HOST=$(echo "${DEBUG_ENDPOINT}" | sed -E 's|^https?://([^:/]+).*|\1|')
  DEBUG_PORT=$(echo "${DEBUG_ENDPOINT}" | sed -E 's|^https?://[^:]+:([0-9]+).*|\1|')
  if [ -z "${DEBUG_PORT}" ] || [ "${DEBUG_PORT}" = "${DEBUG_ENDPOINT}" ]; then
    # Default to port 80 for HTTP, 443 for HTTPS
    if echo "${DEBUG_ENDPOINT}" | grep -q "^https:"; then
      DEBUG_PORT=443
    else
      DEBUG_PORT=80
    fi
  fi
  
  echo "Waiting for debug endpoint at ${DEBUG_HOST}:${DEBUG_PORT}..."
  # Try to connect to the debug endpoint
  RETRY_COUNT=0
  MAX_RETRIES=30
  while [ ${RETRY_COUNT} -lt ${MAX_RETRIES} ]; do
    if nc -z "${DEBUG_HOST}" "${DEBUG_PORT}" 2>/dev/null; then
      echo "Successfully connected to debug endpoint at ${DEBUG_HOST}:${DEBUG_PORT}"
      break
    fi
    RETRY_COUNT=$((RETRY_COUNT + 1))
    echo "Attempt ${RETRY_COUNT}/${MAX_RETRIES}: Debug endpoint not available yet, retrying in 1 second..."
    sleep 1
  done
  
  if [ ${RETRY_COUNT} -eq ${MAX_RETRIES} ]; then
    echo "WARNING: Could not connect to debug endpoint at ${DEBUG_HOST}:${DEBUG_PORT} after ${MAX_RETRIES} attempts"
    echo "OpenTelemetry data may not be captured correctly"
  fi
fi

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
