#!/bin/sh
# Script to check if n8n is running properly

echo "Checking if n8n is running..."
curl -s http://localhost:5678 > /dev/null
if [ $? -eq 0 ]; then
  echo "n8n is running successfully at http://localhost:5678"
  echo "You can access the n8n editor in your browser at that URL."
  echo ""
echo "To start n8n with LangWatch integration, use:"
echo "sudo ./local-entrypoint.sh"
echo ""
echo "Your LangWatch API key is stored in the .env file and will be loaded automatically."
echo "If you need to update it, edit the .env file or use:"
echo "LANGWATCH_API_KEY=your_api_key sudo ./local-entrypoint.sh"
else
  echo "n8n is not running or not accessible at http://localhost:5678"
fi
