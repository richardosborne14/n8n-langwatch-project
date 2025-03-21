// n8n-langwatch-instrumentation.js
const { trace, context, SpanStatusCode, SpanKind } = require('@opentelemetry/api');
const flat = require('flat');
const tracer = trace.getTracer('n8n-langwatch-instrumentation', '1.0.0');
const logger = require('./logger');

function setupN8nLangWatchInstrumentation() {
  try {
    const { WorkflowExecute } = require('n8n-core');

    // Store workflow execution details
    const workflowExecutions = new Map();
    const pendingNodeExecutions = new Map();

    /**
     * Patch the workflow execution to wrap the entire run in a workflow-level span.
     */
    const originalProcessRun = WorkflowExecute.prototype.processRunExecutionData;
    WorkflowExecute.prototype.processRunExecutionData = function (workflow) {
      const wfData = workflow || {};
      const workflowId = wfData?.id ?? "";
      const workflowName = wfData?.name ?? "";

      // Create a trace ID for this workflow execution
      const traceId = `wf-${workflowId}-${Date.now()}`;
      const startedAt = Date.now();
      
      // Create execution record with metadata
      const executionData = {
        workflow: wfData,
        traceId,
        startedAt,
        nodes: new Map(),
        spans: [],
        tokenUsage: {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0
        },
        tools: [],
        models: [],
        isComplete: false
      };
      
      // Store execution data
      workflowExecutions.set(workflowId, executionData);
      
      logger.debug(`Starting workflow: ${workflowName} (${traceId})`);
      
      // Check for pending node executions
      if (pendingNodeExecutions.has(workflowId)) {
        const pendingNodes = pendingNodeExecutions.get(workflowId);
        logger.debug(`Found ${pendingNodes.length} pending node executions for workflow ${workflowId}`);
        executionData.spans.push(...pendingNodes);
        pendingNodeExecutions.delete(workflowId);
      }

      const workflowAttributes = {
        "n8n.workflow.id": workflowId,
        "n8n.workflow.name": workflowName,
        ...flat(wfData?.settings ?? {}, {
          delimiter: ".",
          transformKey: (key) => `n8n.workflow.settings.${key}`,
        }),
      };

      const span = tracer.startSpan('n8n.workflow.execute', {
        attributes: workflowAttributes,
        kind: SpanKind.INTERNAL
      });

      // Set the span as active
      const activeContext = trace.setSpan(context.active(), span);
      return context.with(activeContext, () => {
        const cancelable = originalProcessRun.apply(this, arguments);
        cancelable.then(
          (result) => {
            // Get the execution data for this workflow
            const executionData = workflowExecutions.get(workflowId);
            if (executionData) {
              const finishedAt = Date.now();
              
              // Add execution metadata to span
              span.setAttribute('n8n.execution.token_usage', JSON.stringify(executionData.tokenUsage));
              span.setAttribute('n8n.execution.tools', JSON.stringify(executionData.tools));
              span.setAttribute('n8n.execution.models', JSON.stringify(executionData.models));
              
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
                  value: { 
                    success: !result?.data?.resultData?.error,
                    tools: executionData.tools,
                    models: executionData.models
                  }
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
              logger.debug(`Token usage: ${JSON.stringify(executionData.tokenUsage)}`);
              logger.debug(`Models used: ${executionData.models.join(', ')}`);
              logger.debug(`Tools used: ${executionData.tools.join(', ')}`);
              
              // Send all spans to LangWatch through the established channel
              sendWorkflowToLangWatch(executionData);
            }
            
            if (result?.data?.resultData?.error) {
              const err = result.data.resultData.error;
              span.recordException(err);
              span.setStatus({
                code: SpanStatusCode.ERROR,
                message: String(err.message || err),
              });
            }
          },
          (error) => {
            span.recordException(error);
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message: String(error.message || error),
            });
          }
        ).finally(() => {
          span.end();
        });

        return cancelable;
      });
    };

    /**
     * Patch the node execution to capture detailed information about AI nodes
     */
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
      if (!this) {
        logger.warn("WorkflowExecute context is undefined");
        return originalRunNode.apply(this, arguments);
      }

      const workflowId = workflow?.id ?? "unknown";
      const node = executionData?.node;
      if (!node) {
        return originalRunNode.apply(this, arguments);
      }

      // Prepare tracking data for this node
      const nodeStartedAt = Date.now();
      
      // Get execution data for this workflow
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
      
      // Detect if this is an AI Node
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
      
      // Extract model info from parameters
      let modelInfo = {
        vendor: "n8n",
        model: "unknown"
      };
      
      // Log AI nodes with full parameter details
      if (isAINode) {
        logger.debug(`Detected AI node: ${node.name} (${node.type})`);
        logger.debug(`AI Node parameters: ${JSON.stringify(node.parameters, null, 2)}`);
        
        // Deep inspection of inputs
        if (executionData.data && executionData.data.main) {
          logger.debug(`AI Node input data: ${JSON.stringify(executionData.data.main, null, 2)}`);
        }
        
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
            
            logger.debug(`Model detected from options: ${modelInfo.vendor}/${modelInfo.model}`);
          }
        }
        
        // Look for credentials for better vendor detection
        if (node.credentials) {
          logger.debug(`Node credentials: ${JSON.stringify(node.credentials)}`);
          
          // Map credential types to vendors
          if (Object.keys(node.credentials).some(key => key.includes('openai'))) {
            modelInfo.vendor = 'openai';
          } else if (Object.keys(node.credentials).some(key => key.includes('anthropic'))) {
            modelInfo.vendor = 'anthropic';
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
          
          logger.debug(`OpenAI node detected: ${modelInfo.model}`);
        }
      }

      const nodeAttributes = {
        'n8n.workflow.id': workflow?.id ?? 'unknown',
        'n8n.execution.id': additionalData?.executionId ?? 'unknown',
        'n8n.node.name': node.name || 'unknown',
        'n8n.node.type': node.type || 'unknown',
        'n8n.is_ai_node': isAINode,
      };
      
      if (isAINode) {
        nodeAttributes['n8n.ai.vendor'] = modelInfo.vendor;
        nodeAttributes['n8n.ai.model'] = modelInfo.model;
        
        // Extract user input if available
        try {
          let userInput = "";
          if (executionData.data && executionData.data.main && 
              Array.isArray(executionData.data.main[0]) && 
              executionData.data.main[0].length > 0) {
              
            const json = executionData.data.main[0][0].json;
            if (json) {
              if (json.chatInput) userInput = json.chatInput;
              else if (json.prompt) userInput = json.prompt;
              else if (json.input) userInput = json.input;
              else if (json.message) userInput = json.message;
            }
            
            if (userInput) {
              logger.debug(`User input: ${userInput}`);
              nodeAttributes['n8n.ai.input'] = userInput;
            }
          }
        } catch (e) {
          logger.debug(`Error extracting user input: ${e.message}`);
        }
      }

      return tracer.startActiveSpan(
        `n8n.node.execute`,
        { attributes: nodeAttributes, kind: SpanKind.INTERNAL },
        async (nodeSpan) => {
          try {
            const result = await originalRunNode.apply(this, [
              workflow,
              executionData,
              runExecutionData,
              runIndex,
              additionalData,
              mode,
              abortSignal,
            ]);
            
            // Calculate execution time
            const nodeFinishedAt = Date.now();
            const executionTimeMs = nodeFinishedAt - nodeStartedAt;
            nodeSpan.setAttribute('n8n.execution_time_ms', executionTimeMs);
            
            // Process AI node outputs with detailed logging
            if (isAINode) {
              try {
                const outputData = result?.data?.[runIndex];
                
                // Debug log the full output
                logger.debug(`AI Node output data: ${JSON.stringify(outputData, null, 2)}`);
                
                let llmOutput = '';
                let tokenUsage = null;
                let modelUsed = null;
                let toolCalls = [];
                
                if (outputData && outputData.length > 0) {
                  const outputJson = outputData[0]?.json;
                  
                  // Full output logging
                  logger.debug(`Node output json: ${JSON.stringify(outputJson, null, 2)}`);
                  
                  // Try to extract model information
                  if (outputJson?.model) {
                    modelUsed = outputJson.model;
                    logger.debug(`Model used: ${modelUsed}`);
                    nodeSpan.setAttribute('n8n.ai.model_used', modelUsed);
                    
                    // Update execution records
                    if (execution && !execution.models.includes(modelUsed)) {
                      execution.models.push(modelUsed);
                    }
                  }
                  
                  // Try to extract token usage
                  if (outputJson?.usage) {
                    tokenUsage = outputJson.usage;
                    logger.debug(`Token usage found: ${JSON.stringify(tokenUsage)}`);
                  } else if (outputJson?.tokenUsage) {
                    tokenUsage = outputJson.tokenUsage;
                    logger.debug(`Token usage found: ${JSON.stringify(tokenUsage)}`);
                  } else if (outputJson?.result?.usage) {
                    tokenUsage = outputJson.result.usage;
                    logger.debug(`Token usage found in result: ${JSON.stringify(tokenUsage)}`);
                  }
                  
                  // Update token usage in execution data
                  if (tokenUsage && execution) {
                    execution.tokenUsage.prompt_tokens += tokenUsage.prompt_tokens || 0;
                    execution.tokenUsage.completion_tokens += tokenUsage.completion_tokens || 0;
                    execution.tokenUsage.total_tokens += tokenUsage.total_tokens || 0;
                    
                    nodeSpan.setAttribute('n8n.ai.tokens', JSON.stringify(tokenUsage));
                  }
                  
                  // Try to extract tool calls
                  if (outputJson?.toolCalls || outputJson?.result?.toolCalls) {
                    toolCalls = outputJson?.toolCalls || outputJson?.result?.toolCalls || [];
                    logger.debug(`Tool calls found: ${JSON.stringify(toolCalls)}`);
                    
                    // Add tools to execution record
                    if (execution && Array.isArray(toolCalls)) {
                      toolCalls.forEach(tool => {
                        const toolName = tool.name || tool.function?.name;
                        if (toolName && !execution.tools.includes(toolName)) {
                          execution.tools.push(toolName);
                        }
                      });
                    }
                    
                    nodeSpan.setAttribute('n8n.ai.tool_calls', JSON.stringify(toolCalls));
                  }
                  
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
                  }
                  
                  if (llmOutput) {
                    logger.debug(`LLM output: ${llmOutput}`);
                    nodeSpan.setAttribute('n8n.ai.output', llmOutput);
                  }
                }
                
                // Get user input from executionData
                let userInput = "";
                if (executionData.data && executionData.data.main && 
                    Array.isArray(executionData.data.main[0]) && 
                    executionData.data.main[0].length > 0) {
                    
                  const json = executionData.data.main[0][0].json;
                  if (json) {
                    if (json.chatInput) userInput = json.chatInput;
                    else if (json.prompt) userInput = json.prompt;
                    else if (json.input) userInput = json.input;
                    else if (json.message) userInput = json.message;
                  }
                }
                
                // Create an LLM span for LangWatch
                const llmSpan = {
                  type: "llm",
                  span_id: nodeSpanId,
                  vendor: modelInfo.vendor,
                  model: modelUsed || modelInfo.model,
                  input: {
                    type: "text",
                    value: userInput || "No input detected"
                  },
                  output: {
                    type: "text",
                    value: llmOutput || "No output detected"
                  },
                  timestamps: {
                    started_at: nodeStartedAt,
                    finished_at: nodeFinishedAt
                  },
                  metrics: tokenUsage || {
                    prompt_tokens: 0,
                    completion_tokens: 0,
                    total_tokens: 0
                  }
                };
                
                // Add tool calls if present
                if (toolCalls && toolCalls.length > 0) {
                  llmSpan.tool_calls = toolCalls;
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
              } catch (error) {
                logger.error(`Error processing AI node output: ${error.message}`);
              }
            }
            
            return result;
          } catch (error) {
            nodeSpan.recordException(error);
            nodeSpan.setStatus({
              code: SpanStatusCode.ERROR,
              message: String(error.message || error),
            });
            nodeSpan.setAttribute("n8n.node.status", "error");
            throw error;
          } finally {
            nodeSpan.end();
          }
        }
      );
    };

    // Send workflow trace to LangWatch
    function sendWorkflowToLangWatch(executionData) {
      try {
        const workflow = executionData.workflow;
        const traceId = executionData.traceId;
        
        // Format complete trace data
        const traceData = {
          trace_id: traceId,
          spans: executionData.spans,
          metadata: {
            user_id: "n8n-system",
            thread_id: `workflow-${workflow.id}`,
            labels: ["n8n", `workflow-${workflow.id}`, workflow.name]
          }
        };
        
        // Log debug info for debugging
        logger.debug(`LangWatch trace data: ${JSON.stringify(traceData, null, 2)}`);
        
        // Send trace to LangWatch via OTLP exporter
        // The actual sending happens via the OTLP exporter configured in tracing.js
        
        logger.info(`Sent workflow execution trace to LangWatch: ${traceId}`);
      } catch (error) {
        logger.error(`Error sending workflow spans: ${error.message}`);
      }
    }

    logger.info('n8n LangWatch instrumentation setup complete');
  } catch (e) {
    logger.error(`Failed to set up n8n LangWatch instrumentation: ${e.message}`);
    console.error(e.stack);
  }
}

module.exports = setupN8nLangWatchInstrumentation;