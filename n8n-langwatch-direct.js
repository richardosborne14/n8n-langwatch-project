// n8n-langwatch-direct.js
const https = require('https');
const { WorkflowExecute } = require('n8n-core');
const winston = require('winston');

// Configure logger
const logger = winston.createLogger({
  level: process.env.LANGWATCH_LOG_LEVEL || 'info',
  format: winston.format.json(),
  transports: [new winston.transports.Console()]
});

// LangWatch configuration
const LANGWATCH_API_KEY = process.env.LANGWATCH_API_KEY;
const LANGWATCH_ENDPOINT = process.env.LANGWATCH_ENDPOINT || 'https://app.langwatch.ai';

// Function to send trace data to LangWatch
async function sendToLangWatch(data) {
  return new Promise((resolve, reject) => {
    try {
      const postData = JSON.stringify(data);
      
      const options = {
        hostname: new URL(LANGWATCH_ENDPOINT).hostname,
        port: 443,
        path: '/api/collector',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Auth-Token': LANGWATCH_API_KEY,
          'Content-Length': Buffer.byteLength(postData)
        }
      };

      const req = https.request(options, (res) => {
        let responseData = '';
        
        res.on('data', (chunk) => {
          responseData += chunk;
        });
        
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            logger.debug(`LangWatch trace sent successfully: ${responseData}`);
            resolve(responseData);
          } else {
            logger.error(`LangWatch API error: ${res.statusCode} ${responseData}`);
            reject(new Error(`HTTP Error: ${res.statusCode} ${responseData}`));
          }
        });
      });
      
      req.on('error', (error) => {
        logger.error(`Error sending trace to LangWatch: ${error.message}`);
        reject(error);
      });
      
      req.write(postData);
      req.end();
    } catch (error) {
      logger.error(`Exception sending trace to LangWatch: ${error.message}`);
      reject(error);
    }
  });
}

// Format date for LangWatch
function getTimestamp() {
  return Date.now();
}

// Set up n8n instrumentation
function setupN8nLangWatchInstrumentation() {
  try {
    logger.info('Setting up n8n LangWatch instrumentation');
    
    // Keep track of active workflow executions
    const activeExecutions = new Map();
    
    // Patch workflow execution
    const originalProcessRun = WorkflowExecute.prototype.processRunExecutionData;
    WorkflowExecute.prototype.processRunExecutionData = function (workflow) {
      const wfData = workflow || {};
      const workflowId = wfData?.id ?? "unknown";
      const workflowName = wfData?.name ?? "unknown";
      
      // Create a trace ID for this execution
      const traceId = `n8n-wf-${workflowId}-${Date.now()}`;
      
      // Store execution start time
      const startedAt = getTimestamp();
      activeExecutions.set(traceId, {
        workflow: wfData,
        startedAt,
        nodes: new Map(),
        spans: []
      });
      
      logger.debug(`Starting workflow: ${workflowName} (${traceId})`);
      
      const result = originalProcessRun.apply(this, arguments);
      
      // Handle workflow completion
      result.then(
        (executionResult) => {
          // Create spans for the workflow
          const executionData = activeExecutions.get(traceId);
          if (executionData) {
            const finishedAt = getTimestamp();
            
            // Create a workflow span
            const workflowSpan = {
              type: "function",
              span_id: `wf-${traceId}`,
              input: {
                type: "text",
                value: `Workflow: ${workflowName}`
              },
              output: {
                type: "json",
                value: { success: !executionResult?.data?.resultData?.error }
              },
              timestamps: {
                started_at: executionData.startedAt,
                finished_at: finishedAt
              }
            };
            
            // Add workflow span to collection
            executionData.spans.push(workflowSpan);
            
            // Send all spans to LangWatch
            sendWorkflowSpans(traceId, executionData);
          }
        },
        (error) => {
          // Handle workflow error
          const executionData = activeExecutions.get(traceId);
          if (executionData) {
            const finishedAt = getTimestamp();
            
            // Create a workflow span with error
            const workflowSpan = {
              type: "function",
              span_id: `wf-${traceId}`,
              input: {
                type: "text",
                value: `Workflow: ${workflowName}`
              },
              output: {
                type: "json",
                value: { error: error.message || String(error) }
              },
              timestamps: {
                started_at: executionData.startedAt,
                finished_at: finishedAt
              }
            };
            
            // Add workflow span to collection
            executionData.spans.push(workflowSpan);
            
            // Send all spans to LangWatch
            sendWorkflowSpans(traceId, executionData);
          }
        }
      );
      
      return result;
    };
    
    // Patch node execution
    const originalRunNode = WorkflowExecute.prototype.runNode;
    WorkflowExecute.prototype.runNode = async function (
      workflow,
      executionData,
      runExecutionData,
      runIndex,
      additionalData,
      mode,
      abortSignal
    ) {
      const node = executionData?.node;
      if (!node) {
        return originalRunNode.apply(this, arguments);
      }
      
      const workflowId = workflow?.id ?? "unknown";
      const traceId = `n8n-wf-${workflowId}-${Date.now()}`;
      
      // Get or create execution data
      let execution = activeExecutions.get(traceId);
      if (!execution) {
        execution = {
          workflow,
          startedAt: getTimestamp(),
          nodes: new Map(),
          spans: []
        };
        activeExecutions.set(traceId, execution);
      }
      
      // Check if it's an AI/LLM node
      const isAINode = node.type && (
        node.type.toLowerCase().includes('ai') ||
        node.type.toLowerCase().includes('openai') ||
        node.type.toLowerCase().includes('llm') ||
        node.type.toLowerCase().includes('gpt')
      );
      
      const nodeStartedAt = getTimestamp();
      const nodeSpanId = `node-${node.name}-${nodeStartedAt}`;
      
      try {
        // Run the node
        const result = await originalRunNode.apply(this, arguments);
        
        // Get the node output
        const nodeFinishedAt = getTimestamp();
        const outputData = result?.data?.[runIndex];
        
        // Create appropriate span based on node type
        let span;
        
        if (isAINode) {
          // Create LLM span for AI nodes
          const parameters = node?.parameters ?? {};
          const prompt = parameters.prompt || parameters.message || parameters.input || '';
          
          // Find LLM output
          let llmOutput = '';
          let usage = null;
          
          if (outputData && outputData.length > 0) {
            // Try common output field names
            const outputJson = outputData[0]?.json;
            if (outputJson) {
              const possibleOutputFields = ['text', 'content', 'output', 'completion', 'response'];
              for (const field of possibleOutputFields) {
                if (outputJson[field]) {
                  llmOutput = outputJson[field];
                  break;
                }
              }
              
              // Look for token usage
              if (outputJson.usage) {
                usage = outputJson.usage;
              }
            }
          }
          
          span = {
            type: "llm",
            span_id: nodeSpanId,
            vendor: "n8n",
            model: parameters.model || "unknown",
            input: {
              type: "text",
              value: prompt
            },
            output: {
              type: "text",
              value: llmOutput || JSON.stringify(outputData)
            },
            timestamps: {
              started_at: nodeStartedAt,
              finished_at: nodeFinishedAt
            }
          };
          
          // Add token metrics if available
          if (usage) {
            span.metrics = {
              prompt_tokens: usage.prompt_tokens || 0,
              completion_tokens: usage.completion_tokens || 0,
              total_tokens: usage.total_tokens || 0
            };
          }
        } else {
          // Create function span for regular nodes
          span = {
            type: "function",
            span_id: nodeSpanId,
            input: {
              type: "json",
              value: node.parameters || {}
            },
            output: {
              type: "json",
              value: outputData ? outputData.map(item => item.json) : []
            },
            timestamps: {
              started_at: nodeStartedAt,
              finished_at: nodeFinishedAt
            }
          };
        }
        
        // Add the span to our collection
        execution.spans.push(span);
        
        // Track in nodes map
        execution.nodes.set(node.name, {
          spanId: nodeSpanId,
          startedAt: nodeStartedAt,
          finishedAt: nodeFinishedAt,
          success: true
        });
        
        return result;
      } catch (error) {
        const nodeFinishedAt = getTimestamp();
        
        // Create error span
        const span = {
          type: isAINode ? "llm" : "function",
          span_id: nodeSpanId,
          input: {
            type: "json",
            value: node.parameters || {}
          },
          output: {
            type: "text",
            value: `Error: ${error.message || String(error)}`
          },
          timestamps: {
            started_at: nodeStartedAt,
            finished_at: nodeFinishedAt
          }
        };
        
        // Add the span to our collection
        execution.spans.push(span);
        
        // Track in nodes map
        execution.nodes.set(node.name, {
          spanId: nodeSpanId,
          startedAt: nodeStartedAt,
          finishedAt: nodeFinishedAt,
          success: false,
          error: error.message || String(error)
        });
        
        throw error;
      }
    };
    
    // Function to send workflow spans to LangWatch
    function sendWorkflowSpans(traceId, executionData) {
      try {
        const workflow = executionData.workflow;
        
        // Create trace data for LangWatch
        const traceData = {
          trace_id: traceId,
          spans: executionData.spans,
          metadata: {
            user_id: "n8n-system",
            thread_id: `workflow-${workflow.id}`,
            labels: ["n8n", `workflow-${workflow.id}`, workflow.name]
          }
        };
        
        // Send to LangWatch
        sendToLangWatch(traceData)
          .then(() => {
            logger.info(`Sent workflow execution trace to LangWatch: ${traceId}`);
          })
          .catch(error => {
            logger.error(`Failed to send trace to LangWatch: ${error.message}`);
          })
          .finally(() => {
            // Clean up execution data
            activeExecutions.delete(traceId);
          });
      } catch (error) {
        logger.error(`Error sending workflow spans: ${error.message}`);
      }
    }
    
    logger.info('n8n LangWatch instrumentation setup complete');
  } catch (error) {
    logger.error(`Failed to set up n8n LangWatch instrumentation: ${error.message}`);
  }
}

// Initialize instrumentation
setupN8nLangWatchInstrumentation();

module.exports = { setupN8nLangWatchInstrumentation, logger };