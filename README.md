# n8n-langwatch Integration

This project integrates [n8n](https://n8n.io/) with [LangWatch](https://langwatch.ai/) to provide observability for AI workflows in n8n.

## Features

- OpenTelemetry instrumentation for n8n workflows
- Automatic tracing of AI-related nodes (OpenAI, Claude, etc.)
- Detailed metrics for LLM calls
- Visualization of workflow execution in LangWatch

## Quick Start

1. Clone this repository
2. Set your LangWatch API key in `.env` or directly in `docker-compose.yml`
3. Run the container:

```bash
docker-compose up -d
```

4. Access n8n at http://localhost:5678
5. View traces in your LangWatch dashboard

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `LANGWATCH_API_KEY` | Your LangWatch API key (required) | - |
| `LANGWATCH_ENDPOINT` | LangWatch API endpoint | https://app.langwatch.ai |
| `LANGWATCH_LOG_LEVEL` | Log level for LangWatch integration | info |
| `OTEL_SERVICE_NAME` | Service name in LangWatch | n8n |
| `N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS` | Enforce secure file permissions | true |
| `EXECUTIONS_DATA_MAX_AGE` | Max age (hours) for execution data | 72 |
| `EXECUTIONS_DATA_PRUNE_MAX_COUNT` | Max number of executions to keep | 1000 |

## Troubleshooting

### OpenTelemetry API Duplicate Registration

If you see errors like:
```
Error: @opentelemetry/api: Attempted duplicate registration of API: context
```

This is handled automatically in the latest version. The integration will continue to work despite this warning.

### Disk Space Issues

If you encounter disk space errors (`ENOSPC: no space left on device`):

1. The container includes automatic disk cleanup that runs daily
2. You can manually trigger cleanup by running:
   ```bash
   docker exec n8n-langwatch_n8n_1 /disk-cleanup.sh
   ```
3. Adjust retention settings in docker-compose.yml:
   ```yaml
   - EXECUTIONS_DATA_MAX_AGE=24  # Reduce from default 72 hours
   - EXECUTIONS_DATA_PRUNE_MAX_COUNT=500  # Reduce from default 1000
   ```

### OpenTelemetry SDK Compatibility Issues

If you encounter errors like:
```
TypeError: Cannot set properties of undefined (setting 'contextManager')
```

This is fixed in the latest version by adding compatibility with newer versions of the OpenTelemetry SDK. The integration now checks for the existence of properties before attempting to set them.

### File Permission Warnings

If you see warnings about file permissions:
```
Permissions 0644 for n8n settings file /home/node/.n8n/config are too wide.
```

This is automatically fixed by setting `N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS=true` in the docker-compose.yml.

### Invalid JSON Configuration

If n8n fails to start due to invalid JSON in the config file, the entrypoint script will automatically back up the invalid file and create a new one.

## Testing the Integration

You can test if the LangWatch integration is working correctly by running:

```bash
docker exec n8n-langwatch_n8n_1 node /usr/local/lib/node_modules/n8n/test-langwatch.js
```

This will send a test trace to LangWatch. Check your LangWatch dashboard to confirm it was received.

## Architecture

This integration uses:

1. OpenTelemetry for distributed tracing
2. Custom n8n instrumentation to capture workflow and node execution
3. LangWatch exporter to send traces to LangWatch
4. Docker for containerization and easy deployment

## License

MIT
