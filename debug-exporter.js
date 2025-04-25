"use strict";

const LangWatchExporter = require('./langwatch-exporter');
const http = require('http');
const https = require('https');
const winston = require('winston');

/**
 * Debug Exporter that extends LangWatch exporter to send complete span data to a debug endpoint
 */
class DebugExporter extends LangWatchExporter {
  /**
   * Constructor for the Debug exporter
   * @param {Object} config Configuration for the exporter
   * @param {string} config.apiKey The LangWatch API key
   * @param {string} [config.endpoint=https://app.langwatch.ai] The LangWatch endpoint
   * @param {string} [config.serviceName=n8n] The service name to use in traces
   * @param {Object} [config.logger] A logger instance to use
   * @param {string} [config.debugEndpoint=http://localhost:3000/debug-otel] The debug endpoint to send complete data to
   * @param {boolean} [config.sendToLangWatch=true] Whether to also send data to LangWatch
   */
  constructor(config = {}) {
    super(config);
    
    this.debugEndpoint = config.debugEndpoint || "http://localhost:3000/debug-otel";
    this.sendToLangWatch = config.sendToLangWatch !== false;
    
    // Create a dedicated logger for the debug exporter
    const logLevel = process.env.DEBUG_EXPORTER_LOG_LEVEL || "info";
    this.debugLogger = config.logger || winston.createLogger({
      level: logLevel,
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(info => `${info.timestamp} [DEBUG-EXPORTER] [${info.level.toUpperCase()}] ${info.message}`)
      ),
      transports: [new winston.transports.Console()]
    });
    
    this.debugLogger.info(`Debug exporter initialized with endpoint: ${this.debugEndpoint}`);
    this.debugLogger.info(`Will ${this.sendToLangWatch ? 'also send' : 'not send'} data to LangWatch`);
  }

  /**
   * Export spans to debug endpoint and optionally to LangWatch
   * @param {ReadableSpan[]} spans The spans to export
   * @param {Function} resultCallback Callback to be called after export
   */
  export(spans, resultCallback) {
    if (spans.length === 0) {
      this.debugLogger.debug("No spans to export");
      return resultCallback({ code: 0 }); // SUCCESS
    }

    try {
      // Send to debug endpoint first
      this._sendToDebugEndpoint(spans, (debugResult) => {
        // If we're not sending to LangWatch, we're done
        if (!this.sendToLangWatch || !this.apiKey) {
          return resultCallback(debugResult);
        }
        
      // Otherwise, also send to LangWatch
      try {
        // Log the spans we're about to convert for LangWatch
        this.debugLogger.debug(`Converting ${spans.length} spans for LangWatch`);
        
        // Check for AI node spans
        const aiNodeSpans = spans.filter(span => {
          const attributes = span.attributes || {};
          return (
            span.name === "n8n.node.execute" && 
            (attributes["n8n.node.is_ai"] === true || 
             attributes["n8n.node.type"]?.includes("openai") ||
             attributes["n8n.node.type"]?.includes("gpt") ||
             attributes["n8n.node.type"]?.includes("langchain") ||
             attributes["n8n.node.type"]?.includes("anthropic") ||
             attributes["n8n.node.type"]?.includes("claude") ||
             attributes["n8n.node.type"]?.includes("llm"))
          );
        });
        
        this.debugLogger.debug(`Found ${aiNodeSpans.length} AI node spans`);
        if (aiNodeSpans.length > 0) {
          aiNodeSpans.forEach((span, index) => {
            const attributes = span.attributes || {};
            this.debugLogger.debug(`AI span ${index + 1}: ${attributes["n8n.node.name"] || "unknown"} (${attributes["n8n.node.type"] || "unknown"})`);
          });
        }
        
        const traceData = this._convertSpansToLangWatchFormat(spans);
        if (traceData && traceData.spans && traceData.spans.length > 0) {
          this.debugLogger.debug(`Sending ${traceData.spans.length} spans to LangWatch`);
          this._sendToLangWatch(traceData, resultCallback);
        } else {
          this.debugLogger.debug("No spans to send to LangWatch after conversion");
          resultCallback({ code: 0 }); // SUCCESS
        }
      } catch (error) {
        this.debugLogger.error("Error converting or sending spans to LangWatch:", error);
        resultCallback({ code: 1, error }); // FAILED
      }
      });
    } catch (error) {
      this.debugLogger.error("Error sending spans to debug endpoint:", error);
      resultCallback({ code: 1, error }); // FAILED
    }
  }

  /**
   * Send raw span data to debug endpoint
   * @private
   * @param {ReadableSpan[]} spans The spans to send
   * @param {Function} resultCallback Callback to be called after sending
   */
  _sendToDebugEndpoint(spans, resultCallback) {
    try {
      // Create a more complete trace object with all available data
      const completeTraceData = this._createCompleteTraceData(spans);
      
      // Convert to JSON
      const payload = JSON.stringify(completeTraceData);
      
      // Parse the debug endpoint URL
      const url = new URL(this.debugEndpoint);
      
      // Prepare request options
      const options = {
        hostname: url.hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: url.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload)
        }
      };
      
      // Choose http or https client based on protocol
      const client = url.protocol === "https:" ? https : http;
      
      // Send the request
      const req = client.request(options, (res) => {
        let responseData = "";
        
        res.on("data", (chunk) => {
          responseData += chunk;
        });
        
        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            this.debugLogger.info(`Successfully sent ${spans.length} spans to debug endpoint`);
            resultCallback({ code: 0 }); // SUCCESS
          } else {
            this.debugLogger.error(`Error sending spans to debug endpoint: ${res.statusCode} - ${responseData}`);
            resultCallback({ 
              code: 1, // FAILED
              error: new Error(`HTTP error ${res.statusCode}: ${responseData}`) 
            });
          }
        });
      });
      
      req.on("error", (error) => {
        this.debugLogger.error("Error sending spans to debug endpoint:", error);
        resultCallback({ code: 1, error }); // FAILED
      });
      
      req.write(payload);
      req.end();
    } catch (error) {
      this.debugLogger.error("Error preparing data for debug endpoint:", error);
      resultCallback({ code: 1, error }); // FAILED
    }
  }

  /**
   * Create a complete trace data object with all available information
   * @private
   * @param {ReadableSpan[]} spans The spans to convert
   * @returns {Object} The complete trace data
   */
  _createCompleteTraceData(spans) {
    if (spans.length === 0) return null;

    // Use the first span's trace ID as the trace ID for the entire batch
    const traceId = spans[0].spanContext().traceId;
    
    // Find workflow execution spans and node execution spans
    const workflowSpans = spans.filter(span => span.name === 'n8n.workflow.execute');
    const nodeSpans = spans.filter(span => span.name === 'n8n.node.execute');
    
    // Organize spans by their relationships
    const spanMap = new Map();
    const spanRelationships = new Map();
    
    // First, map all spans by their ID for easy lookup
    spans.forEach(span => {
      spanMap.set(span.spanContext().spanId, span);
    });
    
    // Then, build parent-child relationships
    spans.forEach(span => {
      if (span.parentSpanId) {
        if (!spanRelationships.has(span.parentSpanId)) {
          spanRelationships.set(span.parentSpanId, []);
        }
        spanRelationships.get(span.parentSpanId).push(span.spanContext().spanId);
      }
    });
    
    // Convert spans to a more complete format with enhanced details
    const convertedSpans = spans.map(span => {
      // Extract all span data
      const spanData = {
        span_id: span.spanContext().spanId,
        parent_span_id: span.parentSpanId,
        trace_id: span.spanContext().traceId,
        name: span.name,
        kind: span.kind,
        start_time: span.startTime,
        end_time: span.endTime,
        duration_ms: (span.endTime - span.startTime) / 1000000, // Convert to milliseconds
        status: span.status,
        attributes: this._flattenAttributes(span.attributes || {}),
        events: span.events || [],
        links: span.links || []
      };
      
      // Add child span IDs if any
      const childSpanIds = spanRelationships.get(span.spanContext().spanId);
      if (childSpanIds && childSpanIds.length > 0) {
        spanData.child_spans = childSpanIds;
      }
      
      // Enhanced data for workflow spans
      if (span.name === 'n8n.workflow.execute') {
        spanData.workflow_data = {
          id: span.attributes?.["n8n.workflow.id"] || "unknown",
          name: span.attributes?.["n8n.workflow.name"] || "unknown",
          settings: Object.entries(span.attributes || {})
            .filter(([key]) => key.startsWith('n8n.workflow.settings.'))
            .reduce((acc, [key, value]) => {
              acc[key.replace('n8n.workflow.settings.', '')] = value;
              return acc;
            }, {})
        };
      }
      
      // Enhanced data for node spans
      if (span.name === 'n8n.node.execute') {
        spanData.node_data = {
          name: span.attributes?.["n8n.node.name"] || "unknown",
          type: span.attributes?.["n8n.node.type"] || "unknown",
          is_ai: span.attributes?.["n8n.node.is_ai"] || false,
          parameters: Object.entries(span.attributes || {})
            .filter(([key]) => key.startsWith('n8n.node.parameter.') || key.startsWith('n8n.node.ai_param.'))
            .reduce((acc, [key, value]) => {
              const paramKey = key.replace('n8n.node.parameter.', '').replace('n8n.node.ai_param.', '');
              acc[paramKey] = value;
              return acc;
            }, {})
        };
        
        // Extract input data
        if (span.attributes?.["n8n.node.ai_input.prompt"]) {
          spanData.node_data.input = {
            prompt: span.attributes["n8n.node.ai_input.prompt"]
          };
          
          if (span.attributes?.["n8n.node.ai_input.messages_count"]) {
            spanData.node_data.input.messages_count = span.attributes["n8n.node.ai_input.messages_count"];
            
            if (span.attributes?.["n8n.node.ai_input.last_message_role"]) {
              spanData.node_data.input.last_message = {
                role: span.attributes["n8n.node.ai_input.last_message_role"],
                content: span.attributes["n8n.node.ai_input.last_message_content"] || ""
              };
            }
          }
        }
        
        // Extract output data
        if (span.attributes?.["n8n.node.output_json"]) {
          try {
            spanData.node_data.output = JSON.parse(span.attributes["n8n.node.output_json"]);
          } catch (e) {
            spanData.node_data.output = span.attributes["n8n.node.output_json"];
          }
        }
        
        // Extract AI-specific output data
        if (span.attributes?.["n8n.node.is_ai"]) {
          spanData.node_data.ai_output = {};
          
          if (span.attributes?.["n8n.node.ai_output.text"]) {
            spanData.node_data.ai_output.text = span.attributes["n8n.node.ai_output.text"];
          }
          
          if (span.attributes?.["n8n.node.ai_output.content"]) {
            spanData.node_data.ai_output.content = span.attributes["n8n.node.ai_output.content"];
          }
          
          if (span.attributes?.["n8n.node.ai_output.message_role"]) {
            spanData.node_data.ai_output.message = {
              role: span.attributes["n8n.node.ai_output.message_role"],
              content: span.attributes["n8n.node.ai_output.message_content"] || ""
            };
          }
          
          if (span.attributes?.["n8n.node.ai_output.finish_reason"]) {
            spanData.node_data.ai_output.finish_reason = span.attributes["n8n.node.ai_output.finish_reason"];
          }
          
          // Extract token metrics
          if (span.attributes?.["n8n.node.ai_metrics.prompt_tokens"] || 
              span.attributes?.["n8n.node.ai_metrics.completion_tokens"] ||
              span.attributes?.["n8n.node.ai_metrics.total_tokens"]) {
            
            spanData.node_data.ai_metrics = {
              prompt_tokens: parseInt(span.attributes["n8n.node.ai_metrics.prompt_tokens"] || "0", 10),
              completion_tokens: parseInt(span.attributes["n8n.node.ai_metrics.completion_tokens"] || "0", 10),
              total_tokens: parseInt(span.attributes["n8n.node.ai_metrics.total_tokens"] || "0", 10)
            };
          }
        }
      }
      
      return spanData;
    });
    
    // Build a hierarchical view of the workflow execution
    let workflowHierarchy = null;
    if (workflowSpans.length > 0) {
      const workflowSpan = workflowSpans[0];
      const workflowSpanId = workflowSpan.spanContext().spanId;
      
      // Calculate duration in milliseconds
      const workflowDurationMs = workflowSpan.endTime && workflowSpan.startTime 
        ? (workflowSpan.endTime - workflowSpan.startTime) / 1000000 
        : null;
      
      workflowHierarchy = {
        id: workflowSpan.attributes?.["n8n.workflow.id"] || "unknown",
        name: workflowSpan.attributes?.["n8n.workflow.name"] || "unknown",
        span_id: workflowSpanId,
        start_time: workflowSpan.startTime,
        end_time: workflowSpan.endTime,
        duration_ms: workflowDurationMs,
        nodes: []
      };
      
      // Find all direct child spans of the workflow span (should be node executions)
      const workflowChildSpanIds = spanRelationships.get(workflowSpanId) || [];
      const nodeExecutionSpans = workflowChildSpanIds
        .map(spanId => spanMap.get(spanId))
        .filter(span => span && span.name === 'n8n.node.execute');
      
      // Add node executions to the hierarchy
      nodeExecutionSpans.forEach(nodeSpan => {
        // Calculate node duration in milliseconds
        const nodeDurationMs = nodeSpan.endTime && nodeSpan.startTime 
          ? (nodeSpan.endTime - nodeSpan.startTime) / 1000000 
          : null;
        
        const nodeInfo = {
          name: nodeSpan.attributes?.["n8n.node.name"] || "unknown",
          type: nodeSpan.attributes?.["n8n.node.type"] || "unknown",
          span_id: nodeSpan.spanContext().spanId,
          start_time: nodeSpan.startTime,
          end_time: nodeSpan.endTime,
          duration_ms: nodeDurationMs
        };
        
        // Add input/output if available
        if (nodeSpan.attributes?.["n8n.node.output_json"]) {
          try {
            nodeInfo.output = JSON.parse(nodeSpan.attributes["n8n.node.output_json"]);
          } catch (e) {
            nodeInfo.output = nodeSpan.attributes["n8n.node.output_json"];
          }
        }
        
        workflowHierarchy.nodes.push(nodeInfo);
      });
      
      // Sort nodes by start time
      workflowHierarchy.nodes.sort((a, b) => a.start_time - b.start_time);
    }
    
    // Construct the full trace payload
    return {
      trace_id: traceId,
      spans: convertedSpans,
      metadata: {
        service: this.serviceName,
        timestamp: Date.now(),
        span_count: spans.length,
        workflow_span_count: workflowSpans.length,
        node_span_count: nodeSpans.length,
        // Extract workflow info from the first workflow span if available
        workflow_id: workflowSpans.length > 0 ? workflowSpans[0].attributes?.["n8n.workflow.id"] || null : null,
        workflow_name: workflowSpans.length > 0 ? workflowSpans[0].attributes?.["n8n.workflow.name"] || null : null,
        // Include environment info
        environment: process.env.NODE_ENV || "development",
        n8n_version: process.env.N8N_VERSION || "unknown"
      },
      // Include workflow hierarchy if available
      workflow_execution: workflowHierarchy,
      // Include raw span data for debugging
      raw_spans: spans.map(span => this._extractRawSpanData(span))
    };
  }

  /**
   * Extract all available data from a span for debugging
   * @private
   * @param {ReadableSpan} span The span to extract data from
   * @returns {Object} The extracted span data
   */
  _extractRawSpanData(span) {
    // Try to extract as much data as possible
    const rawData = {};
    
    // Add all properties of the span object
    for (const key in span) {
      try {
        // Skip functions and circular references
        if (typeof span[key] === 'function') continue;
        
        // Try to convert to JSON to catch circular references
        JSON.stringify(span[key]);
        
        // If we got here, it's safe to add
        rawData[key] = span[key];
      } catch (e) {
        // If we can't stringify it, add a placeholder
        rawData[key] = `[Cannot stringify: ${e.message}]`;
      }
    }
    
    return rawData;
  }

  /**
   * Flatten nested attributes for easier viewing
   * @private
   * @param {Object} attributes The attributes to flatten
   * @returns {Object} The flattened attributes
   */
  _flattenAttributes(attributes) {
    const result = {};
    
    const flatten = (obj, prefix = '') => {
      for (const key in obj) {
        const value = obj[key];
        const newKey = prefix ? `${prefix}.${key}` : key;
        
        if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
          flatten(value, newKey);
        } else {
          result[newKey] = value;
        }
      }
    };
    
    flatten(attributes);
    return result;
  }
}

module.exports = DebugExporter;
