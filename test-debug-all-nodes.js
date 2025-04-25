#!/usr/bin/env node

/**
 * Test script to verify that all nodes are included in the OpenTelemetry traces
 * This script sets up the environment to use the debug exporter and runs a simulated workflow
 */

// Set environment variables for testing
process.env.USE_DEBUG_EXPORTER = 'true';
process.env.DEBUG_ENDPOINT = 'http://localhost:3000/debug-otel';
process.env.LANGWATCH_LOG_LEVEL = 'debug';

// Load the tracing module which will set up the OpenTelemetry SDK
require('./tracing');

const { trace, context, SpanStatusCode, SpanKind } = require('@opentelemetry/api');
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
  
  // Wait a bit to ensure all spans are exported
  setTimeout(() => {
    logger.info('Test completed. Check the debug endpoint logs for the trace data.');
    process.exit(0);
  }, 5000);
  
} catch (error) {
  logger.error('Error creating test spans:', error);
  process.exit(1);
}
