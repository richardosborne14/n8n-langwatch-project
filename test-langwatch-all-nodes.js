#!/usr/bin/env node

/**
 * Test script to verify that all nodes are included in the LangWatch traces
 * This script creates test spans for different node types and exports them
 */

const { trace, context, SpanStatusCode, SpanKind } = require('@opentelemetry/api');
const { BasicTracerProvider } = require('@opentelemetry/sdk-trace-base');
const { BatchSpanProcessor } = require('@opentelemetry/sdk-trace-base');
const winston = require('winston');

// Create a logger
const logger = winston.createLogger({
  level: 'debug',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(info => `${info.timestamp} [${info.level.toUpperCase()}] ${info.message}`)
  ),
  transports: [new winston.transports.Console()]
});

// Create a custom exporter that logs spans
class TestExporter {
  export(spans, resultCallback) {
    logger.info(`Exporting ${spans.length} spans`);
    
    spans.forEach((span, index) => {
      const attributes = span.attributes || {};
      logger.info(`Span ${index + 1}: ${span.name} - ${attributes['n8n.node.name'] || 'unknown'}`);
      
      // Log all attributes for debugging
      Object.entries(attributes).forEach(([key, value]) => {
        logger.debug(`  ${key}: ${value}`);
      });
    });
    
    resultCallback({ code: 0 }); // SUCCESS
  }
  
  shutdown() {
    logger.info('Shutting down exporter');
  }
}

// Set up the tracer provider
const provider = new BasicTracerProvider({
  resource: {
    'service.name': 'n8n-test',
    'service.version': '1.0.0',
  },
});

// Create and register the test exporter
const testExporter = new TestExporter();
const spanProcessor = new BatchSpanProcessor(testExporter);
provider.addSpanProcessor(spanProcessor);

// Register the provider
provider.register();

// Get a tracer
const tracer = trace.getTracer('test-all-nodes', '1.0.0');

logger.info('Creating test spans for all node types...');

// Create a workflow span
const workflowSpan = tracer.startSpan('n8n.workflow.execute', {
  attributes: {
    'n8n.workflow.id': 'test-workflow-123',
    'n8n.workflow.name': 'Test All Nodes Workflow',
    'n8n.workflow.settings.executionOrder': 'v1'
  },
  kind: SpanKind.INTERNAL
});

// Set the workflow span as active
const workflowContext = trace.setSpan(context.active(), workflowSpan);

// Function to create a node span
function createNodeSpan(nodeName, nodeType, isAi = false, outputData = null) {
  return context.with(workflowContext, () => {
    logger.info(`Creating span for node: ${nodeName} (${nodeType})`);
    
    const nodeSpan = tracer.startSpan('n8n.node.execute', {
      attributes: {
        'n8n.workflow.id': 'test-workflow-123',
        'n8n.execution.id': 'test-execution-123',
        'n8n.node.name': nodeName,
        'n8n.node.type': nodeType,
        'n8n.node.is_ai': isAi,
        'n8n.node.credentials': 'none',
        'n8n.node.include_in_trace': true
      },
      kind: SpanKind.INTERNAL
    });
    
    // Add output data if provided
    if (outputData) {
      nodeSpan.setAttribute('n8n.node.output_json', JSON.stringify(outputData));
      nodeSpan.setAttribute('n8n.node.output_count', outputData.length);
      nodeSpan.setAttribute('n8n.node.output_type', typeof outputData[0]);
    }
    
    // End the span
    nodeSpan.end();
    
    return nodeSpan;
  });
}

// Create spans for different node types
try {
  // Create a Chat node span
  createNodeSpan('Chat', 'n8n-nodes-base.chat', false, [
    { json: { message: "Hello, how can I help you?" } }
  ]);
  
  // Create a Memory node span
  createNodeSpan('Memory', 'n8n-nodes-base.memory', false, [
    { json: { history: ["Previous conversation history"] } }
  ]);
  
  // Create a Calculator node span
  createNodeSpan('Calculator', 'n8n-nodes-base.calculator', false, [
    { json: { result: 42 } }
  ]);
  
  // Create an OpenAI Chat Model node span
  createNodeSpan('OpenAI Chat Model', 'n8n-nodes-base.openAiChat', true, [
    { json: { 
      choices: [{ 
        message: { 
          role: "assistant", 
          content: "I'm an AI assistant. How can I help you today?" 
        },
        finish_reason: "stop"
      }],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 15,
        total_tokens: 25
      }
    }}
  ]);
  
  // Create an AI Agent node span
  createNodeSpan('AI Agent', '@n8n/n8n-nodes-langchain.agent', true, [
    { json: { output: "The answer to your question is 42." } }
  ]);
  
  // End the workflow span
  workflowSpan.end();
  
  logger.info('All test spans created successfully.');
  
  // Force the exporter to flush
  logger.info('Flushing spans to exporter...');
  spanProcessor.forceFlush().then(() => {
    logger.info('Spans flushed successfully.');
    
    // Shutdown the provider
    provider.shutdown().then(() => {
      logger.info('Provider shutdown successfully.');
      process.exit(0);
    });
  });
  
} catch (error) {
  logger.error('Error creating test spans:', error);
  process.exit(1);
}
