#!/usr/bin/env node

/**
 * Test script to verify that all nodes (both AI and non-AI) are included in the LangWatch traces
 * This script loads a real trace file and processes it with our modified exporter
 */

// Load environment variables from .env file
require('dotenv').config();

// Import the modified LangWatch exporter
const LangWatchExporter = require('./langwatch-exporter-all-nodes');
const fs = require('fs');
const path = require('path');
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

// Function to load and process a trace file
async function processTraceFile(filePath) {
  logger.info(`\nProcessing trace file: ${filePath}`);
  
  try {
    // Read the trace file
    const traceData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    logger.info(`Loaded trace with ID: ${traceData.trace_id}`);
    logger.info(`Number of spans: ${traceData.spans.length}`);
    
    // Create mock spans from the trace data
    const mockSpans = traceData.spans.map(span => ({
      spanContext: () => ({ traceId: span.trace_id, spanId: span.span_id }),
      name: span.name,
      kind: span.kind,
      startTime: span.start_time,
      endTime: span.end_time,
      status: span.status || { code: 0 },
      attributes: span.attributes || {},
      parentSpanId: span.parent_span_id,
      events: [],
      links: []
    }));
    
    // Count node spans
    const nodeSpans = mockSpans.filter(span => span.name === "n8n.node.execute");
    logger.info(`Found ${nodeSpans.length} node spans`);
    
    // Count AI node spans
    const aiNodeSpans = nodeSpans.filter(span => {
      const attributes = span.attributes || {};
      return attributes["n8n.node.is_ai"] === true;
    });
    logger.info(`Found ${aiNodeSpans.length} AI node spans`);
    logger.info(`Found ${nodeSpans.length - aiNodeSpans.length} non-AI node spans`);
    
    // Process the spans with our exporter
    logger.info('\nConverting spans to LangWatch format...');
    const result = exporter._convertSpansToLangWatchFormat(mockSpans);
    
    // Analyze the result
    if (result && result.spans) {
      logger.info(`Converted ${result.spans.length} spans for LangWatch`);
      
      // Count AI spans vs non-AI spans
      const aiSpans = result.spans.filter(span => span.type === "llm" || span.type === "rag");
      const nonAiSpans = result.spans.filter(span => span.type === "custom");
      
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
        logger.info('- input:', aiSpan.input ? JSON.stringify(aiSpan.input).substring(0, 100) + '...' : 'Not set');
        logger.info('- output:', aiSpan.output ? JSON.stringify(aiSpan.output).substring(0, 100) + '...' : 'Not set');
      }
      
      // Print details of a non-AI span if available
      if (nonAiSpans.length > 0) {
        const nonAiSpan = nonAiSpans[0];
        logger.info('\nNon-AI Span Details:');
        logger.info('- name:', nonAiSpan.name);
        logger.info('- type:', nonAiSpan.type);
        logger.info('- params:', nonAiSpan.params ? JSON.stringify(nonAiSpan.params).substring(0, 100) + '...' : 'Not set');
        logger.info('- input:', nonAiSpan.input ? JSON.stringify(nonAiSpan.input).substring(0, 100) + '...' : 'Not set');
        logger.info('- output:', nonAiSpan.output ? JSON.stringify(nonAiSpan.output).substring(0, 100) + '...' : 'Not set');
      }
      
      // Optionally send to LangWatch if API key is provided
      if (process.env.LANGWATCH_API_KEY) {
        logger.info('\nSending trace to LangWatch...');
        
        return new Promise((resolve, reject) => {
          exporter._sendToLangWatch(result, (sendResult) => {
            if (sendResult.code === 0) { // SUCCESS
              logger.info("Trace sent successfully to LangWatch!");
              resolve(true);
            } else {
              logger.error("Error sending trace to LangWatch:", sendResult.error);
              reject(sendResult.error);
            }
          });
        });
      } else {
        logger.info('\nSkipping sending to LangWatch (no API key provided)');
        return true;
      }
    } else {
      logger.error('No spans in conversion result!');
      return false;
    }
  } catch (error) {
    logger.error('Error processing trace file:', error);
    return false;
  }
}

// Main function to process trace files
async function main() {
  try {
    // Get the trace file path from command line arguments or use default
    const traceFilePath = process.argv[2] || path.join(__dirname, 'otel_logs', 'otel_trace_2025-04-25T16-39-05-272Z.json');
    
    // Process the trace file
    await processTraceFile(traceFilePath);
    
    logger.info('\nTest completed successfully!');
  } catch (error) {
    logger.error('Test failed:', error);
    process.exit(1);
  }
}

// Run the main function
main();
