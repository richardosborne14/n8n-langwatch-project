#!/usr/bin/env node

/**
 * Test script to simulate both AI and non-AI nodes and verify our exporter handles them correctly
 */

// Load environment variables from .env file
require('dotenv').config();

// Import the modified LangWatch exporter
const LangWatchExporter = require('./langwatch-exporter-all-nodes');
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

// Create the exporter with the API key from .env
const exporter = new LangWatchExporter({
  apiKey: process.env.LANGWATCH_API_KEY,
  endpoint: process.env.LANGWATCH_ENDPOINT || 'https://app.langwatch.ai',
  serviceName: 'n8n',
  logger: logger
});

// Print environment variables for debugging
logger.info('Environment variables:');
logger.info('- LANGWATCH_API_KEY:', process.env.LANGWATCH_API_KEY ? 'Set (value hidden)' : 'Not set');
logger.info('- LANGWATCH_ENDPOINT:', process.env.LANGWATCH_ENDPOINT || 'Not set (using default)');

// Create a mock trace ID
const traceId = 'test-trace-' + Date.now().toString(16);

// Create a mock workflow span
const workflowSpan = {
  spanContext: () => ({ traceId, spanId: 'workflow-span-id' }),
  name: 'n8n.workflow.execute',
  kind: 0, // INTERNAL
  startTime: [Math.floor(Date.now() / 1000), 0],
  endTime: [Math.floor(Date.now() / 1000) + 10, 0],
  status: { code: 0 },
  attributes: {
    'n8n.workflow.id': 'test-workflow-id',
    'n8n.workflow.name': 'Test Workflow',
    'n8n.workflow.settings.executionOrder': 'v1'
  },
  parentSpanId: null,
  events: [],
  links: []
};

// Create a mock AI node span
const aiNodeSpan = {
  spanContext: () => ({ traceId, spanId: 'ai-node-span-id' }),
  name: 'n8n.node.execute',
  kind: 0, // INTERNAL
  startTime: [Math.floor(Date.now() / 1000), 0],
  endTime: [Math.floor(Date.now() / 1000) + 5, 0],
  status: { code: 0 },
  attributes: {
    'n8n.workflow.id': 'test-workflow-id',
    'n8n.execution.id': 'test-execution-id',
    'n8n.node.name': 'AI Assistant',
    'n8n.node.type': '@n8n/n8n-nodes-langchain.agent',
    'n8n.node.is_ai': true,
    'n8n.node.credentials': 'none',
    'n8n.node.include_in_trace': true,
    'n8n.node.parameter.model': 'gpt-4',
    'n8n.node.parameter.temperature': 0.7,
    'n8n.node.parameter.text': '{{ $json.question }}',
    'n8n.node.output_json': '[{"output":"This is a test AI response."}]',
    'n8n.node.output_count': 1,
    'n8n.node.output_type': 'object'
  },
  parentSpanId: 'workflow-span-id',
  events: [],
  links: []
};

// Create a mock non-AI node span (Calculator)
const calculatorNodeSpan = {
  spanContext: () => ({ traceId, spanId: 'calculator-node-span-id' }),
  name: 'n8n.node.execute',
  kind: 0, // INTERNAL
  startTime: [Math.floor(Date.now() / 1000), 0],
  endTime: [Math.floor(Date.now() / 1000) + 1, 0],
  status: { code: 0 },
  attributes: {
    'n8n.workflow.id': 'test-workflow-id',
    'n8n.execution.id': 'test-execution-id',
    'n8n.node.name': 'Calculator',
    'n8n.node.type': 'n8n-nodes-base.calculator',
    'n8n.node.is_ai': false,
    'n8n.node.credentials': 'none',
    'n8n.node.include_in_trace': true,
    'n8n.node.parameter.operation': 'multiply',
    'n8n.node.parameter.value1': 240,
    'n8n.node.parameter.value2': 30,
    'n8n.node.output_json': '[{"json":{"result":7200}}]',
    'n8n.node.output_count': 1,
    'n8n.node.output_type': 'object'
  },
  parentSpanId: 'workflow-span-id',
  events: [],
  links: []
};

// Create a mock HTTP node span
const httpNodeSpan = {
  spanContext: () => ({ traceId, spanId: 'http-node-span-id' }),
  name: 'n8n.node.execute',
  kind: 0, // INTERNAL
  startTime: [Math.floor(Date.now() / 1000), 0],
  endTime: [Math.floor(Date.now() / 1000) + 2, 0],
  status: { code: 0 },
  attributes: {
    'n8n.workflow.id': 'test-workflow-id',
    'n8n.execution.id': 'test-execution-id',
    'n8n.node.name': 'HTTP Request',
    'n8n.node.type': 'n8n-nodes-base.httpRequest',
    'n8n.node.is_ai': false,
    'n8n.node.credentials': 'none',
    'n8n.node.include_in_trace': true,
    'n8n.node.parameter.url': 'https://example.com/api',
    'n8n.node.parameter.method': 'GET',
    'n8n.node.output_json': '[{"json":{"status":"success","data":{"message":"API response"}}}]',
    'n8n.node.output_count': 1,
    'n8n.node.output_type': 'object'
  },
  parentSpanId: 'workflow-span-id',
  events: [],
  links: []
};

// Combine all spans
const mockSpans = [workflowSpan, aiNodeSpan, calculatorNodeSpan, httpNodeSpan];

// Process the spans with our exporter
logger.info('\nConverting simulated spans to LangWatch format...');
const result = exporter._convertSpansToLangWatchFormat(mockSpans);

// Analyze the result
if (result && result.spans) {
  logger.info(`Converted ${result.spans.length} spans for LangWatch`);
  
  // Count AI spans vs non-AI spans
  const aiSpans = result.spans.filter(span => span.type === "llm" || span.type === "rag");
  const nonAiSpans = result.spans.filter(span => span.type === "unknown");
  
  logger.info(`- AI spans: ${aiSpans.length}`);
  logger.info(`- Non-AI spans: ${nonAiSpans.length}`);
  
  // Print details of an AI span if available
  if (aiSpans.length > 0) {
    const aiSpan = aiSpans[0];
    logger.info('\nAI Span Details:');
    logger.info('- name:', aiSpan.name);
    logger.info('- type:', aiSpan.type);
    logger.info('- vendor:', aiSpan.vendor);
    logger.info('- model:', aiSpan.model);
    logger.info('- input:', aiSpan.input ? JSON.stringify(aiSpan.input) : 'Not set');
    logger.info('- output:', aiSpan.output ? JSON.stringify(aiSpan.output) : 'Not set');
    logger.info('- params:', aiSpan.params ? JSON.stringify(aiSpan.params) : 'Not set');
  }
  
  // Print details of non-AI spans
  if (nonAiSpans.length > 0) {
    // Print Calculator node details
    const calculatorSpan = nonAiSpans.find(span => span.name === 'Calculator');
    if (calculatorSpan) {
      logger.info('\nCalculator Span Details:');
      logger.info('- name:', calculatorSpan.name);
      logger.info('- type:', calculatorSpan.type);
      logger.info('- input:', calculatorSpan.input ? JSON.stringify(calculatorSpan.input) : 'Not set');
      logger.info('- output:', calculatorSpan.output ? JSON.stringify(calculatorSpan.output) : 'Not set');
      logger.info('- params:', calculatorSpan.params ? JSON.stringify(calculatorSpan.params) : 'Not set');
    }
    
    // Print HTTP node details
    const httpSpan = nonAiSpans.find(span => span.name === 'HTTP Request');
    if (httpSpan) {
      logger.info('\nHTTP Span Details:');
      logger.info('- name:', httpSpan.name);
      logger.info('- type:', httpSpan.type);
      logger.info('- input:', httpSpan.input ? JSON.stringify(httpSpan.input) : 'Not set');
      logger.info('- output:', httpSpan.output ? JSON.stringify(httpSpan.output) : 'Not set');
      logger.info('- params:', httpSpan.params ? JSON.stringify(httpSpan.params) : 'Not set');
    }
  }
  
  // Optionally send to LangWatch if API key is provided
  if (process.env.LANGWATCH_API_KEY) {
    logger.info('\nSending trace to LangWatch...');
    
    exporter._sendToLangWatch(result, (sendResult) => {
      if (sendResult.code === 0) { // SUCCESS
        logger.info("Trace sent successfully to LangWatch!");
      } else {
        logger.error("Error sending trace to LangWatch:", sendResult.error);
      }
    });
  } else {
    logger.info('\nSkipping sending to LangWatch (no API key provided)');
  }
} else {
  logger.error('No spans in conversion result!');
}
