"use strict";

const DebugExporter = require('./debug-exporter');
const { trace, context, SpanStatusCode, SpanKind } = require('@opentelemetry/api');
const { NodeTracerProvider } = require('@opentelemetry/sdk-trace-node');
const { InMemorySpanExporter } = require('@opentelemetry/sdk-trace-base');
const { SimpleSpanProcessor } = require('@opentelemetry/sdk-trace-base');

// Create a tracer provider
const provider = new NodeTracerProvider();
const memoryExporter = new InMemorySpanExporter();
const spanProcessor = new SimpleSpanProcessor(memoryExporter);
// In OpenTelemetry SDK v2.0.0, the API has changed
provider.registerSpanProcessor(spanProcessor);
provider.register();

// Create our debug exporter
const debugExporter = new DebugExporter({
  apiKey: 'test-api-key',
  debugEndpoint: 'http://localhost:3000/debug-otel',
  sendToLangWatch: false, // Don't send to LangWatch during testing
  logger: console
});

// Create a tracer
const tracer = trace.getTracer('test-tracer');

// Create a test workflow with nodes
async function runTestWorkflow() {
  console.log('Starting test workflow execution...');
  
  // Create a workflow span
  const workflowSpan = tracer.startSpan('n8n.workflow.execute', {
    attributes: {
      'n8n.workflow.id': 'test-workflow-123',
      'n8n.workflow.name': 'Test Workflow',
      'n8n.workflow.settings.executionOrder': 'v1',
      'n8n.workflow.settings.saveDataErrorExecution': 'all',
      'n8n.workflow.settings.saveDataSuccessExecution': 'all',
      'n8n.workflow.settings.saveManualExecutions': true
    },
    kind: SpanKind.INTERNAL
  });
  
  // Set the workflow span as active
  await context.with(trace.setSpan(context.active(), workflowSpan), async () => {
    // Create a node span for a "Code" node
    const codeNodeSpan = tracer.startSpan('n8n.node.execute', {
      attributes: {
        'n8n.node.name': 'Code',
        'n8n.node.type': 'n8n-nodes-base.code',
        'n8n.node.is_ai': false,
        'n8n.node.parameter.mode': 'jsObject',
        'n8n.node.parameter.jsCode': 'return { data: { message: "Hello from Code node!" } };'
      },
      kind: SpanKind.INTERNAL
    });
    
    // Simulate node execution
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Add output to the code node
    codeNodeSpan.setAttribute('n8n.node.output_json', JSON.stringify([
      { json: { message: 'Hello from Code node!' } }
    ]));
    
    // End the code node span
    codeNodeSpan.end();
    
    // Create a node span for an "OpenAI" node
    const openAiNodeSpan = tracer.startSpan('n8n.node.execute', {
      attributes: {
        'n8n.node.name': 'OpenAI',
        'n8n.node.type': 'n8n-nodes-base.openAi',
        'n8n.node.is_ai': true,
        'n8n.node.ai_param.model': 'gpt-4',
        'n8n.node.ai_param.temperature': 0.7,
        'n8n.node.ai_param.max_tokens': 1000,
        'n8n.node.ai_input.prompt': 'Explain the benefits of OpenTelemetry for workflow monitoring',
        'n8n.node.ai_input.messages_count': 1,
        'n8n.node.ai_input.last_message_role': 'user',
        'n8n.node.ai_input.last_message_content': 'Explain the benefits of OpenTelemetry for workflow monitoring'
      },
      kind: SpanKind.INTERNAL
    });
    
    // Simulate node execution
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Add output to the OpenAI node
    const aiOutput = {
      id: 'chatcmpl-123456789',
      object: 'chat.completion',
      created: Date.now(),
      model: 'gpt-4',
      choices: [
        {
          message: {
            role: 'assistant',
            content: 'OpenTelemetry provides several benefits for workflow monitoring:\n\n1. Standardized observability: It offers a unified framework for metrics, logs, and traces.\n2. Distributed tracing: Track requests across multiple services and components.\n3. Vendor-neutral: Not tied to specific monitoring tools.\n4. Reduced instrumentation effort: Automatic instrumentation for many frameworks.\n5. Context propagation: Maintain context across asynchronous boundaries.\n6. Correlation: Connect related events across your system.\n7. Performance insights: Identify bottlenecks and optimization opportunities.\n8. Troubleshooting: Faster root cause analysis for issues.\n9. Scalability: Designed for high-throughput systems.\n10. Open standards: Community-driven development ensures broad compatibility.'
          },
          finish_reason: 'stop',
          index: 0
        }
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 150,
        total_tokens: 160
      }
    };
    
    openAiNodeSpan.setAttribute('n8n.node.output_json', JSON.stringify([{ json: aiOutput }]));
    openAiNodeSpan.setAttribute('n8n.node.ai_output.message_role', 'assistant');
    openAiNodeSpan.setAttribute('n8n.node.ai_output.message_content', aiOutput.choices[0].message.content);
    openAiNodeSpan.setAttribute('n8n.node.ai_output.finish_reason', 'stop');
    openAiNodeSpan.setAttribute('n8n.node.ai_metrics.prompt_tokens', 10);
    openAiNodeSpan.setAttribute('n8n.node.ai_metrics.completion_tokens', 150);
    openAiNodeSpan.setAttribute('n8n.node.ai_metrics.total_tokens', 160);
    
    // End the OpenAI node span
    openAiNodeSpan.end();
    
    // Create a node span for an "HTTP Request" node
    const httpNodeSpan = tracer.startSpan('n8n.node.execute', {
      attributes: {
        'n8n.node.name': 'HTTP Request',
        'n8n.node.type': 'n8n-nodes-base.httpRequest',
        'n8n.node.is_ai': false,
        'n8n.node.parameter.url': 'https://jsonplaceholder.typicode.com/posts/1',
        'n8n.node.parameter.method': 'GET',
        'n8n.node.parameter.authentication': 'none'
      },
      kind: SpanKind.INTERNAL
    });
    
    // Simulate node execution
    await new Promise(resolve => setTimeout(resolve, 200));
    
    // Add output to the HTTP node
    const httpOutput = {
      userId: 1,
      id: 1,
      title: 'sunt aut facere repellat provident occaecati excepturi optio reprehenderit',
      body: 'quia et suscipit\nsuscipit recusandae consequuntur expedita et cum\nreprehenderit molestiae ut ut quas totam\nnostrum rerum est autem sunt rem eveniet architecto'
    };
    
    httpNodeSpan.setAttribute('n8n.node.output_json', JSON.stringify([{ json: httpOutput }]));
    
    // End the HTTP node span
    httpNodeSpan.end();
  });
  
  // End the workflow span
  workflowSpan.end();
  
  console.log('Test workflow execution completed');
  
  // Get the finished spans from memory exporter
  const finishedSpans = memoryExporter.getFinishedSpans();
  console.log(`Collected ${finishedSpans.length} spans`);
  
  // Export the spans using our debug exporter
  return new Promise((resolve, reject) => {
    debugExporter.export(finishedSpans, (result) => {
      if (result.code === 0) {
        console.log('Successfully exported spans to debug endpoint');
        resolve();
      } else {
        console.error('Failed to export spans:', result.error);
        reject(result.error);
      }
    });
  });
}

// Run the test
console.log('Starting test...');
console.log('Make sure the debug endpoint server is running (node otel-debug-endpoint.js)');

runTestWorkflow()
  .then(() => {
    console.log('Test completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Test failed:', error);
    process.exit(1);
  });
