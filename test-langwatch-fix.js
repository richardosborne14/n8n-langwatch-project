"use strict";

// Load environment variables from .env file
require('dotenv').config();

// Import the LangWatch exporter
const LangWatchExporter = require('./langwatch-exporter');

// Create a mock logger that captures logs
const mockLogger = {
  logs: [],
  info: function(msg) { this.logs.push(`[INFO] ${msg}`); console.log(`[INFO] ${msg}`); },
  warn: function(msg) { this.logs.push(`[WARN] ${msg}`); console.log(`[WARN] ${msg}`); },
  error: function(msg, err) { this.logs.push(`[ERROR] ${msg} ${err ? err.toString() : ''}`); console.error(`[ERROR] ${msg}`, err); },
  debug: function(msg) { this.logs.push(`[DEBUG] ${msg}`); console.log(`[DEBUG] ${msg}`); }
};

// Create a mock span with array-style timestamps
const mockSpan = {
  spanContext: () => ({ traceId: 'test-trace-id', spanId: 'test-span-id' }),
  name: 'n8n.node.execute',
  startTime: [1745585978, 554000000], // Array-style timestamp [seconds, nanoseconds]
  endTime: [1745585984, 337194878],   // Array-style timestamp [seconds, nanoseconds]
  status: { code: 0 },
  attributes: {
    'n8n.node.name': 'AI Agent',
    'n8n.node.type': '@n8n/n8n-nodes-langchain.agent',
    'n8n.node.is_ai': true,
    'n8n.workflow.id': 'test-workflow-id',
    'n8n.node.output_json': '[{"output":"This is a test output"}]',
    'n8n.node.parameter.model': 'gpt-4'
  }
};

// Create a mock RAG span to test the "rag" type
const mockRagSpan = {
  spanContext: () => ({ traceId: 'test-trace-id', spanId: 'test-rag-span-id' }),
  name: 'n8n.node.execute',
  startTime: [1745585978, 554000000],
  endTime: [1745585984, 337194878],
  status: { code: 0 },
  attributes: {
    'n8n.node.name': 'RAG Agent',
    'n8n.node.type': '@n8n/n8n-nodes-langchain.rag',
    'n8n.node.is_ai': true,
    'n8n.node.is_rag': true,
    'n8n.workflow.id': 'test-workflow-id',
    'n8n.node.output_json': '[{"output":"This is a RAG test output"}]',
    'n8n.node.parameter.model': 'gpt-4'
  }
};

// Test the conversion function with the mock spans
function testConversion() {
  console.log('Testing LangWatch exporter conversion...');
  
  // Test with regular LLM span
  const llmResult = exporter._convertSpansToLangWatchFormat([mockSpan]);
  console.log('\nLLM Span Conversion Result:');
  console.log(JSON.stringify(llmResult, null, 2));
  
  // Verify timestamps are numbers, not null
  const llmSpan = llmResult.spans[0];
  console.log('\nTimestamp verification (LLM):');
  console.log('- started_at is number:', typeof llmSpan.timestamps.started_at === 'number');
  console.log('- started_at value:', llmSpan.timestamps.started_at);
  console.log('- finished_at is number:', typeof llmSpan.timestamps.finished_at === 'number');
  console.log('- finished_at value:', llmSpan.timestamps.finished_at);
  console.log('- contexts exists:', llmSpan.contexts !== undefined);
  console.log('- type:', llmSpan.type);
  
  // Test with RAG span
  const ragResult = exporter._convertSpansToLangWatchFormat([mockRagSpan]);
  console.log('\nRAG Span Conversion Result:');
  console.log(JSON.stringify(ragResult, null, 2));
  
  // Verify RAG type and timestamps
  const ragSpan = ragResult.spans[0];
  console.log('\nTimestamp verification (RAG):');
  console.log('- started_at is number:', typeof ragSpan.timestamps.started_at === 'number');
  console.log('- started_at value:', ragSpan.timestamps.started_at);
  console.log('- finished_at is number:', typeof ragSpan.timestamps.finished_at === 'number');
  console.log('- finished_at value:', ragSpan.timestamps.finished_at);
  console.log('- contexts exists:', ragSpan.contexts !== undefined);
  console.log('- type:', ragSpan.type, '(should be "rag")');
}

// Create the exporter with the API key from .env
const exporter = new LangWatchExporter({
  apiKey: process.env.LANGWATCH_API_KEY,
  endpoint: process.env.LANGWATCH_ENDPOINT || 'https://app.langwatch.ai',
  serviceName: 'test-service',
  logger: mockLogger
});

// Print environment variables for debugging
console.log('Environment variables:');
console.log('- LANGWATCH_API_KEY:', process.env.LANGWATCH_API_KEY ? 'Set (value hidden)' : 'Not set');
console.log('- LANGWATCH_ENDPOINT:', process.env.LANGWATCH_ENDPOINT || 'Not set (using default)');

// Run the test
testConversion();

// Now test sending a real trace to LangWatch
console.log('\nTesting sending a trace to LangWatch...');

// Create a test trace in the format expected by LangWatch
const testTrace = {
  trace_id: "test-trace-" + Date.now(),
  spans: [
    {
      type: "llm",
      span_id: "span-" + Date.now(),
      vendor: "openai",
      model: "gpt-4",
      input: {
        type: "chat_messages",
        value: [
          {
            role: "user",
            content: "Write a short poem about automation."
          }
        ]
      },
      output: {
        type: "chat_messages",
        value: [
          {
            role: "assistant",
            content: "Silicon servants work with grace,\nAutomation sets the pace.\nTasks once manual, now set free,\nEfficiency's sweet symphony.",
            function_call: null,
            tool_calls: []
          }
        ]
      },
      params: {
        temperature: 0.7,
        stream: false
      },
      metrics: {
        prompt_tokens: 100,
        completion_tokens: 150,
        total_tokens: 250
      },
      timestamps: {
        started_at: Date.now() - 2000,
        finished_at: Date.now()
      }
    }
  ],
  metadata: {
    user_id: "test_user",
    thread_id: "test_thread",
    customer_id: "n8n_test",
    labels: [
      "test_label_1", 
      "test_label_2"
    ]
  }
};

// Send the test trace
new Promise((resolve, reject) => {
  exporter._sendToLangWatch(testTrace, (result) => {
    if (result.code === 0) { // SUCCESS
      resolve();
    } else {
      reject(result.error);
    }
  });
})
.then(() => {
  console.log("Test trace sent successfully!");
})
.catch(error => {
  console.error("Error sending test trace:", error);
});
