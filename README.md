# n8n LangWatch Integration

This project provides integration between n8n workflows and LangWatch for AI observability and monitoring.

## Overview

This integration captures AI operations in n8n workflows and sends them to LangWatch for monitoring, analytics, and observability. It automatically detects and instruments AI nodes in n8n workflows, tracking important metrics and sending spans to LangWatch.

## Features

- Automatic detection of AI/LLM nodes in n8n workflows
- Tracks system prompts, user inputs, and AI model outputs
- Captures token usage, model parameters, and execution time
- Groups traces by workflow ID for easy correlation
- Low overhead with background processing

## Installation

### Prerequisites

- Docker and Docker Compose
- A LangWatch account and API key

### Setup

1. Clone this repository:
   ```
   git clone https://github.com/yourusername/n8n-langwatch.git
   cd n8n-langwatch
   ```

2. Create an `.env` file with your LangWatch API key:
   ```
   LANGWATCH_API_KEY=your-api-key-here
   ```

3. Start the n8n instance with LangWatch integration:
   ```
   docker-compose up -d
   ```

4. Access n8n at http://localhost:5678

## Configuration

The following environment variables can be configured:

- `LANGWATCH_API_KEY` - Your LangWatch API key (required)
- `LANGWATCH_ENDPOINT` - LangWatch API endpoint (default: https://app.langwatch.ai)
- `LANGWATCH_LOG_LEVEL` - Log level (error, warn, info, debug) (default: info)

## Project Structure

- `index.js` - Main entry point
- `logger.js` - Logging configuration
- `langwatch-client.js` - API client for LangWatch
- `trace-manager.js` - Manages trace lifecycle
- `instrumentation/` - n8n instrumentation code
  - `index.js` - Combined instrumentation setup
  - `workflow-instrumentation.js` - Workflow execution tracking
  - `node-instrumentation.js` - Node execution tracking
- `utils/` - Utility functions
  - `helpers.js` - Common utility functions
  - `model-detection.js` - AI model detection utilities

## How It Works

1. The integration patches n8n's workflow and node execution methods to track executions
2. AI/LLM nodes are automatically detected based on type, name, and parameters
3. Each workflow execution creates a trace in LangWatch
4. Each node execution creates a span within that trace
5. The integration extracts:
   - Model information (vendor, model name)
   - Input (user messages, system prompts)
   - Output (AI responses)
   - Performance metrics (tokens, execution time)
   - Model parameters (temperature, etc.)
6. These traces are sent to LangWatch in the background

## License

MIT