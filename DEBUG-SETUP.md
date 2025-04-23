# n8n OpenTelemetry Debug Setup

This setup allows you to capture and analyze the complete OpenTelemetry (otel) output from n8n workflow executions. It provides a way to see all the data that's being generated during workflow runs, which can be useful for debugging, development, and understanding the internal workings of n8n.

## Components

1. **Debug Endpoint Server (`otel-debug-endpoint.js`)**: A simple HTTP server that receives and logs OpenTelemetry data.
2. **Debug Exporter (`debug-exporter.js`)**: An extension of the LangWatch exporter that sends complete span data to the debug endpoint.
3. **Test Scripts**: Tools to verify the setup is working correctly.
4. **Docker Configuration**: Updated Docker setup to enable the debug functionality.

## How to Use

### Local Testing

To test the setup locally before rebuilding the Docker container:

1. Run the test script:
   ```bash
   ./test-debug-setup.sh
   ```

   Options:
   - `--with-langwatch`: Also send data to LangWatch (requires LANGWATCH_API_KEY environment variable)
   - `--port=PORT`: Specify a custom port for the debug endpoint (default: 3000)

2. The script will:
   - Start the debug endpoint server
   - Run test spans through the debug exporter
   - Show the latest trace files
   - Offer to display the contents of the latest trace file

### Docker Setup

1. Build and start the Docker containers:
   ```bash
   docker-compose build
   docker-compose up -d
   ```

2. The setup includes two containers:
   - `debug-endpoint`: A dedicated server that receives and logs OpenTelemetry data
   - `n8n`: The n8n service with OpenTelemetry instrumentation that sends data to the debug endpoint

3. The debug endpoint will be available at http://localhost:3000/debug-otel

4. Trace files will be stored in the `./otel_logs/` directory on your host machine

5. To view the logs directly:
   ```bash
   ls -la ./otel_logs/
   ```

6. To view a specific trace file:
   ```bash
   cat ./otel_logs/FILENAME.json | jq '.'
   ```

7. To check the debug endpoint logs:
   ```bash
   docker-compose logs debug-endpoint
   ```

## Configuration Options

The following environment variables can be set in `docker-compose.yml`:

| Variable | Description | Default |
|----------|-------------|---------|
| `USE_DEBUG_EXPORTER` | Enable the debug exporter | `true` |
| `DEBUG_ENDPOINT` | URL of the debug endpoint | `http://localhost:3000/debug-otel` |
| `DEBUG_SEND_TO_LANGWATCH` | Also send data to LangWatch | `true` |
| `DEBUG_EXPORTER_LOG_LEVEL` | Log level for the debug exporter | `debug` |
| `LANGWATCH_LOG_LEVEL` | Log level for LangWatch | `debug` |
| `OTEL_LOG_LEVEL` | Log level for OpenTelemetry | `debug` |

## Understanding the Output

The debug endpoint captures and logs the complete OpenTelemetry trace data, including:

1. **Trace ID**: A unique identifier for the entire workflow execution
2. **Spans**: Individual operations within the workflow
   - Workflow execution spans
   - Node execution spans
   - HTTP request spans
   - Database operation spans
   - LLM operation spans
3. **Attributes**: Key-value pairs with detailed information about each span
4. **Events**: Time-stamped events within spans
5. **Links**: Connections between related spans
6. **Workflow Execution**: A hierarchical view of the workflow execution with nodes and their inputs/outputs
7. **Node Data**: Detailed information about each node's execution, including parameters, inputs, and outputs

Each trace is saved as a JSON file in the `otel_logs` directory with a timestamp-based filename.

## Recent Improvements

The debug exporter has been enhanced to provide more detailed information about workflow executions:

1. **Hierarchical Workflow View**: Traces now include a `workflow_execution` section that shows the workflow structure with all nodes in execution order.

2. **Node Input/Output Data**: Each node's inputs and outputs are now captured and included in the trace data.

3. **AI-Specific Information**: For AI nodes (like OpenAI, Claude, etc.), the trace includes:
   - Prompt/input details
   - Response/output content
   - Token usage metrics
   - Model parameters

4. **Parent-Child Relationships**: Spans are now organized with explicit parent-child relationships for easier navigation.

5. **Enhanced Console Output**: The debug endpoint now provides more detailed console output when receiving trace data.

## Analyzing the Data

The trace data can be analyzed to:

1. **Debug workflow issues**: Identify where errors occur and why
2. **Optimize performance**: Find bottlenecks in workflow execution
3. **Understand data flow**: See how data moves between nodes
4. **Monitor LLM usage**: Track prompts, completions, and token usage
5. **Audit workflow execution**: Keep a record of all operations for compliance or review

## Example Trace Structure

A typical trace JSON file will have this structure:

```json
{
  "trace_id": "trace-abc123...",
  "spans": [
    {
      "span_id": "span-123...",
      "parent_span_id": null,
      "trace_id": "trace-abc123...",
      "name": "n8n.workflow.execute",
      "kind": 0,
      "start_time": 1650000000000000,
      "end_time": 1650000005000000,
      "duration_ms": 5000,
      "status": { "code": 0 },
      "attributes": {
        "n8n.workflow.id": "workflow-123",
        "n8n.workflow.name": "My Workflow"
      },
      "events": [],
      "workflow_data": {
        "id": "workflow-123",
        "name": "My Workflow",
        "settings": {
          "executionOrder": "v1"
        }
      }
    },
    {
      "span_id": "span-456...",
      "parent_span_id": "span-123...",
      "trace_id": "trace-abc123...",
      "name": "n8n.node.execute",
      "kind": 0,
      "start_time": 1650000001000000,
      "end_time": 1650000003000000,
      "duration_ms": 2000,
      "status": { "code": 0 },
      "attributes": {
        "n8n.node.name": "OpenAI",
        "n8n.node.type": "n8n-nodes-base.openAi",
        "n8n.node.is_ai": true,
        "n8n.node.ai_input.prompt": "Write a short poem about debugging"
      },
      "events": [],
      "node_data": {
        "name": "OpenAI",
        "type": "n8n-nodes-base.openAi",
        "is_ai": true,
        "parameters": {
          "model": "gpt-4",
          "temperature": 0.7
        },
        "input": {
          "prompt": "Write a short poem about debugging"
        },
        "output": {
          "id": "chatcmpl-123",
          "choices": [
            {
              "message": {
                "role": "assistant",
                "content": "In the labyrinth of code..."
              }
            }
          ]
        },
        "ai_metrics": {
          "prompt_tokens": 10,
          "completion_tokens": 50,
          "total_tokens": 60
        }
      }
    }
  ],
  "metadata": {
    "service": "n8n",
    "timestamp": 1650000005000,
    "span_count": 2,
    "workflow_id": "workflow-123",
    "workflow_name": "My Workflow"
  },
  "workflow_execution": {
    "id": "workflow-123",
    "name": "My Workflow",
    "span_id": "span-123...",
    "start_time": 1650000000000000,
    "end_time": 1650000005000000,
    "duration_ms": 5000,
    "nodes": [
      {
        "name": "OpenAI",
        "type": "n8n-nodes-base.openAi",
        "span_id": "span-456...",
        "start_time": 1650000001000000,
        "end_time": 1650000003000000,
        "duration_ms": 2000,
        "output": {
          "id": "chatcmpl-123",
          "choices": [
            {
              "message": {
                "role": "assistant",
                "content": "In the labyrinth of code..."
              }
            }
          ]
        }
      }
    ]
  },
  "raw_spans": [
    // Raw span data for debugging
  ]
}
```

## Testing the Debug Setup

You can run a test workflow to verify the debug setup is working correctly:

```bash
node test-debug-exporter.js
```

This will:
1. Create a simulated workflow with multiple nodes (including an AI node)
2. Generate spans for the workflow and node executions
3. Send the spans to the debug endpoint
4. Save the trace data to a file in the `otel_logs` directory

## Troubleshooting

If you encounter issues:

1. **Check the debug endpoint logs**:
   ```bash
   docker-compose logs debug-endpoint
   ```

2. **Verify the debug endpoint is running**:
   ```bash
   docker-compose ps debug-endpoint
   ```

3. **Check n8n logs for OpenTelemetry errors**:
   ```bash
   docker-compose logs n8n | grep -i telemetry
   ```

4. **Check if n8n can connect to the debug endpoint**:
   ```bash
   docker-compose exec n8n nc -zv debug-endpoint 3000
   ```

5. **Restart the containers if needed**:
   ```bash
   docker-compose restart
   ```

6. **View the most recent trace file**:
   ```bash
   ls -t ./otel_logs/*.json | head -1 | xargs cat | jq '.'
   ```

## Notes

- The debug endpoint is intended for development and debugging purposes only.
- For production environments, consider using a more robust solution for collecting and analyzing OpenTelemetry data.
- Large workflows may generate substantial amounts of trace data. Monitor disk usage if running for extended periods.
