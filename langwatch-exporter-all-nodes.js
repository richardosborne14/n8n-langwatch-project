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
    
    // Get all node execution spans without filtering
    const nodeSpans = spans.filter(span => span.name === "n8n.node.execute");
    
    // Log what we found for debugging
    this.logger.debug(`Found ${nodeSpans.length} node spans out of ${spans.length} total spans`);
    
    // Count AI nodes for informational purposes
    const aiNodeSpans = nodeSpans.filter(span => {
      const attributes = span.attributes || {};
      return (
        attributes["n8n.node.is_ai"] === true || 
        attributes["n8n.node.type"]?.includes("openai") ||
        attributes["n8n.node.type"]?.includes("gpt") ||
        attributes["n8n.node.type"]?.includes("langchain") ||
        attributes["n8n.node.type"]?.includes("anthropic") ||
        attributes["n8n.node.type"]?.includes("claude") ||
        attributes["n8n.node.type"]?.includes("llm")
      );
    });
    
    this.logger.debug(`Found ${aiNodeSpans.length} AI node spans out of ${nodeSpans.length} total node spans`);
    
    // Extract workflow IDs from all node spans
    const workflowIds = new Set();
    nodeSpans.forEach(span => {
      const workflowId = span.attributes?.["n8n.workflow.id"];
      if (workflowId) {
        workflowIds.add(workflowId);
      }
    });
    
    this.logger.debug(`Nodes found in ${workflowIds.size} workflows`);
    
    // Convert all node spans to LangWatch format
    const convertedSpans = this._convertNodeSpansToLangWatchFormat(nodeSpans, spans);
    
    // Find workflow info for metadata
    const workflowSpan = spans.find(span => span.name === "n8n.workflow.execute");
    const workflowId = workflowSpan?.attributes?.["n8n.workflow.id"] || null;
    const workflowName = workflowSpan?.attributes?.["n8n.workflow.name"] || null;
    const executionId = spans.find(span => span.attributes?.["n8n.execution.id"])?.attributes?.["n8n.execution.id"] || null;

    // Construct the full trace payload following LangWatch API format
    return {
      trace_id: traceId,
      spans: convertedSpans.filter(Boolean), // Remove null entries
      metadata: {
        service: this.serviceName,
        workflow_id: workflowId,
        workflow_name: workflowName,
        thread_id: workflowId, // Use workflow ID as thread ID for grouping related traces
        execution_id: executionId, // Include execution ID if available
        labels: ["n8n", "workflow"] // Add labels for filtering in LangWatch
      }
    };
  }

  /**
   * Convert node spans to LangWatch format
   * @private
   * @param {ReadableSpan[]} nodeSpans The node spans to convert
   * @param {ReadableSpan[]} allSpans All spans in the trace (for context)
   * @returns {Array} The converted spans in LangWatch format
   */
  _convertNodeSpansToLangWatchFormat(nodeSpans, allSpans) {
    return nodeSpans.filter(span => {
      // Filter out spans with missing timestamps
      return span.startTime && span.endTime;
    }).map(span => {
      const attributes = span.attributes || {};
      const spanId = span.spanContext().spanId;
      const nodeName = attributes["n8n.node.name"] || "unknown";
      const nodeType = attributes["n8n.node.type"] || "unknown";
      const isAI = attributes["n8n.node.is_ai"] === true || 
                   nodeType.includes("openai") || 
                   nodeType.includes("gpt") ||
                   nodeType.includes("langchain") ||
                   nodeType.includes("anthropic") ||
                   nodeType.includes("claude") ||
                   nodeType.includes("llm");
      
      // Extract workflow info
      const workflowId = attributes["n8n.workflow.id"] || null;
      const workflowSpan = allSpans.find(s => 
        s.name === "n8n.workflow.execute" && 
        s.attributes?.["n8n.workflow.id"] === workflowId
      );
      const workflowName = workflowSpan?.attributes?.["n8n.workflow.name"] || 
                          attributes["n8n.workflow.name"] || 
                          "unknown";
      
      // Basic span structure following LangWatch API format
      const lwSpan = {
        span_id: spanId,
        name: nodeName,
        type: isAI ? "llm" : "unknown", // Use "unknown" for non-AI nodes
        timestamps: {
          started_at: Array.isArray(span.startTime) 
            ? Math.floor(span.startTime[0] * 1000 + span.startTime[1] / 1000000) // Convert [seconds, nanoseconds] to milliseconds
            : Math.floor(span.startTime / 1000000), // Fallback for non-array format
          finished_at: Array.isArray(span.endTime)
            ? Math.floor(span.endTime[0] * 1000 + span.endTime[1] / 1000000) // Convert [seconds, nanoseconds] to milliseconds
            : Math.floor(span.endTime / 1000000)   // Fallback for non-array format
        }
      };
      
      // Add node type as a parameter for all spans
      lwSpan.params = {
        node_type: nodeType
      };

      // Add vendor and model for AI nodes
      if (isAI) {
        // Check if this is a RAG operation based on node type or attributes
        if (nodeType.includes("rag") || 
            attributes["n8n.node.is_rag"] === true || 
            attributes["n8n.node.parameter.use_retrieval"] === true) {
          lwSpan.type = "rag"; // Override type to "rag" for RAG operations
        }
        
        // Improved vendor detection
        lwSpan.vendor = nodeType.includes("openai") ? "openai" : 
                       nodeType.includes("anthropic") || nodeType.includes("claude") ? "anthropic" :
                       nodeType.includes("langchain") ? "langchain" :
                       nodeType.includes("mistral") ? "mistral" :
                       nodeType.includes("gemini") ? "google" :
                       nodeType.includes("palm") ? "google" :
                       nodeType.includes("cohere") ? "cohere" :
                       nodeType.includes("huggingface") ? "huggingface" :
                       nodeType.includes("ollama") ? "ollama" :
                       "unknown";
        
        // Extract model from attributes or set a default based on vendor
        const modelFromAttributes = attributes["n8n.node.parameter.model"] || 
                                   attributes["llm.model"] || 
                                   attributes["n8n.node.ai_param.model"];
        
        lwSpan.model = modelFromAttributes || 
                      (lwSpan.vendor === "openai" ? "gpt-4" : 
                       lwSpan.vendor === "anthropic" ? "claude-2" :
                       lwSpan.vendor === "langchain" ? "langchain-agent" :
                       lwSpan.vendor === "mistral" ? "mistral-medium" :
                       lwSpan.vendor === "google" ? "gemini-pro" :
                       "unknown");
      }
      
      // Extract input for all nodes, not just AI nodes
      let input = null;
      if (attributes["n8n.node.parameter.prompt"]) {
        // Text prompt
        input = {
          type: "text",
          value: attributes["n8n.node.parameter.prompt"]
        };
      } else if (attributes["n8n.node.parameter.messages"]) {
        // Chat messages
        try {
          const messages = JSON.parse(attributes["n8n.node.parameter.messages"]);
          if (Array.isArray(messages)) {
            input = {
              type: "chat_messages",
              value: messages
            };
          }
        } catch (e) {
          this.logger.warn(`Error parsing messages for node ${nodeName}:`, e);
        }
      } else if (attributes["n8n.node.ai_input.prompt"]) {
        // AI input prompt
        input = {
          type: "text",
          value: attributes["n8n.node.ai_input.prompt"]
        };
      } else if (attributes["n8n.node.ai_input.last_message_content"]) {
        // Last message content as input
        input = {
          type: "text",
          value: attributes["n8n.node.ai_input.last_message_content"]
        };
      } else if (attributes["n8n.node.parameter.text"]) {
        // Text parameter as input
        input = {
          type: "text",
          value: attributes["n8n.node.parameter.text"]
        };
      } else if (attributes["n8n.node.parameter.value"]) {
        // Value parameter as input
        input = {
          type: "text",
          value: String(attributes["n8n.node.parameter.value"])
        };
      } else {
        // For all nodes without explicit input, create a default input
        // This ensures Langwatch always has some input to display
        input = {
          type: "text",
          value: "Input not captured. This may be due to how the n8n node handles inputs."
        };
      }
      
      // If we have input, add it to the span
      if (input) {
        lwSpan.input = input;
      }
      
      // Extract output for all nodes, not just AI nodes
      if (attributes["n8n.node.output_json"]) {
        try {
          const outputJson = JSON.parse(attributes["n8n.node.output_json"]);
          
          // Handle different output formats
          if (Array.isArray(outputJson) && outputJson.length > 0) {
            const firstOutput = outputJson[0];
            
            if (firstOutput.output) {
              // Simple output format
              lwSpan.output = {
                type: "text",
                value: firstOutput.output
              };
            } else if (firstOutput.choices && Array.isArray(firstOutput.choices)) {
              // OpenAI-style output
              const choice = firstOutput.choices[0];
              if (choice.message) {
                // Format as chat_messages with proper structure
                lwSpan.output = {
                  type: "chat_messages",
                  value: [{
                    role: choice.message.role || "assistant",
                    content: choice.message.content,
                    function_call: choice.message.function_call || null,
                    tool_calls: choice.message.tool_calls || []
                  }]
                };
              } else if (choice.text) {
                lwSpan.output = {
                  type: "text",
                  value: choice.text
                };
              }
            } else if (firstOutput.content) {
              // Anthropic-style output
              lwSpan.output = {
                type: "text",
                value: firstOutput.content
              };
            } else {
              // Generic output for non-AI nodes
              // Convert the output to a string representation
              lwSpan.output = {
                type: "text",
                value: JSON.stringify(firstOutput, null, 2)
              };
            }
            
            // Extract metrics if available
            if (firstOutput.usage) {
              lwSpan.metrics = {
                prompt_tokens: firstOutput.usage.prompt_tokens || 0,
                completion_tokens: firstOutput.usage.completion_tokens || 0,
                total_tokens: firstOutput.usage.total_tokens || 0
              };
            }
          }
        } catch (e) {
          this.logger.warn(`Error parsing output for node ${nodeName}:`, e);
        }
      } else if (attributes["n8n.node.ai_output.output"]) {
        // Direct AI output
        lwSpan.output = {
          type: "text",
          value: attributes["n8n.node.ai_output.output"]
        };
      } else if (attributes["n8n.node.ai_output.text"]) {
        // AI output text
        lwSpan.output = {
          type: "text",
          value: attributes["n8n.node.ai_output.text"]
        };
      } else if (attributes["n8n.node.ai_output.content"]) {
        // AI output content
        lwSpan.output = {
          type: "text",
          value: attributes["n8n.node.ai_output.content"]
        };
      } else if (attributes["n8n.node.ai_output.message_content"]) {
        // AI output message content
        lwSpan.output = {
          type: "chat_messages",
          value: [{
            role: attributes["n8n.node.ai_output.message_role"] || "assistant",
            content: attributes["n8n.node.ai_output.message_content"],
            function_call: null,
            tool_calls: []
          }]
        };
      }
      
      // Extract metrics from AI metrics attributes
      if (attributes["n8n.node.ai_metrics.prompt_tokens"] || 
          attributes["n8n.node.ai_metrics.completion_tokens"] || 
          attributes["n8n.node.ai_metrics.total_tokens"]) {
        lwSpan.metrics = {
          prompt_tokens: parseInt(attributes["n8n.node.ai_metrics.prompt_tokens"] || 0, 10),
          completion_tokens: parseInt(attributes["n8n.node.ai_metrics.completion_tokens"] || 0, 10),
          total_tokens: parseInt(attributes["n8n.node.ai_metrics.total_tokens"] || 0, 10)
        };
      }
      
      // Extract parameters
      const params = {};
      Object.entries(attributes).forEach(([key, value]) => {
        if (key.startsWith("n8n.node.parameter.") && 
            key !== "n8n.node.parameter.prompt" && 
            key !== "n8n.node.parameter.messages") {
          const paramKey = key.replace("n8n.node.parameter.", "");
          params[paramKey] = value;
        }
      });
      
      if (Object.keys(params).length > 0) {
        lwSpan.params = {...lwSpan.params, ...params};
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
    
    // Log request details for debugging
    this.logger.debug("Sending data to LangWatch:");
    this.logger.debug(`- Endpoint: ${url.toString()}`);
    this.logger.debug(`- API Key: ${this.apiKey ? this.apiKey.substring(0, 10) + '...' : 'undefined'}`);
    this.logger.debug(`- Payload size: ${Buffer.byteLength(payload)} bytes`);
    
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
          this.logger.debug("Response headers:", res.headers);
          
          // Log a sample of the payload for debugging
          const payloadSample = payload.length > 1000 
            ? payload.substring(0, 500) + '...' + payload.substring(payload.length - 500) 
            : payload;
          this.logger.debug("Request payload sample:", payloadSample);
          
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
