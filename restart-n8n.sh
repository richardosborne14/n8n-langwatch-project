#!/bin/sh
# Script to restart n8n with debug logging enabled

echo "Restarting n8n with debug logging enabled..."

# Check if running with Docker Compose
if [ -f "docker-compose.yml" ]; then
  echo "Docker Compose detected, restarting n8n container..."
  docker-compose down
  docker-compose up -d
  echo "n8n container restarted with debug logging enabled."
  echo "You should now see detailed workflow execution logs in the container logs."
  echo "To view logs, run: docker-compose logs -f n8n"
else
  # Check if running locally
  if [ -f "local-entrypoint.sh" ]; then
    echo "Local installation detected, stopping any running n8n processes..."
    pkill -f "node.*n8n" || true
    
    echo "Starting n8n with debug logging enabled..."
    chmod +x ./local-entrypoint.sh
    ./local-entrypoint.sh
  else
    echo "Could not determine how n8n is running. Please restart manually."
    echo "Make sure LANGWATCH_LOG_LEVEL=debug is set in your environment."
  fi
fi
