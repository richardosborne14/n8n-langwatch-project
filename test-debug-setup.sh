#!/bin/bash

# Test script for the OpenTelemetry debug setup

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${YELLOW}=== n8n OpenTelemetry Debug Test ===${NC}"
echo ""

# Check if required packages are installed
echo -e "${YELLOW}Checking for required packages...${NC}"
REQUIRED_PACKAGES=(
  "@opentelemetry/api"
  "@opentelemetry/sdk-trace-node"
  "@opentelemetry/sdk-trace-base"
  "winston"
)

MISSING_PACKAGES=()
for package in "${REQUIRED_PACKAGES[@]}"; do
  if ! npm list "$package" > /dev/null 2>&1; then
    MISSING_PACKAGES+=("$package")
  fi
done

if [ ${#MISSING_PACKAGES[@]} -gt 0 ]; then
  echo -e "${YELLOW}Installing missing packages: ${MISSING_PACKAGES[*]}${NC}"
  npm install --no-save "${MISSING_PACKAGES[@]}"
else
  echo -e "${GREEN}All required packages are installed.${NC}"
fi

# Start the debug endpoint server in the background
echo -e "${YELLOW}Starting debug endpoint server...${NC}"
node otel-debug-endpoint.js > otel-debug-endpoint.log 2>&1 &
SERVER_PID=$!

# Wait for the server to start
echo -e "${YELLOW}Waiting for server to start...${NC}"
sleep 2

# Check if the server is running
if ! ps -p $SERVER_PID > /dev/null; then
  echo -e "${RED}Failed to start debug endpoint server. Check otel-debug-endpoint.log for details.${NC}"
  exit 1
fi

echo -e "${GREEN}Debug endpoint server started with PID $SERVER_PID${NC}"

# Run the test
echo -e "${YELLOW}Running test workflow...${NC}"
node test-debug-exporter.js

# Check the result
if [ $? -eq 0 ]; then
  echo -e "${GREEN}Test completed successfully!${NC}"
else
  echo -e "${RED}Test failed. Check the logs for details.${NC}"
fi

# Stop the server
echo -e "${YELLOW}Stopping debug endpoint server...${NC}"
kill $SERVER_PID
wait $SERVER_PID 2>/dev/null

echo -e "${GREEN}Server stopped.${NC}"

# Check for generated log files
echo -e "${YELLOW}Checking for generated log files...${NC}"
LOG_FILES=$(find ./otel_logs -name "otel_trace_*.json" -type f -newer otel-debug-endpoint.log | sort)

if [ -z "$LOG_FILES" ]; then
  echo -e "${RED}No log files were generated.${NC}"
else
  echo -e "${GREEN}Generated log files:${NC}"
  for file in $LOG_FILES; do
    echo "  - $file"
  done
  
  # Show a summary of the latest log file
  LATEST_LOG=$(echo "$LOG_FILES" | tail -n 1)
  echo -e "${YELLOW}Summary of latest log file ($LATEST_LOG):${NC}"
  
  # Extract and display workflow information
  echo -e "${YELLOW}Workflow Information:${NC}"
  WORKFLOW_ID=$(jq -r '.workflow_execution.id // "N/A"' "$LATEST_LOG")
  WORKFLOW_NAME=$(jq -r '.workflow_execution.name // "N/A"' "$LATEST_LOG")
  NODE_COUNT=$(jq -r '.workflow_execution.nodes | length // 0' "$LATEST_LOG")
  
  echo "  Workflow ID: $WORKFLOW_ID"
  echo "  Workflow Name: $WORKFLOW_NAME"
  echo "  Number of Nodes: $NODE_COUNT"
  
  # List nodes
  echo -e "${YELLOW}Nodes:${NC}"
  jq -r '.workflow_execution.nodes[] | "  - " + .name + " (" + .type + ")"' "$LATEST_LOG" 2>/dev/null || echo "  No node information available"
  
  echo ""
  echo -e "${GREEN}To view the full trace data, open the log file:${NC}"
  echo "  cat $LATEST_LOG | jq"
fi

echo ""
echo -e "${GREEN}Test completed.${NC}"
