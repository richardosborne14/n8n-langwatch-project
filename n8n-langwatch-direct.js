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

// Resolve n8n template expressions if possible
function resolveExpression(expr, data) {
  if (typeof expr !== 'string') return expr;
  
  // Simple template expression resolver for n8n style expressions
  if (expr.startsWith('=')) {
    // Remove the equals sign
    const actualExpr = expr.substring(1);
    
    // Handle common expressions
    if (actualExpr.includes('$json.')) {
      // Extract the field name
      const fieldMatch = actualExpr.match(/\$json\.(\w+)/);
      if (fieldMatch && fieldMatch[1]) {
        const fieldName = fieldMatch[1];
        
        // Try to find the value in the data
        if (data && data[fieldName] !== undefined) {
          logger.debug(`Resolved $json.${fieldName} to "${data[fieldName]}"`);
          return data[fieldName];
        }
      }
    }
    
    // For system messages, try to handle date templates
    if (actualExpr.includes('$now.format')) {
      // Replace with current date
      const now = new Date();
      return actualExpr
        .replace(/\{\{\s*\$now\.format\('cccc'\)\s*\}\}/g, now.toLocaleDateString('en-US', { weekday: 'long' }))
        .replace(/\{\{\s*\$now\.format\('yyyy-MM-dd HH:mm'\)\s*\}\}/g, 
          `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ` +
          `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`);
    }
    
    // If we can't resolve it, return without the equals sign
    return actualExpr;
  }
  
  return expr;
}

// Extract user input from parameters or run data
function extractUserInput(node, executionData, runExecutionData, runIndex) {
  try {
    // Track all places we check for user input
    const sources = [];
    
    // First, check if we can get chatInput directly from executionData.data.main
    if (executionData.data && executionData.data.main && executionData.data.main.length > 0) {
      const inputData = executionData.data.main[0];
      if (Array.isArray(inputData) && inputData.length > 0 && inputData[0].json) {
        // Found input json data, check for chatInput
        if (inputData[0].json.chatInput) {
          sources.push({ 
            source: "executionData.data.main[0][0].json.chatInput", 
            value: inputData[0].json.chatInput,
            priority: 10 // Give highest priority
          });
        }
        if (inputData[0].json.message) {
          sources.push({ 
            source: "executionData.data.main[0][0].json.message", 
            value: inputData[0].json.message,
            priority: 9
          });
        }
        if (inputData[0].json.input) {
          sources.push({ 
            source: "executionData.data.main[0][0].json.input", 
            value: inputData[0].json.input,
            priority: 8
          });
        }
        // Add the full json for debugging
        sources.push({ 
          source: "executionData.data.main[0][0].json", 
          value: inputData[0].json,
          priority: 1
        });
      } else if (typeof inputData === 'object') {
        sources.push({ 
          source: "executionData.data.main[0]", 
          value: inputData,
          priority: 5
        });
      }
    }
    
    // Next, check node parameters
    if (node.parameters) {
      const params = node.parameters;
      
      // Check for text parameter (common in n8n nodes)
      if (params.text) {
        sources.push({ 
          source: "node.parameters.text", 
          value: params.text,
          priority: 3
        });
      }
      
      // Check for prompt parameter
      if (params.prompt) {
        sources.push({ 
          source: "node.parameters.prompt", 
          value: params.prompt,
          priority: 4
        });
      }
      
      // Check for message parameter
      if (params.message) {
        sources.push({ 
          source: "node.parameters.message", 
          value: params.message,
          priority: 4
        });
      }
      
      // Check for input parameter
      if (params.input) {
        sources.push({ 
          source: "node.parameters.input", 
          value: params.input,
          priority: 4
        });
      }
      
      // Check for LangChain agent options
      if (params.options && params.options.input) {
        sources.push({ 
          source: "node.parameters.options.input", 
          value: params.options.input,
          priority: 6
        });
      }
    }
    
    // Access run data if available
    if (runExecutionData && runExecutionData.resultData && 
        runExecutionData.resultData.runData && node.name) {
        
      const nodeData = runExecutionData.resultData.runData[node.name];
      if (nodeData && nodeData.length > 0) {
        // Get the latest run for this node
        const latestRun = nodeData[nodeData.length - 1];
        
        if (latestRun.data && latestRun.data.main && latestRun.data.main.length > 0) {
          // Get input data in case it contains chatInput
          const inputItems = latestRun.data.main[0];
          if (inputItems && inputItems.length > 0) {
            const firstItem = inputItems[0];
            if (firstItem && firstItem.json) {
              // Check for chatInput or message field
              if (firstItem.json.chatInput) {
                sources.push({ 
                  source: "runExecutionData.chatInput", 
                  value: firstItem.json.chatInput,
                  priority: 7
                });
              }
              if (firstItem.json.message) {
                sources.push({ 
                  source: "runExecutionData.message", 
                  value: firstItem.json.message,
                  priority: 6
                });
              }
              if (firstItem.json.input) {
                sources.push({ 
                  source: "runExecutionData.input", 
                  value: firstItem.json.input,
                  priority: 5
                });
              }
            }
          }
        }
      }
    }
    
    // Log what we found
    logger.debug(`Found ${sources.length} possible input sources`);
    sources.forEach((s, i) => {
      const valueStr = typeof s.value === 'object' ? JSON.stringify(s.value).substring(0, 100) : String(s.value).substring(0, 100);
      logger.debug(`Source ${i}: ${s.source} = ${valueStr}...`);
    });
    
    // Sort sources by priority (higher first)
    sources.sort((a, b) => (b.priority || 0) - (a.priority || 0));
    
    // Return the best input we found based on priority
    if (sources.length > 0) {
      const bestSource = sources[0];
      logger.debug(`Selected best source: ${bestSource.source} (priority: ${bestSource.priority})`);
      
      // If it's a JSON object with chatInput, use that
      if (typeof bestSource.value === 'object' && bestSource.value.chatInput) {
        return bestSource.value.chatInput;
      }
      
      // Return the value, resolving any expressions
      return resolveExpression(bestSource.value, sources.find(s => typeof s.value === 'object')?.value || {});
    }
    
    return ""; // Default empty input
  } catch (error) {
    logger.error(`Error extracting user input: ${error.message}`);
    return "";
  }
}

// Extract system message from parameters 
function extractSystemMessage(parameters) {
  if (!parameters) return '';
  
  // Check options for systemMessage
  if (parameters.options && parameters.options.systemMessage) {
    return resolveExpression(parameters.options.systemMessage, {});
  }
  
  // Check direct systemMessage parameter
  if (parameters.systemMessage) {
    return resolveExpression(parameters.systemMessage, {});
  }
  
  // Check system parameter
  if (parameters.system) {
    return resolveExpression(parameters.system, {});
  }
  
  return '';
}

// Calculate tokens based on string length (rough estimation if accurate numbers not available)
function estimateTokenCount(text) {
  if (!text) return 0;
  // Very rough estimation: 1 token ≈ 4 characters for English text
  return Math.ceil(String(text).length / 4);
}

// Set up n8n instrumentation
function setupN8nLangWatchInstrumentation() {
  try {
    logger.info('Setting up n8n LangWatch instrumentation');
    
    // Keep track of active workflow executions based on workflow ID
    const workflowExecutions = new Map();
    
    // Keep track of node executions that happened before workflow registration
    const pendingNodeExecutions = new Map();
    
    // Patch workflow execution
    const originalProcessRun = WorkflowExecute.prototype.processRunExecutionData;
    WorkflowExecute.prototype.processRunExecutionData = function (workflow) {
      const wfData = workflow || {};
      const workflowId = wfData?.id ?? "unknown";
      const workflowName = wfData?.name ?? "unknown";
      
      // Create a trace ID for this workflow execution and store it
      const traceId = `wf-${workflowId}-${Date.now()}`;
      const startedAt = getTimestamp();
      
      // Create a new execution record with an empty spans array
      const executionData = {
        workflow: wfData,
        traceId,
        startedAt,
        nodes: new Map(),
        spans: [],
        isComplete: false
      };
      
      // Store the execution data by workflow ID
      workflowExecutions.set(workflowId, executionData);
      
      logger.debug(`Starting workflow: ${workflowName} (${traceId})`);
      
      // Check for any pending node executions for this workflow
      if (pendingNodeExecutions.has(workflowId)) {
        const pendingNodes = pendingNodeExecutions.get(workflowId);
        logger.debug(`Found ${pendingNodes.length} pending node executions for workflow ${workflowId}`);
        executionData.spans.push(...pendingNodes);
        pendingNodeExecutions.delete(workflowId);
      }
      
      const result = originalProcessRun.apply(this, arguments);
      
      // Handle workflow completion
      result.then(
        (executionResult) => {
          // Get the execution data for this workflow
          const executionData = workflowExecutions.get(workflowId);
          if (executionData) {
            const finishedAt = getTimestamp();
            
            // Create a workflow span
            const workflowSpan = {
              type: "workflow",
              span_id: `${executionData.traceId}-workflow`,
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
            executionData.isComplete = true;
            
            // Print summary of all spans found
            logger.debug(`Workflow ${workflowName} complete with ${executionData.spans.length} spans`);
            executionData.spans.forEach((span, index) => {
              logger.debug(`Span ${index}: ${span.type} - ${span.span_id}`);
            });
            
            // Send all spans to LangWatch
            sendWorkflowToLangWatch(executionData);
          }
        },
        (error) => {
          // Handle workflow error
          const executionData = workflowExecutions.get(workflowId);
          if (executionData) {
            const finishedAt = getTimestamp();
            
            // Create a workflow span with error
            const workflowSpan = {
              type: "workflow",
              span_id: `${executionData.traceId}-workflow`,
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
            executionData.isComplete = true;
            
            // Send all spans to LangWatch
            sendWorkflowToLangWatch(executionData);
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
      
      // Prepare tracking data for this node
      const nodeStartedAt = getTimestamp();
      
      // Get execution data for this workflow if exists
      const execution = workflowExecutions.get(workflowId);
      let traceId;
      if (execution) {
        traceId = execution.traceId;
      } else {
        // If workflow hasn't been initialized yet, create a temporary trace ID
        traceId = `wf-${workflowId}-${nodeStartedAt}`;
        logger.debug(`No workflow execution found for ${workflowId}, using temp trace ID: ${traceId}`);
      }
      
      const nodeSpanId = `${traceId}-node-${node.name}`;
      
      // Enhanced node type detection
      const nodeName = node.name?.toLowerCase() || '';
      const nodeType = node.type?.toLowerCase() || '';
      
      // Extract model info from agent parameters if available
      let modelInfo = {
        vendor: "n8n",
        model: "unknown"
      };
      
      // Check for LangChain agent model
      if (node.parameters && node.parameters.options && node.parameters.options.model) {
        const modelParam = node.parameters.options.model;
        
        if (typeof modelParam === 'string') {
          modelInfo.model = modelParam;
          
          // Attempt to determine vendor from model name
          if (modelParam.includes('gpt') || modelParam.startsWith('text-') || modelParam.includes('davinci')) {
            modelInfo.vendor = 'openai';
          } else if (modelParam.includes('claude')) {
            modelInfo.vendor = 'anthropic';
          } else if (modelParam.includes('gemini')) {
            modelInfo.vendor = 'google';
          } else if (modelParam.includes('mistral')) {
            modelInfo.vendor = 'mistral';
          }
        }
      }
      
      // Look for credentials for better vendor detection
      let credentials = {};
      if (node.credentials) {
        credentials = node.credentials;
        
        // Map credential types to vendors
        if (Object.keys(credentials).some(key => key.includes('openai'))) {
          modelInfo.vendor = 'openai';
        } else if (Object.keys(credentials).some(key => key.includes('anthropic'))) {
          modelInfo.vendor = 'anthropic';
        }
      }
      
      // We can guess the model if credential type is available
      if (node.type === '@n8n/n8n-nodes-langchain.agent' || node.type === '@n8n/n8n-nodes-langchain.llm') {
        if (modelInfo.vendor === 'openai' && modelInfo.model === 'unknown') {
          modelInfo.model = 'gpt-4';  // Default model for OpenAI in LangChain nodes
        }
      }
      
      // n8n OpenAI nodes
      if (node.type && node.type.includes('openai')) {
        modelInfo.vendor = 'openai';
        // Try to extract model from parameters
        if (node.parameters && node.parameters.model) {
          modelInfo.model = node.parameters.model;
        } else {
          modelInfo.model = 'gpt-4';  // Likely default
        }
      }
      
      // Detect AI/LLM nodes
      const isAINode = 
        // Check node type
        nodeType.includes('ai') ||
        nodeType.includes('openai') ||
        nodeType.includes('llm') ||
        nodeType.includes('gpt') ||
        nodeType.includes('agent') ||
        nodeType.includes('chat') ||
        nodeType.includes('completion') ||
        nodeType.includes('langchain') ||
        
        // Check node name patterns
        nodeName.includes('ai') ||
        nodeName.includes('openai') ||
        nodeName.includes('llm') ||
        nodeName.includes('gpt') ||
        nodeName.includes('agent') ||
        nodeName.includes('chat') ||
        nodeName.includes('completion') ||
        
        // Deep inspection of parameters
        (node.parameters && (
          node.parameters.model || 
          node.parameters.prompt || 
          node.parameters.system || 
          node.parameters.messages ||
          (node.parameters.options && node.parameters.options.model)
        ));
        
      // Log AI nodes for debugging
      if (isAINode) {
        logger.debug(`Detected AI node: ${node.name} (${node.type})`);
        if (modelInfo.model !== 'unknown') {
          logger.debug(`  Model: ${modelInfo.vendor}/${modelInfo.model}`);
        }
      }
      
      try {
        // Log the raw parameters for debugging
        if (isAINode && node.parameters) {
          logger.debug(`AI Node raw parameters: ${JSON.stringify(node.parameters).substring(0, 500)}...`);
        }
        
        // Run the node
        const result = await originalRunNode.apply(this, arguments);
        
        // Get node output
        const nodeFinishedAt = getTimestamp();
        const outputData = result?.data?.[runIndex];
        
        // Create the appropriate span based on node type
        if (isAINode) {
          // Extract user's input message
          let userInput = extractUserInput(node, executionData, runExecutionData, runIndex);
          
          // Extract system message for the agent/assistant
          let systemMessage = extractSystemMessage(node.parameters);
          
          // Log input extraction results
          logger.debug(`Extracted user input: "${userInput}"`);
          logger.debug(`Extracted system message: "${systemMessage}"`);
          
          // Extract LLM output
          let llmOutput = '';
          let usage = null;
          
          if (outputData && outputData.length > 0) {
            const outputJson = outputData[0]?.json;
            
            // Log the output structure for debugging
            if (outputJson) {
              logger.debug(`Node output data: ${JSON.stringify(outputJson).substring(0, 500)}...`);
              
              // Try standard output field first
              if (outputJson.output !== undefined) {
                llmOutput = outputJson.output;
              } 
              // Try AI agent specific output format 
              else if (outputJson.result && outputJson.result.output) {
                llmOutput = outputJson.result.output;
              }
              // Try all common output fields
              else {
                const fieldNames = [
                  'text', 'content', 'output', 'completion', 'response', 
                  'answer', 'message', 'result', 'generated_text'
                ];
                
                for (const field of fieldNames) {
                  if (outputJson[field] !== undefined) {
                    if (typeof outputJson[field] === 'object' && outputJson[field].content) {
                      llmOutput = outputJson[field].content;
                    } else {
                      llmOutput = outputJson[field];
                    }
                    break;
                  }
                }
                
                // If not found in top level, check for nested structures
                if (!llmOutput && outputJson.choices && outputJson.choices.length > 0) {
                  const choice = outputJson.choices[0];
                  if (choice.message && choice.message.content) {
                    llmOutput = choice.message.content;
                  } else if (choice.text) {
                    llmOutput = choice.text;
                  }
                }
              }
              
              // Try to extract token usage from output
              if (outputJson.usage) {
                usage = outputJson.usage;
              } else if (outputJson.tokenUsage) {
                usage = outputJson.tokenUsage;
              }
            }
          }
          
          // If no token information is available, estimate tokens
          if (!usage && (llmOutput || userInput || systemMessage)) {
            usage = {
              prompt_tokens: estimateTokenCount(systemMessage) + estimateTokenCount(userInput),
              completion_tokens: estimateTokenCount(llmOutput),
              total_tokens: estimateTokenCount(systemMessage) + estimateTokenCount(userInput) + estimateTokenCount(llmOutput)
            };
          }
          
          // Format input based on available data
          let chatMessages = [];
          
          // Add system message if available
          if (systemMessage) {
            chatMessages.push({ role: "system", content: systemMessage });
          }
          
          // Add user message if available
          if (userInput) {
            chatMessages.push({ role: "user", content: userInput });
          }
          
          // Choose input format (chat messages or text)
          let inputValue;
          if (chatMessages.length > 0) {
            inputValue = {
              type: "chat_messages",
              value: chatMessages
            };
          } else {
            inputValue = {
              type: "text",
              value: userInput
            };
          }
          
          // Get parameter values
          const parameters = node.parameters || {};
          const modelParams = {};
          
          // Extract parameters from different places
          if (parameters.temperature !== undefined) {
            modelParams.temperature = parameters.temperature;
          } else if (parameters.options && parameters.options.temperature !== undefined) {
            modelParams.temperature = parameters.options.temperature;
          }
          
          if (parameters.maxTokens !== undefined) {
            modelParams.max_tokens = parameters.maxTokens;
          } else if (parameters.options && parameters.options.maxTokens !== undefined) {
            modelParams.max_tokens = parameters.options.maxTokens;
          }
          
          // Create LLM span
          const llmSpan = {
            type: "llm",
            span_id: nodeSpanId,
            vendor: modelInfo.vendor,
            model: modelInfo.model,
            input: inputValue,
            output: {
              type: "text",
              value: llmOutput || "No output detected"
            },
            timestamps: {
              started_at: nodeStartedAt,
              finished_at: nodeFinishedAt
            },
            params: modelParams
          };
          
          // Add token metrics if available
          if (usage) {
            llmSpan.metrics = {
              prompt_tokens: usage.prompt_tokens || 0,
              completion_tokens: usage.completion_tokens || 0,
              total_tokens: usage.total_tokens || 0
            };
          }
          
          // Add the span to the workflow execution or pending queue
          if (execution) {
            execution.spans.push(llmSpan);
            logger.debug(`Added LLM span for node ${node.name} to workflow ${workflowId}`);
          } else {
            // Store in pending executions
            if (!pendingNodeExecutions.has(workflowId)) {
              pendingNodeExecutions.set(workflowId, []);
            }
            pendingNodeExecutions.get(workflowId).push(llmSpan);
            logger.debug(`Added LLM span for node ${node.name} to pending queue for workflow ${workflowId}`);
          }
        } else {
          // Create component span for regular nodes
          const componentSpan = {
            type: "component",
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
          
          // Add the span to the workflow execution or pending queue
          if (execution) {
            execution.spans.push(componentSpan);
          } else {
            // Store in pending executions
            if (!pendingNodeExecutions.has(workflowId)) {
              pendingNodeExecutions.set(workflowId, []);
            }
            pendingNodeExecutions.get(workflowId).push(componentSpan);
          }
        }
        
        return result;
      } catch (error) {
        const nodeFinishedAt = getTimestamp();
        
        // Create error span
        const span = {
          type: isAINode ? "llm" : "component",
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
        
        // Add the span to the workflow execution or pending queue
        if (execution) {
          execution.spans.push(span);
        } else {
          // Store in pending executions
          if (!pendingNodeExecutions.has(workflowId)) {
            pendingNodeExecutions.set(workflowId, []);
          }
          pendingNodeExecutions.get(workflowId).push(span);
        }
        
        throw error;
      }
    };
    
    // Send workflow trace to LangWatch
    function sendWorkflowToLangWatch(executionData) {
      try {
        const workflow = executionData.workflow;
        const traceId = executionData.traceId;
        
        // Debug: Verify spans
        logger.debug(`Found ${executionData.spans.length} spans for workflow ${workflow.id}`);
        for (const span of executionData.spans) {
          logger.debug(`- Span ${span.type}: ${span.span_id}`);
        }
        
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
            workflowExecutions.delete(workflow.id);
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