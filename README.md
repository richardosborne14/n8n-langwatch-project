# n8n LangWatch Integration

This project provides a seamless integration between n8n workflows and LangWatch for AI monitoring and observability. It captures detailed information about AI-related nodes in your n8n workflows, including inputs, outputs, and metadata, and sends it to LangWatch for analysis.

## Features

- Automatically captures AI-related node executions in n8n workflows
- Extracts prompts, completions, and parameters from AI service calls
- Sends data to LangWatch in real-time
- Supports multiple AI services (OpenAI, Anthropic, Google, etc.)
- Minimal performance overhead
- Compatible with n8n Docker deployments
- Ready for Azure Web App deployments

## Prerequisites

- Docker and Docker Compose
- A LangWatch account and API key
- n8n instance (this integration extends the official n8n Docker image)

## Quick Start

1. Clone this repository
2. Set your LangWatch API key in the `docker-compose.yml` file
3. Run `docker-compose up -d`
4. Access n8n at http://localhost:5678

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `LANGWATCH_API_KEY` | Your LangWatch API key (required) | - |
| `LANGWATCH_ENDPOINT` | LangWatch API endpoint | https://app.langwatch.ai |
| `LANGWATCH_LOG_LEVEL` | Log level for the integration | info |
| `OTEL_SERVICE_NAME` | Service name in LangWatch | n8n |
| `N8N_LOG_LEVEL` | n8n log level | info |

## How It Works

This integration uses OpenTelemetry to instrument n8n workflows and capture execution details without modifying the core n8n code. It:

1. Patches workflow and node execution methods to create OpenTelemetry spans
2. Captures detailed information about AI-related nodes
3. Converts OpenTelemetry spans to LangWatch trace format
4. Sends traces to LangWatch via their REST API

## Deployment to Azure Web App

To deploy this integration to Azure Web App:

1. Build the Docker image:
   ```
   docker build -t your-registry.azurecr.io/n8n-langwatch:latest .
   docker push your-registry.azurecr.io/n8n-langwatch:latest
   ```

2. Create an Azure Web App with Docker Container:
   - Set the image to your pushed image
   - Configure environment variables (especially `LANGWATCH_API_KEY`)
   - Add persistent storage for n8n data

3. Deploy and monitor the application

## Troubleshooting

Common issues and their solutions:

- **No traces in LangWatch**: Ensure your API key is correctly set and that you have AI-related nodes in your workflows.
- **Docker container fails to start**: Check logs with `docker-compose logs` for errors.
- **High memory usage**: Adjust the span retention settings in `tracing.js` if needed.

## Contributing

Contributions welcome! Please feel free to submit pull requests or open issues.

## License

MIT