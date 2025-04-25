# LangWatch All Nodes Solution

This solution enables LangWatch to capture and display all n8n workflow nodes, not just AI nodes. This provides a complete view of your workflow execution in LangWatch.

## Problem

The original implementation only showed AI nodes in LangWatch traces, while non-AI nodes (like Calculator, HTTP Request, etc.) were not being included. This made it difficult to understand the complete workflow execution.

## Solution

We've created a modified version of the LangWatch exporter that properly handles both AI and non-AI nodes:

1. The `langwatch-exporter-all-nodes.js` file is a modified version of the original exporter that:
   - Properly processes all node spans, not just AI nodes
   - Uses the "unknown" type for non-AI nodes (as required by the LangWatch API)
   - Extracts input, output, and parameters from all nodes

2. The solution works with the existing n8n instrumentation, which already sets `'n8n.node.include_in_trace': true` for all nodes.

## Files

- `langwatch-exporter-all-nodes.js`: The modified exporter that handles all nodes
- `test-simulate-all-nodes.js`: A test script that simulates both AI and non-AI nodes
- `test-all-nodes-exporter.js`: A test script that processes real trace files

## How to Use

1. Replace the original LangWatch exporter with the modified version:

```javascript
// In your n8n setup code where the exporter is created
const LangWatchExporter = require('./langwatch-exporter-all-nodes');
```

2. No changes are needed to the instrumentation code, as it already sets `'n8n.node.include_in_trace': true` for all nodes.

## Testing

You can test the solution using the provided test scripts:

```bash
# Test with simulated nodes
node test-simulate-all-nodes.js

# Test with real trace files
node test-all-nodes-exporter.js
```

## Implementation Details

The key changes in the exporter are:

1. Using "unknown" as the type for non-AI nodes (instead of "custom" which is not accepted by the LangWatch API)
2. Properly extracting and formatting input and output data for all node types
3. Including node parameters as span parameters for better context

## Limitations

- The LangWatch UI may not be optimized for displaying non-AI nodes, but they will be included in the trace
- Some node-specific details may not be captured as effectively as AI-specific details
