"use strict";

const { ExportResult } = require('@opentelemetry/core');
const { hrTimeToMilliseconds } = require('@opentelemetry/core');
const https = require('https');
const http = require('http');
const { trace, context, SpanStatusCode } = require('@opentelemetry/api');

/**
 * LangWatch Exporter for OpenTelemetry that sends n8n workflow traces to LangWatch
 */
class LangWatchExporter {
  /**
   * Constructor
   * @param {Object} config - Configuration object
   * @param {string} config.apiKey - LangWatch API key
   * @param {string} config.endpoint - LangWatch endpoint URL
   * @param {string} config.serviceName - Service name to report
   * @param {Object} config.logger - Logger instance
   */
  constructor(config = {}) {
    this.apiKey = config.apiKey || process.env.LANGWATCH_API_KEY;
    this.endpoint = config.endpoint || process.env.LANGWATCH_ENDPOINT || 'https://app.langwatch.ai';
    this.collectorUrl = `${this.endpoint}/api/collector`;
    this.serviceName = config.serviceName || process.env.OTEL_SERVICE_NAME || 'n8n';
    this.logger = config.logger || console;
    this.pendingRequests = new Set();
    
    // Log configuration
    this.logger.info(`LangWatch exporter configured with endpoint: ${this.endpoint}`);
    this.logger.info(`API key ${this.apiKey ? 'is set' : 'is NOT set'}`);
    
    if (!this.apiKey) {
      this.logger.warn('LANGWATCH_API_KEY is not set. LangWatch exporter will not send data.');
    }
  }

  /**
   * Export spans to LangWatch
   * @param {ReadableSpan[]} spans - Array of finalized spans to export
   * @param {Function} resultCallback - Callback function to report success/failure
   */
  export(spans, resultCallback) {
    if (!this.apiKey) {
      return resultCallback({ code: ExportResult.SUCCESS });
    }

    try {
      // Group spans by trace ID
      const traceGroups = this.groupSpansByTrace(spans);
      
      // Process each trace group
      for (const [traceId, traceSpans] of Object.entries(traceGroups)) {
        this.processTraceGroup(traceId, traceSpans);
      }
      
      resultCallback({ code: ExportResult.SUCCESS });
    } catch (error) {
      this.logger.error('Error exporting spans to LangWatch:', error);
      resultCallback({ code: ExportResult.FAILED, error });
    }
  }

  /**
   * Force flush any pending exports
   * @returns {Promise<void>}
   */
  forceFlush() {
    return Promise.resolve();
  }

  /**
   * Shutdown the exporter
   * @returns {Promise<void>}
   */
  async shutdown() {
    this.logger.info('Shutting down LangWatch exporter...');
    
    // Wait for all pending requests to complete
    if (this.pendingRequests.size > 0) {
      this.logger.info(`Waiting for ${this.pendingRequests.size} pending requests...`);
      await Promise.all([...this.pendingRequests]);
    }
    
    this.logger.info('LangWatch exporter shutdown complete.');
    return Promise.resolve();
  }

  /**
   * Group spans by their trace ID
   * @private
   * @param {ReadableSpan[]} spans - Array of spans
   * @returns {Object} - Object with trace IDs as keys and arrays of spans as values
   */
  groupSpansByTrace(spans) {
    const traceGroups = {};
    
    for (const span of spans) {
      const traceId = span.spanContext().traceId;
      if (!traceGroups[traceId]) {
        traceGroups[traceId] = [];
      }
      traceGroups[traceId].push(span);
    }
    
    return traceGroups;
  }

  /**
   * Process a group of spans belonging to the same trace
   * @private
   * @param {string} traceId - Trace ID
   * @param {ReadableSpan[]} spans - Array of spans belonging to the trace
   */
  processTraceGroup(traceId, spans) {
    try {
      // Find workflow span (root span)
      const workflowSpan = spans.find(span => 
        span.name === 'n8n.workflow.execute' || 
        span.attributes['n8n.workflow.id']
      );
      
      if (!workflowSpan) {
        this.logger.debug(`No workflow span found for trace ${traceId}`);
        return;
      }
      
      // Extract workflow metadata
      const workflowId = workflowSpan.attributes['n8n.workflow.id'] || 'unknown';
      const workflowName = workflowSpan.attributes['n8n.workflow.name'] || 'Unknown Workflow';
      
      // Find AI-related node spans
      const aiSpans = this.findAISpans(spans);
      
      if (aiSpans.length === 0) {
        this.logger.debug(`No AI-related spans found for workflow ${workflowName} (${workflowId})`);
        return;
      }
      
      this.logger.info(`Found ${aiSpans.length} AI-related spans in workflow ${workflowName}`);
      
      // Process each AI span and send to LangWatch
      for (const span of aiSpans) {
        this.sendAISpanToLangWatch(traceId, workflowSpan, span);
      }
    } catch (error) {
      this.logger.error(`Error processing trace group ${traceId}:`, error);
    }
  }

  /**
   * Find AI-related spans in a collection of spans
   * @private
   * @param {ReadableSpan[]} spans - Array of spans
   * @returns {ReadableSpan[]} - Array of AI-related spans
   */
  findAISpans(spans) {
    // List of AI node types to look for
    const aiNodeTypes = [
      'n8n-nodes-base.openAi',
      'n8n-nodes-base.anthropic',
      'n8n-nodes-base.claude',
      'n8n-nodes-base.gpt',
      'n8n-nodes-base.llm',
      'n8n-nodes-base.chatModel',
      'n8n-nodes-base.textGeneration',
      'n8n-nodes-base.gemini',
      'n8n-nodes-base.mistral',
      'n8n-nodes-base.huggingFace',
      // Add other AI node types as needed
    ];
    
    return spans.filter(span => {
      // Check if it's a node execution span
      if (span.name !== 'n8n.node.execute') {
        return false;
      }
      
      // Check if it's an AI node type
      const nodeType = span.attributes['n8n.node.type'];
      if (aiNodeTypes.includes(nodeType)) {
        return true;
      }
      
      // Check node name for common AI keywords
      const nodeName = span.attributes['n8n.node.name'] || '';
      const aiKeywords = ['openai', 'gpt', 'claude', 'anthropic', 'llm', 'chatgpt', 'completion', 'chat', 'ai', 'generative'];
      
      return aiKeywords.some(keyword => 
        nodeName.toLowerCase().includes(keyword.toLowerCase())
      );
    });
  }

  /**
   * Send an AI-related span to LangWatch
   * @private
   * @param {string} traceId - Trace ID
   * @param {ReadableSpan} workflowSpan - Workflow span
   * @param {ReadableSpan} aiSpan - AI-related span
   */
  sendAISpanToLangWatch(traceId, workflowSpan, aiSpan) {
    try {
      // Extract node information
      const nodeName = aiSpan.attributes['n8n.node.name'] || 'Unknown Node';
      const nodeType = aiSpan.attributes['n8n.node.type'] || 'unknown';
      
      // Extract output JSON
      let inputData = {};
      let outputData = {};
      
      try {
        const outputJsonStr = aiSpan.attributes['n8n.node.output_json'];
        if (outputJsonStr) {
          outputData = JSON.parse(outputJsonStr);
        }
      } catch (error) {
        this.logger.warn(`Error parsing output JSON for node ${nodeName}:`, error);
      }
      
      // Determine AI vendor and model based on node type
      const { vendor, model } = this.identifyAIVendorAndModel(nodeType, aiSpan.attributes);
      
      // Extract timestamps
      const startedAt = hrTimeToMilliseconds(aiSpan.startTime);
      const finishedAt = hrTimeToMilliseconds(aiSpan.endTime);
      
      // Create LangWatch trace
      const langWatchTrace = {
        trace_id: traceId,
        spans: [
          {
            type: "llm",
            span_id: aiSpan.spanContext().spanId,
            vendor: vendor,
            model: model,
            input: {
              type: "text",
              value: this.extractInputText(outputData)
            },
            output: {
              type: "text",
              value: this.extractOutputText(outputData)
            },
            timestamps: {
              started_at: Math.floor(startedAt),
              finished_at: Math.floor(finishedAt)
            }
          }
        ],
        metadata: {
          user_id: workflowSpan.attributes['n8n.execution.userId'] || 'system',
          thread_id: workflowSpan.attributes['n8n.workflow.id'] || traceId,
          customer_id: this.serviceName,
          labels: [
            `workflow:${workflowSpan.attributes['n8n.workflow.id']}`,
            `node:${nodeName}`,
            `node_type:${nodeType}`
          ]
        }
      };
      
      // Send to LangWatch
      this.sendToLangWatch(langWatchTrace);
    } catch (error) {
      this.logger.error(`Error processing AI span for LangWatch:`, error);
    }
  }

  /**
   * Identify AI vendor and model from node type and attributes
   * @private
   * @param {string} nodeType - n8n node type
   * @param {Object} attributes - Span attributes
   * @returns {Object} - Object with vendor and model properties
   */
  identifyAIVendorAndModel(nodeType, attributes) {
    // Default values
    let vendor = 'unknown';
    let model = 'unknown';
    
    // Extract from node type
    if (nodeType.includes('openAi')) {
      vendor = 'openai';
      model = attributes['n8n.node.parameters.model'] || 'gpt-3.5-turbo';
    } else if (nodeType.includes('anthropic') || nodeType.includes('claude')) {
      vendor = 'anthropic';
      model = attributes['n8n.node.parameters.model'] || 'claude-2';
    } else if (nodeType.includes('gemini')) {
      vendor = 'google';
      model = attributes['n8n.node.parameters.model'] || 'gemini-pro';
    } else if (nodeType.includes('mistral')) {
      vendor = 'mistral';
      model = attributes['n8n.node.parameters.model'] || 'mistral-medium';
    } else if (nodeType.includes('huggingFace')) {
      vendor = 'huggingface';
      model = attributes['n8n.node.parameters.model'] || 'unknown';
    }
    
    return { vendor, model };
  }

  /**
   * Extract input text from node output data
   * @private
   * @param {Object} outputData - Node output data
   * @returns {string} - Extracted input text
   */
  extractInputText(outputData) {
    try {
      // Different nodes may store prompt/input in different places
      // This is a best-effort extraction
      
      if (Array.isArray(outputData)) {
        const firstItem = outputData[0] || {};
        
        // Common locations for prompt/input
        return firstItem.prompt || 
               firstItem.input || 
               firstItem.query ||
               firstItem.message ||
               firstItem.messages?.map(m => `${m.role}: ${m.content}`).join('\n') ||
               JSON.stringify(firstItem);
      }
      
      return JSON.stringify(outputData);
    } catch (error) {
      this.logger.warn('Error extracting input text:', error);
      return 'Error extracting input text';
    }
  }

  /**
   * Extract output text from node output data
   * @private
   * @param {Object} outputData - Node output data
   * @returns {string} - Extracted output text
   */
  extractOutputText(outputData) {
    try {
      // Different nodes may store completion/output in different places
      // This is a best-effort extraction
      
      if (Array.isArray(outputData)) {
        const firstItem = outputData[0] || {};
        
        // Common locations for completion/output
        return firstItem.response || 
               firstItem.output || 
               firstItem.completion || 
               firstItem.content ||
               firstItem.text ||
               firstItem.answer ||
               firstItem.result ||
               JSON.stringify(firstItem);
      }
      
      return JSON.stringify(outputData);
    } catch (error) {
      this.logger.warn('Error extracting output text:', error);
      return 'Error extracting output text';
    }
  }

  /**
   * Send trace data to LangWatch API
   * @private
   * @param {Object} trace - LangWatch trace data
   */
  sendToLangWatch(trace) {
    if (!this.apiKey) {
      this.logger.warn('Cannot send trace to LangWatch: API key is not set');
      return;
    }
    
    const payload = JSON.stringify(trace);
    
    const requestPromise = new Promise((resolve, reject) => {
      try {
        // Determine if we should use http or https
        const isHttps = this.endpoint.startsWith('https');
        const client = isHttps ? https : http;
        
        // Parse URL to get hostname, port, and path
        const url = new URL(this.collectorUrl);
        
        const options = {
          hostname: url.hostname,
          port: url.port || (isHttps ? 443 : 80),
          path: url.pathname,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
            'X-Auth-Token': this.apiKey
          }
        };
        
        this.logger.debug(`Sending trace ${trace.trace_id} to LangWatch`);
        
        const req = client.request(options, (res) => {
          let responseData = '';
          
          res.on('data', (chunk) => {
            responseData += chunk;
          });
          
          res.on('end', () => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              this.logger.debug(`Successfully sent trace ${trace.trace_id} to LangWatch`);
              resolve();
            } else {
              const error = new Error(`LangWatch API responded with status ${res.statusCode}: ${responseData}`);
              this.logger.error(error.message);
              reject(error);
            }
            
            this.pendingRequests.delete(requestPromise);
          });
        });
        
        req.on('error', (error) => {
          this.logger.error(`Error sending trace to LangWatch: ${error.message}`);
          reject(error);
          this.pendingRequests.delete(requestPromise);
        });
        
        req.write(payload);
        req.end();
        
        this.pendingRequests.add(requestPromise);
      } catch (error) {
        this.logger.error(`Exception sending trace to LangWatch: ${error.message}`);
        reject(error);
      }
    });
    
    return requestPromise;
  }
}

module.exports = LangWatchExporter;