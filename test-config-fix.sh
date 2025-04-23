#!/bin/bash
# Test script to verify the n8n config file fix

# Create a test directory
TEST_DIR="/tmp/n8n-test"
mkdir -p "$TEST_DIR"
echo "Created test directory: $TEST_DIR"

# Define the config file path
CONFIG_FILE="$TEST_DIR/config"

# Test case 1: No config file exists
echo "=== Test Case 1: No config file exists ==="
rm -f "$CONFIG_FILE"
echo "Config file removed."

echo "Checking n8n config file at ${CONFIG_FILE}..."
if [ -f "${CONFIG_FILE}" ]; then
  echo "Config file exists. Checking if it's valid JSON..."
  if jq empty "${CONFIG_FILE}" 2>/dev/null; then
    echo "Config file is valid JSON. Setting proper permissions..."
    # Ensure proper permissions if file is valid
    chmod 600 "${CONFIG_FILE}"
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

# Test case 2: Invalid JSON in config file
echo -e "\n=== Test Case 2: Invalid JSON in config file ==="
echo "{" > "$CONFIG_FILE"
echo "Created invalid JSON config file."

echo "Checking n8n config file at ${CONFIG_FILE}..."
if [ -f "${CONFIG_FILE}" ]; then
  echo "Config file exists. Checking if it's valid JSON..."
  if jq empty "${CONFIG_FILE}" 2>/dev/null; then
    echo "Config file is valid JSON. Setting proper permissions..."
    # Ensure proper permissions if file is valid
    chmod 600 "${CONFIG_FILE}"
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

# Test case 3: Valid JSON in config file
echo -e "\n=== Test Case 3: Valid JSON in config file ==="
echo '{"test": "value"}' > "$CONFIG_FILE"
echo "Created valid JSON config file."

echo "Checking n8n config file at ${CONFIG_FILE}..."
if [ -f "${CONFIG_FILE}" ]; then
  echo "Config file exists. Checking if it's valid JSON..."
  if jq empty "${CONFIG_FILE}" 2>/dev/null; then
    echo "Config file is valid JSON. Setting proper permissions..."
    # Ensure proper permissions if file is valid
    chmod 600 "${CONFIG_FILE}"
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

echo -e "\nTest completed. Check the output above to verify the fix."
