// instrumentation/node-instrumentation.js - Instruments n8n node execution
const { logger } = require('../logger');
const { getTimestamp, extractSystemMessage, extractUserInput, extractLLMOutput } = require('../utils/helpers');
const { isAINode, detectModelInfo, extractModelParameters } = require('../utils/model-detection');

/**
 * Patch n8n node execution to track node runs
 * @param {Object} traceManager - The trace manager instance
 */
function setupNodeInstrumentation(traceManager) {
  try {
    // Import n8n core modules
    const { WorkflowExecute } = require('n8n-core');
    
    // Save the original method
    const originalRunNode = WorkflowExecute.prototype.runNode;
    
    // Replace with our instrumented version
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
      
      // Get execution data for this workflow
      const execution = traceManager.getWorkflowExecution(workflowId);
      const traceId = execution ? execution.traceId : `wf-${workflowId}-${nodeStartedAt}`;
      const nodeSpanId = `${traceId}-node-${node.name}`;
      
      // Check if this is an AI/LLM node
      const aiNode = isAINode(node);
      
      if (aiNode) {
        logger.debug(`Detected AI node: ${node.name} (${node.type})`);
      }
      
      try {
        // Run the node
        const result = await originalRunNode.apply(this, arguments);
        
        // Get node output
        const nodeFinishedAt = getTimestamp();
        const outputData = result?.data?.[runIndex];
        
        // Create the appropriate span based on node type
        if (aiNode) {
          // Get model information
          const modelInfo = detectModelInfo(node);
          
          // Extract user's input message
          const userInput = extractUserInput(node, executionData, runExecutionData, runIndex);
          
          // Extract system message for the agent/assistant
          const systemMessage = extractSystemMessage(node.parameters);
          
          // Extract LLM output
          const { llmOutput, usage } = extractLLMOutput(outputData);
          
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
          
          // Get model parameters
          const modelParams = extractModelParameters(node);
          
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
          
          // Add the span to the workflow execution
          traceManager.addSpan(workflowId, llmSpan);
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
          
          // Add the span to the workflow execution
          traceManager.addSpan(workflowId, componentSpan);
        }
        
        return result;
      } catch (error) {
        const nodeFinishedAt = getTimestamp();
        
        // Create error span
        const span = {
          type: aiNode ? "llm" : "component",
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
        
        // Add the span to the workflow execution
        traceManager.addSpan(workflowId, span);
        
        throw error;
      }
    };
    
    logger.debug('Node instrumentation set up successfully');
  } catch (error) {
    logger.error(`Error setting up node instrumentation: ${error.message}`);
  }
}

module.exports = { setupNodeInstrumentation };