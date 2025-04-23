#!/bin/bash
# Script to fix the n8n config file in the Docker container

echo "Fixing n8n config file in Docker container..."

# Get the container ID
CONTAINER_ID=$(docker ps | grep n8n | awk '{print $1}')

if [ -z "$CONTAINER_ID" ]; then
  echo "Error: n8n container not found. Make sure it's running."
  exit 1
fi

echo "Found n8n container: $CONTAINER_ID"

# Create a temporary fix script
cat > /tmp/fix-config.sh << 'EOF'
#!/bin/sh
CONFIG_FILE="/home/node/.n8n/config"

echo "Checking n8n config file at ${CONFIG_FILE}..."
if [ -f "${CONFIG_FILE}" ]; then
  echo "Config file exists. Checking if it's valid JSON..."
  if jq empty "${CONFIG_FILE}" 2>/dev/null; then
    echo "Config file is valid JSON. Setting proper permissions..."
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
  mkdir -p /home/node/.n8n
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

echo "Final config file check:"
ls -la "${CONFIG_FILE}" || echo "Failed to list config file"
echo "Config file content:"
cat "${CONFIG_FILE}" || echo "Failed to read config file"
EOF

# Copy the fix script to the container
echo "Copying fix script to container..."
docker cp /tmp/fix-config.sh $CONTAINER_ID:/tmp/fix-config.sh

# Make the script executable and run it
echo "Running fix script in container..."
docker exec $CONTAINER_ID sh -c "chmod +x /tmp/fix-config.sh && /tmp/fix-config.sh"

# Clean up
rm /tmp/fix-config.sh
echo "Fix script completed."

# Restart the container
echo "Restarting n8n container..."
docker restart $CONTAINER_ID

echo "Done. Check if n8n starts correctly now."
