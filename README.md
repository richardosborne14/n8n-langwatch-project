# n8n LangWatch Integration

This project provides integration between n8n workflows and LangWatch for AI observability and monitoring.

## Overview

This integration captures AI operations in n8n workflows and sends them to LangWatch for monitoring, analytics, and observability. It automatically detects and instruments AI nodes in n8n workflows, tracking important metrics and sending spans to LangWatch via HTTP REST.

## Features

- Automatic detection of AI/LLM nodes in n8n workflows
- Tracks system prompts, user inputs, and AI model outputs
- Captures token usage, model parameters, and execution time
- Groups traces by workflow ID for easy correlation
- Low overhead with direct HTTP communication

## Installation

### Prerequisites

- Docker and Docker Compose (for Docker setup)
- n8n installed locally (for local setup)
- A LangWatch account and API key

### Docker Setup

1. Clone this repository:
   ```
   git clone https://github.com/yourusername/n8n-langwatch.git
   cd n8n-langwatch
   ```

2. Create an `.env` file with your LangWatch API key:
   ```
   LANGWATCH_API_KEY=your-api-key-here
   LANGWATCH_LOG_LEVEL=info
   ```

3. Start the n8n instance with LangWatch integration:
   ```
   docker-compose up -d
   ```

4. Access n8n at http://localhost:5678

### Local Setup

1. Clone this repository:
   ```
   git clone https://github.com/yourusername/n8n-langwatch.git
   cd n8n-langwatch
   ```

2. Create an `.env` file with your LangWatch API key:
   ```
   LANGWATCH_API_KEY=your-api-key-here
   LANGWATCH_LOG_LEVEL=info
   ```

3. Start n8n with the local entrypoint script:
   ```
   chmod +x ./local-entrypoint.sh
   ./local-entrypoint.sh
   ```

4. Access n8n at http://localhost:5678

## Configuration

The following environment variables can be configured:

- `LANGWATCH_API_KEY` - Your LangWatch API key (required)
- `LANGWATCH_ENDPOINT` - LangWatch API endpoint (default: https://app.langwatch.ai)
- `LANGWATCH_LOG_LEVEL` - Log level (error, warn, info, debug) (default: info)

## Project Structure

- `tracing.js` - Entry point for n8n instrumentation
- `tracing-adapter.js` - Adapter that loads the instrumentation module
- `logger.js` - Logging configuration
- `langwatch-client.js` - API client for LangWatch
- `trace-manager.js` - Manages trace lifecycle and sending to LangWatch
- `instrumentation/` - n8n instrumentation code
  - `index.js` - Combined instrumentation setup
  - `n8n-langwatch-instrumentation.js` - Main instrumentation module
  - `workflow-instrumentation.js` - Workflow execution tracking
  - `node-instrumentation.js` - Node execution tracking
- `utils/` - Utility functions
  - `helpers.js` - Common utility functions
  - `model-detection.js` - AI model detection utilities
- `docker-entrypoint.sh` - Entry point for Docker setup
- `local-entrypoint.sh` - Entry point for local setup
- `diagnostic.js` - Diagnostic tool for checking the setup
- `restart-n8n.sh` - Script to restart n8n with debug logging
- `check-n8n.sh` - Script to check if n8n is running

## How It Works

The integration follows this flow:

1. **Initialization**: When n8n starts, it loads `tracing.js` which initializes the instrumentation
   - `tracing.js` loads `tracing-adapter.js`
   - `tracing-adapter.js` loads the instrumentation module from `instrumentation/n8n-langwatch-instrumentation.js`
   - The instrumentation module sets up the trace manager and patches n8n's methods

2. **Workflow Execution**:
   - When a workflow runs, the patched methods capture execution data
   - The trace manager creates a trace for the workflow execution
   - Each node execution creates a span within that trace

3. **AI Node Detection**:
   - AI/LLM nodes are automatically detected based on type, name, and parameters
   - For AI nodes, the integration extracts:
     - Model information (vendor, model name)
     - Input (user messages, system prompts)
     - Output (AI responses)
     - Performance metrics (tokens, execution time)
     - Model parameters (temperature, etc.)

4. **Data Transmission**:
   - The trace manager collects all spans for a workflow execution
   - When the workflow completes, the data is sent to LangWatch via HTTP
   - The LangWatch client handles retries and error handling

## Troubleshooting

If you encounter issues with the integration, you can:

1. Set `LANGWATCH_LOG_LEVEL=debug` in your `.env` file for more detailed logs
2. Run the diagnostic script to check your setup:
   ```
   node diagnostic.js
   ```
3. Use the restart script to restart n8n with debug logging:
   ```
   ./restart-n8n.sh
   ```
4. Check if n8n is running properly:
   ```
   ./check-n8n.sh
   ```

## License

MIT
