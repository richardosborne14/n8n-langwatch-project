"use strict";

// Load environment variables from .env file
require('dotenv').config();

// Import the LangWatch exporter
const LangWatchExporter = require('./langwatch-exporter');
const fs = require('fs');
const path = require('path');

// Create a mock logger that captures logs
const mockLogger = {
  logs: [],
  info: function(msg) { this.logs.push(`[INFO] ${msg}`); console.log(`[INFO] ${msg}`); },
  warn: function(msg) { this.logs.push(`[WARN] ${msg}`); console.log(`[WARN] ${msg}`); },
  error: function(msg, err) { this.logs.push(`[ERROR] ${msg} ${err ? err.toString() : ''}`); console.error(`[ERROR] ${msg}`, err); },
  debug: function(msg) { this.logs.push(`[DEBUG] ${msg}`); console.log(`[DEBUG] ${msg}`); }
};

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

// Load a real trace from the otel_logs directory
const traceFilePath = path.join(__dirname, 'otel_logs', 'otel_trace_2025-04-25T14-03-44-171Z.json');
console.log(`\nLoading trace from ${traceFilePath}`);

try {
  const traceData = JSON.parse(fs.readFileSync(traceFilePath, 'utf8'));
  console.log(`Loaded trace with ID: ${traceData.trace_id}`);
  console.log(`Number of spans: ${traceData.spans.length}`);
  
  // Find the AI node span
  const aiNodeSpan = traceData.spans.find(span => 
    span.name === "n8n.node.execute" && 
    span.attributes && 
    span.attributes["n8n.node.is_ai"] === true
  );
  
  if (aiNodeSpan) {
    console.log('\nFound AI node span:');
    console.log(`- Name: ${aiNodeSpan.attributes["n8n.node.name"]}`);
    console.log(`- Type: ${aiNodeSpan.attributes["n8n.node.type"]}`);
    console.log(`- Output: ${aiNodeSpan.attributes["n8n.node.ai_output.output"]}`);
    
    // Create a mock span that mimics the OpenTelemetry span structure
    const mockSpan = {
      spanContext: () => ({ traceId: aiNodeSpan.trace_id, spanId: aiNodeSpan.span_id }),
      name: aiNodeSpan.name,
      kind: aiNodeSpan.kind,
      startTime: aiNodeSpan.start_time,
      endTime: aiNodeSpan.end_time,
      status: aiNodeSpan.status,
      attributes: aiNodeSpan.attributes,
      parentSpanId: aiNodeSpan.parent_span_id,
      events: [],
      links: []
    };
    
    // Find the workflow span
    const workflowSpan = traceData.spans.find(span => 
      span.name === "n8n.workflow.execute"
    );
    
    if (workflowSpan) {
      const mockWorkflowSpan = {
        spanContext: () => ({ traceId: workflowSpan.trace_id, spanId: workflowSpan.span_id }),
        name: workflowSpan.name,
        kind: workflowSpan.kind,
        startTime: workflowSpan.start_time,
        endTime: workflowSpan.end_time,
        status: workflowSpan.status,
        attributes: workflowSpan.attributes,
        parentSpanId: workflowSpan.parent_span_id,
        events: [],
        links: []
      };
      
      // Create mock spans for all nodes in the workflow
      const allNodeSpans = traceData.spans.filter(span => 
        span.name === "n8n.node.execute" && 
        span.attributes?.["n8n.workflow.id"] === workflowSpan.attributes?.["n8n.workflow.id"]
      );
      
      const mockNodeSpans = allNodeSpans.map(nodeSpan => ({
        spanContext: () => ({ traceId: nodeSpan.trace_id, spanId: nodeSpan.span_id }),
        name: nodeSpan.name,
        kind: nodeSpan.kind,
        startTime: nodeSpan.start_time,
        endTime: nodeSpan.end_time,
        status: nodeSpan.status,
        attributes: nodeSpan.attributes,
        parentSpanId: nodeSpan.parent_span_id,
        events: [],
        links: []
      }));
      
      // Add the workflow span
      const mockSpans = [...mockNodeSpans, mockWorkflowSpan];
      
      // Test the conversion function with all the mock spans
      console.log('\nTesting LangWatch exporter conversion with real trace data...');
      console.log(`Including ${mockNodeSpans.length} node spans from the workflow`);
      const result = exporter._convertSpansToLangWatchFormat(mockSpans);
      
      console.log('\nConversion Result:');
      console.log(JSON.stringify(result, null, 2));
      
      // Verify the result
      if (result && result.spans && result.spans.length > 0) {
        console.log(`\nConverted ${result.spans.length} spans for LangWatch`);
        
        // Count AI spans vs non-AI spans
        const aiSpans = result.spans.filter(span => span.type === "llm" || span.type === "rag");
        const nonAiSpans = result.spans.filter(span => span.type === "custom");
        
        console.log(`- AI spans: ${aiSpans.length}`);
        console.log(`- Non-AI spans: ${nonAiSpans.length}`);
        
        // Print details of the AI span
        if (aiSpans.length > 0) {
          const aiSpan = aiSpans[0];
          console.log('\nAI Span Details:');
          console.log('- name:', aiSpan.name);
          console.log('- type:', aiSpan.type);
          console.log('- vendor:', aiSpan.vendor);
          console.log('- model:', aiSpan.model);
          console.log('- input:', aiSpan.input ? JSON.stringify(aiSpan.input) : 'Not set');
          console.log('- output:', aiSpan.output ? JSON.stringify(aiSpan.output) : 'Not set');
          console.log('- metrics:', aiSpan.metrics ? JSON.stringify(aiSpan.metrics) : 'Not set');
        }
        
        // Print details of a non-AI span if available
        if (nonAiSpans.length > 0) {
          const nonAiSpan = nonAiSpans[0];
          console.log('\nNon-AI Span Details:');
          console.log('- name:', nonAiSpan.name);
          console.log('- type:', nonAiSpan.type);
          console.log('- params:', nonAiSpan.params ? JSON.stringify(nonAiSpan.params) : 'Not set');
        }
      } else {
        console.error('No spans in conversion result!');
      }
      
      // Now test sending to LangWatch
      console.log('\nTesting sending the converted trace to LangWatch...');
      
      new Promise((resolve, reject) => {
        exporter._sendToLangWatch(result, (sendResult) => {
          if (sendResult.code === 0) { // SUCCESS
            resolve();
          } else {
            reject(sendResult.error);
          }
        });
      })
      .then(() => {
        console.log("Trace sent successfully to LangWatch!");
      })
      .catch(error => {
        console.error("Error sending trace to LangWatch:", error);
      });
    } else {
      console.error('No workflow span found in the trace!');
    }
  } else {
    console.error('No AI node span found in the trace!');
  }
} catch (error) {
  console.error('Error loading or processing trace:', error);
}
