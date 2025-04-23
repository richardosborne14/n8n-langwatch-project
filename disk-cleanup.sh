#!/bin/bash

echo "Running disk cleanup..."

# Check disk usage
DISK_USAGE=$(df -h /home/node/.n8n | awk 'NR==2 {print $5}' | sed 's/%//')
echo "Current disk usage: ${DISK_USAGE}%"

# Clean up old executions
echo "Cleaning up old executions..."
find /home/node/.n8n -name "*.json" -type f -mtime +7 -delete 2>/dev/null || true

# Vacuum SQLite database if it exists
if [ -f /home/node/.n8n/database.sqlite ]; then
  echo "Vacuuming SQLite database..."
  sqlite3 /home/node/.n8n/database.sqlite "VACUUM;" 2>/dev/null || true
fi

# Remove old logs
echo "Cleaning up old logs..."
find /home/node/.n8n -name "*.log" -type f -mtime +7 -delete 2>/dev/null || true

# Check disk usage after cleanup
DISK_USAGE_AFTER=$(df -h /home/node/.n8n | awk 'NR==2 {print $5}' | sed 's/%//')
echo "Disk usage after cleanup: ${DISK_USAGE_AFTER}%"
echo "Cleanup completed."
