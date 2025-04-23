"use strict";

// Import the ExportResultCode enum from @opentelemetry/core
let ExportResultCode;
try {
  ExportResultCode = require("@opentelemetry/core").ExportResultCode;
} catch (e) {
  // Fallback if the import fails
  ExportResultCode = {
    SUCCESS: 0,
    FAILED: 1
  };
}

const http = require("http");
const https = require("https");

/**
 * LangWatch exporter for OpenTelemetry - sends trace data to LangWatch
 * This is a standalone implementation that doesn't extend SpanExporter
 */
class LangWatchExporter {
  /**
   * Constructor for the LangWatch exporter
   * @param {Object} config Configuration for the exporter
   * @param {string} config.apiKey The LangWatch API key
   * @param {string} [config.endpoint=https://app.langwatch.ai] The LangWatch endpoint
   * @param {string} [config.serviceName=n8n] The service name to use in traces
   * @param {Object} [config.logger] A logger instance to use
   */
  constructor(config = {}) {
    this.apiKey = config.apiKey;
    this.endpoint = config.endpoint || "https://app.langwatch.ai";
    this.serviceName = config.serviceName || "n8n";
    this.logger = config.logger || console;

    if (!this.apiKey) {
      this.logger.warn("LangWatch API key not provided. No traces will be sent to LangWatch.");
    }

    this.logger.info(`LangWatch exporter initialized with endpoint: ${this.endpoint}`);
  }

  /**
   * Export spans to LangWatch
   * @param {ReadableSpan[]} spans The spans to export
   * @param {Function} resultCallback Callback to be called after export
   */
  export(spans, resultCallback) {
    if (!this.apiKey) {
      this.logger.debug("Skipping export: No API key provided");
      return resultCallback({ code: ExportResultCode.SUCCESS });
    }

    if (spans.length === 0) {
      this.logger.debug("No spans to export");
      return resultCallback({ code: ExportResultCode.SUCCESS });
    }

    try {
      const traceData = this._convertSpansToLangWatchFormat(spans);
      this._sendToLangWatch(traceData, resultCallback);
    } catch (error) {
      this.logger.error("Error converting or sending spans to LangWatch:", error);
      resultCallback({ code: ExportResultCode.FAILED, error });
    }
  }

  /**
   * Shutdown the exporter
   * @param {Function} [callback] Callback to be called after shutdown
   */
  shutdown(callback = () => {}) {
    this.logger.info("Shutting down LangWatch exporter");
    callback();
  }

  /**
   * Convert OpenTelemetry spans to LangWatch format
   * @private
   * @param {ReadableSpan[]} spans The spans to convert
   * @returns {Object} The converted trace data in LangWatch format
   */
  _convertSpansToLangWatchFormat(spans) {
    if (spans.length === 0) return null;

    // Use the first span's trace ID as the trace ID for the entire batch
    const traceId = spans[0].spanContext().traceId;
    
    // Convert spans to LangWatch format
    const convertedSpans = spans.filter(span => {
      // Filter out spans with missing timestamps
      return span.startTime && span.endTime;
    }).map(span => {
      const attributes = span.attributes || {};
      const spanId = span.spanContext().spanId;
      const name = span.name;
      
      // Determine if this is an LLM span or a RAG span
      const isLLMSpan = name.includes("llm") || 
                         attributes["n8n.node.type"] === "n8n-nodes-base.openAi" ||
                         attributes["n8n.node.type"] === "n8n-nodes-base.gpt";
      const isRAGSpan = name.includes("rag") || 
                         attributes["n8n.node.is_rag"] === true;
      
      // Skip spans that are neither LLM nor RAG
      if (!isLLMSpan && !isRAGSpan) {
        this.logger.debug(`Skipping span ${spanId} with name ${name} as it's neither LLM nor RAG`);
        return null;
      }
      
      // Basic span structure
      const lwSpan = {
        span_id: spanId,
        type: isLLMSpan ? "llm" : "rag",
        timestamps: {
          started_at: Math.floor(span.startTime / 1000000), // Convert to milliseconds
          finished_at: Math.floor(span.endTime / 1000000)   // Convert to milliseconds
        },
        contexts: {} // Add empty contexts object as required by API
      };

      // Handle different span types
      if (isLLMSpan) {
        // LLM span specific fields
        lwSpan.vendor = attributes["llm.vendor"] || "unknown";
        lwSpan.model = attributes["llm.model"] || attributes["n8n.node.parameters.model"] || "unknown";
        
        // Try to extract input and output
        if (attributes["llm.prompt"] || attributes["n8n.node.parameters.prompt"]) {
          lwSpan.input = {
            type: "text",
            value: attributes["llm.prompt"] || attributes["n8n.node.parameters.prompt"] || ""
          };
        }
        
        if (attributes["llm.completion"] || attributes["n8n.node.output_json"]) {
          try {
            const output = attributes["llm.completion"] || 
                          (attributes["n8n.node.output_json"] ? JSON.parse(attributes["n8n.node.output_json"]) : "");
            lwSpan.output = {
              type: "text",
              value: typeof output === "string" ? output : JSON.stringify(output)
            };
          } catch (e) {
            this.logger.warn(`Error parsing output for span ${spanId}:`, e);
          }
        }
        
        // Extract metrics if available
        if (attributes["llm.tokens.prompt"] || attributes["llm.tokens.completion"]) {
          lwSpan.metrics = {
            prompt_tokens: parseInt(attributes["llm.tokens.prompt"] || 0, 10),
            completion_tokens: parseInt(attributes["llm.tokens.completion"] || 0, 10)
          };
        }
      } else {
        // Regular span
        lwSpan.name = name;
        
        // Add input/output if available
        if (attributes["n8n.node.parameters"]) {
          try {
            lwSpan.input = {
              type: "json",
              value: typeof attributes["n8n.node.parameters"] === "string" 
                ? JSON.parse(attributes["n8n.node.parameters"]) 
                : attributes["n8n.node.parameters"]
            };
          } catch (e) {
            this.logger.warn(`Error parsing input for span ${spanId}:`, e);
          }
        }
        
        if (attributes["n8n.node.output_json"]) {
          try {
            lwSpan.output = {
              type: "json",
              value: JSON.parse(attributes["n8n.node.output_json"])
            };
          } catch (e) {
            this.logger.warn(`Error parsing output for span ${spanId}:`, e);
          }
        }
      }
      
      // Handle errors
      if (span.status.code === 2) { // Error status
        lwSpan.error = {
          message: span.status.message || "Unknown error",
          stack: attributes["error.stack"] || null
        };
      }
      
      return lwSpan;
    });

    // Construct the full trace payload
    return {
      trace_id: traceId,
      spans: convertedSpans.filter(Boolean), // Remove null entries
      metadata: {
        service: this.serviceName,
        workflow_id: spans[0].attributes["n8n.workflow.id"] || null,
        workflow_name: spans[0].attributes["n8n.workflow.name"] || null
      }
    };
  }

  /**
   * Send data to LangWatch API
   * @private
   * @param {Object} data The data to send
   * @param {Function} resultCallback Callback to be called after sending
   */
  _sendToLangWatch(data, resultCallback) {
    if (!data) {
      this.logger.debug("No data to send to LangWatch");
      return resultCallback({ code: ExportResultCode.SUCCESS });
    }

    const payload = JSON.stringify(data);
    const url = new URL(`${this.endpoint}/api/collector`);
    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === "https:" ? 443 : 80),
      path: url.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
        "X-Auth-Token": this.apiKey
      }
    };

    const client = url.protocol === "https:" ? https : http;
    const req = client.request(options, (res) => {
      let responseData = "";
      
      res.on("data", (chunk) => {
        responseData += chunk;
      });
      
      res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          this.logger.debug(`Successfully sent ${data.spans.length} spans to LangWatch`);
          resultCallback({ code: ExportResultCode.SUCCESS });
        } else {
          this.logger.error(`Error sending spans to LangWatch: ${res.statusCode} - ${responseData}`);
          resultCallback({ 
            code: ExportResultCode.FAILED, 
            error: new Error(`HTTP error ${res.statusCode}: ${responseData}`) 
          });
        }
      });
    });

    req.on("error", (error) => {
      this.logger.error("Error sending spans to LangWatch:", error);
      resultCallback({ code: ExportResultCode.FAILED, error });
    });

    req.write(payload);
    req.end();
  }
}

module.exports = LangWatchExporter;
