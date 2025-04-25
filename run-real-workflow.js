#!/usr/bin/env node

/**
 * This script runs a real workflow with different types of nodes
 * and captures all the traces in the otel_logs directory.
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
const tracer = trace.getTracer('real-workflow', '1.0.0');

logger.info('Creating a real workflow with different types of nodes...');

// Create a workflow span
const workflowSpan = tracer.startSpan('n8n.workflow.execute', {
  attributes: {
    'n8n.workflow.id': 'real-workflow-123',
    'n8n.workflow.name': 'Real Workflow With All Node Types',
    'n8n.workflow.settings.executionOrder': 'v1'
  },
  kind: SpanKind.INTERNAL
});

// Set the workflow span as active
const workflowContext = trace.setSpan(context.active(), workflowSpan);

// Function to create a node span
function createNodeSpan(nodeName, nodeType, isAi = false, parameters = {}, outputData = null) {
  return context.with(workflowContext, () => {
    logger.info(`Creating span for node: ${nodeName} (${nodeType})`);
    
    const nodeAttributes = {
      'n8n.workflow.id': 'real-workflow-123',
      'n8n.execution.id': 'real-execution-123',
      'n8n.node.name': nodeName,
      'n8n.node.type': nodeType,
      'n8n.node.is_ai': isAi,
      'n8n.node.credentials': 'none',
      'n8n.node.include_in_trace': true
    };
    
    // Add parameters as attributes
    Object.entries(parameters).forEach(([key, value]) => {
      nodeAttributes[`n8n.node.parameter.${key}`] = value;
    });
    
    const nodeSpan = tracer.startSpan('n8n.node.execute', {
      attributes: nodeAttributes,
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
  // Create a Start node span
  createNodeSpan('Start', 'n8n-nodes-base.start', false, {}, [
    { json: { started: true } }
  ]);
  
  // Create a Set node span
  createNodeSpan('Set', 'n8n-nodes-base.set', false, {
    values: [
      {
        name: 'question',
        value: 'What is the capital of France?'
      }
    ]
  }, [
    { json: { question: 'What is the capital of France?' } }
  ]);
  
  // Create a Function node span
  createNodeSpan('Function', 'n8n-nodes-base.function', false, {
    functionCode: 'return [{json: {processed: true, question: $input.first().json.question}}];'
  }, [
    { json: { processed: true, question: 'What is the capital of France?' } }
  ]);
  
  // Create a HTTP Request node span
  createNodeSpan('HTTP Request', 'n8n-nodes-base.httpRequest', false, {
    url: 'https://example.com/api',
    method: 'GET'
  }, [
    { json: { status: 'success', data: { message: 'API response' } } }
  ]);
  
  // Create a Split In Batches node span
  createNodeSpan('Split In Batches', 'n8n-nodes-base.splitInBatches', false, {
    batchSize: 1
  }, [
    { json: { processed: true, question: 'What is the capital of France?' } }
  ]);
  
  // Create a Calculator node span
  createNodeSpan('Calculator', 'n8n-nodes-base.calculator', false, {
    operation: 'multiply',
    value1: 240,
    value2: 30
  }, [
    { json: { result: 7200 } }
  ]);
  
  // Create an OpenAI Chat Model node span
  createNodeSpan('OpenAI Chat Model', 'n8n-nodes-base.openAiChat', true, {
    authentication: 'apiKey',
    model: 'gpt-4',
    messages: [
      {
        role: 'user',
        content: '{{$node["Set"].json.question}}'
      }
    ],
    options: {
      temperature: 0.7
    }
  }, [
    { json: { 
      choices: [{ 
        message: { 
          role: "assistant", 
          content: "The capital of France is Paris." 
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
  
  // Create a Memory node span
  createNodeSpan('Memory', 'n8n-nodes-base.memory', false, {
    operation: 'store',
    key: 'answer',
    value: '{{$node["OpenAI Chat Model"].json.choices[0].message.content}}'
  }, [
    { json: { success: true } }
  ]);
  
  // Create a Merge node span
  createNodeSpan('Merge', 'n8n-nodes-base.merge', false, {
    mode: 'append'
  }, [
    { json: { question: 'What is the capital of France?', answer: 'The capital of France is Paris.' } }
  ]);
  
  // End the workflow span
  workflowSpan.end();
  
  logger.info('Workflow execution completed successfully.');
  
  // Wait a bit to ensure all spans are exported
  setTimeout(() => {
    logger.info('All traces should now be available in the otel_logs directory.');
    logger.info('Check the latest otel_trace_*.json file for the complete workflow trace.');
    process.exit(0);
  }, 5000);
  
} catch (error) {
  logger.error('Error executing workflow:', error);
  process.exit(1);
}
