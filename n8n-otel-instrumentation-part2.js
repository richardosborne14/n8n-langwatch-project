/**
 * Set up OpenTelemetry instrumentation for n8n
 */
function setupN8nOpenTelemetry() {
  try {
    logger.info('Setting up n8n OpenTelemetry instrumentation');
    
    // Import n8n-core (will throw if not available)
    const { WorkflowExecute } = require('n8n-core');

    /**
     * Patch the workflow execution to wrap the entire run in a workflow-level span.
     *
     * - Span name: "n8n.workflow.execute"
     * - Attributes prefixed with "n8n." to follow semantic conventions.
     */
    const originalProcessRun = WorkflowExecute.prototype.processRunExecutionData;
    /** @param {import('n8n-workflow').Workflow} workflow */
    WorkflowExecute.prototype.processRunExecutionData = function (workflow) {
      const wfData = workflow || {};
      const workflowId = wfData?.id ?? "";
      const workflowName = wfData?.name ?? "";

      const workflowAttributes = {
        'n8n.workflow.id': workflowId,
        'n8n.workflow.name': workflowName,
        ...flat(wfData?.settings ?? {}, { delimiter: '.', transformKey: (key) => `n8n.workflow.settings.${key}` }),
      };

      logger.debug(`Starting workflow span for: ${workflowName} (${workflowId})`);
      
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
            if (result?.data?.resultData?.error) {
              const err = result.data.resultData.error;
              span.recordException(err);
              span.setStatus({
                code: SpanStatusCode.ERROR,
                message: String(err.message || err),
              });
              logger.debug(`Workflow ${workflowName} completed with error: ${err.message}`);
            } else {
              logger.debug(`Workflow ${workflowName} completed successfully`);
            }
          },
          (error) => {
            span.recordException(error);
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message: String(error.message || error),
            });
            logger.debug(`Workflow ${workflowName} failed with error: ${error.message}`);
          }
        ).finally(() => {
          span.end();
        });

        return cancelable;
      });
    };

    /**
     * Patch the node execution to wrap each node's run in a child span.
     *
     * - Span name: "n8n.node.execute"
     * - Captures node-specific details as attributes.
     */
    const originalRunNode = WorkflowExecute.prototype.runNode;
    /**
     * @param {import('n8n-workflow').Workflow} workflow
     * @param {import('n8n-workflow').IExecuteData} executionData
     * @param {import('n8n-workflow').IRunExecutionData} runExecutionData
     * @param {number} runIndex
     * @param {import('n8n-workflow').IWorkflowExecuteAdditionalData} additionalData
     * @param {import('n8n-workflow').WorkflowExecuteMode} mode
     * @param {AbortSignal} [abortSignal]
     * @returns {Promise<import('n8n-workflow').IRunNodeResponse>}
     */
    WorkflowExecute.prototype.runNode = async function (
      workflow,
      executionData,
      runExecutionData,
      runIndex,
      additionalData,
      mode,
      abortSignal
    ) {
      // Safeguard against undefined this context
      if (!this) {
        logger.warn('WorkflowExecute context is undefined');
        return originalRunNode.apply(this, arguments);
      }

      const executionId = additionalData?.executionId ?? 'unknown';
      const userId = additionalData?.userId ?? 'unknown';

      const node = executionData?.node ?? {};
      const nodeName = node?.name ?? 'unknown';
      const nodeType = node?.type ?? 'unknown';
      
      // Enhanced attributes for AI nodes
      const isAi = isAINode(nodeType, nodeName);
      
      // Collection of credential names/types
      let credInfo = 'none';
      if (node?.credentials && typeof node.credentials === 'object') {
        const credTypes = Object.keys(node.credentials);
        if (credTypes.length) {
          credInfo = credTypes
            .map((type) => {
              const cred = node.credentials?.[type];
              return cred && typeof cred === 'object' 
                ? (cred.name ?? `${type} (id:${cred?.id ?? 'unknown'})`)
                : type;
            })
            .join(', ');
        }
      }
      
      // Basic node attributes
      const nodeAttributes = {
        'n8n.workflow.id': workflow?.id ?? 'unknown',
        'n8n.execution.id': executionId,
        'n8n.node.name': nodeName,
        'n8n.node.type': nodeType,
        'n8n.node.is_ai': isAi,
        'n8n.node.credentials': credInfo,
        'n8n.node.include_in_trace': true // Always include all nodes in trace
      };
      
      // Add node parameters as attributes
      const nodeParameters = node?.parameters ?? {};
      
      // For all nodes, add detailed parameters
      try {
        // Add flattened parameters for all nodes
        const flatParams = flat(nodeParameters, { 
          delimiter: '.', 
          maxDepth: 2,
          transformKey: (key) => `n8n.node.parameter.${key}` 
        });
        
        Object.entries(flatParams).forEach(([key, value]) => {
          // Only add simple value types, and limit string length
          if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
            nodeAttributes[key] = typeof value === 'string' 
              ? value.substring(0, 500) // Limit string length
              : value;
          }
        });
        
        // For AI nodes, add additional AI-specific parameters
        if (isAi) {
          // Extract specific AI parameters
          const aiParams = extractAIParameters(nodeParameters);
          Object.entries(aiParams).forEach(([key, value]) => {
            nodeAttributes[`n8n.node.ai_param.${key}`] = value;
          });
          
          // Input parameters that might contain prompts
          if (nodeParameters.prompt) {
            nodeAttributes['n8n.node.ai_input.prompt'] = 
              typeof nodeParameters.prompt === 'string' 
                ? nodeParameters.prompt.substring(0, 1000) 
                : JSON.stringify(nodeParameters.prompt).substring(0, 1000);
          }
          
          if (nodeParameters.messages && Array.isArray(nodeParameters.messages)) {
            nodeAttributes['n8n.node.ai_input.messages_count'] = nodeParameters.messages.length;
            // Capture a sample of messages
            if (nodeParameters.messages.length > 0) {
              const sampleMessage = nodeParameters.messages[nodeParameters.messages.length - 1];
              if (sampleMessage && typeof sampleMessage === 'object') {
                nodeAttributes['n8n.node.ai_input.last_message_role'] = sampleMessage.role || 'unknown';
                if (sampleMessage.content) {
                  nodeAttributes['n8n.node.ai_input.last_message_content'] = 
                    typeof sampleMessage.content === 'string'
                      ? sampleMessage.content.substring(0, 1000)
                      : JSON.stringify(sampleMessage.content).substring(0, 1000);
                }
              }
            }
          }
        }
      } catch (error) {
        logger.warn(`Error extracting parameters for node ${nodeName}:`, error);
      }
      
      // Log all node executions, not just AI nodes
      logger.debug(`Starting node span for: ${nodeName} (${nodeType}) - AI: ${isAi}`);
      
      return tracer.startActiveSpan(
        `n8n.node.execute`,
        { attributes: nodeAttributes, kind: SpanKind.INTERNAL },
        async (nodeSpan) => {
          try {
            const result = await originalRunNode.apply(this, [workflow, executionData, runExecutionData, runIndex, additionalData, mode, abortSignal]);
            
            try {
              const outputData = result?.data?.[runIndex];
              
              // Capture output data for all nodes
              if (outputData) {
                const finalJson = outputData?.map((item) => item.json);
                
                // Add the full output JSON for all nodes
                try {
                  nodeSpan.setAttribute('n8n.node.output_json', JSON.stringify(finalJson));
                  
                  // Basic output metadata for all nodes
                  nodeSpan.setAttribute('n8n.node.output_count', outputData.length);
                  if (outputData.length > 0 && outputData[0].json) {
                    const firstItem = outputData[0].json;
                    const outputType = Array.isArray(firstItem) ? 'array' : typeof firstItem;
                    nodeSpan.setAttribute('n8n.node.output_type', outputType);
                  }
                  
                  // For AI nodes, add additional detailed attributes
                  if (isAi && Array.isArray(finalJson) && finalJson.length > 0) {
                    const firstOutput = finalJson[0];
                    
                    // OpenAI-style output
                    if (firstOutput.choices && Array.isArray(firstOutput.choices)) {
                      const choice = firstOutput.choices[0];
                      if (choice) {
                        if (choice.message && typeof choice.message === 'object') {
                          nodeSpan.setAttribute('n8n.node.ai_output.message_role', choice.message.role || 'assistant');
                          nodeSpan.setAttribute('n8n.node.ai_output.message_content', 
                            typeof choice.message.content === 'string' 
                              ? choice.message.content.substring(0, 1000) 
                              : JSON.stringify(choice.message.content).substring(0, 1000));
                        }
                        
                        if (choice.text) {
                          nodeSpan.setAttribute('n8n.node.ai_output.text', 
                            typeof choice.text === 'string' 
                              ? choice.text.substring(0, 1000) 
                              : JSON.stringify(choice.text).substring(0, 1000));
                        }
                        
                        if (choice.finish_reason) {
                          nodeSpan.setAttribute('n8n.node.ai_output.finish_reason', choice.finish_reason);
                        }
                      }
                      
                      // Usage information
                      if (firstOutput.usage && typeof firstOutput.usage === 'object') {
                        if (firstOutput.usage.prompt_tokens !== undefined) {
                          nodeSpan.setAttribute('n8n.node.ai_metrics.prompt_tokens', firstOutput.usage.prompt_tokens);
                        }
                        
                        if (firstOutput.usage.completion_tokens !== undefined) {
                          nodeSpan.setAttribute('n8n.node.ai_metrics.completion_tokens', firstOutput.usage.completion_tokens);
                        }
                        
                        if (firstOutput.usage.total_tokens !== undefined) {
                          nodeSpan.setAttribute('n8n.node.ai_metrics.total_tokens', firstOutput.usage.total_tokens);
                        }
                      }
                    }
                    
                    // Anthropic-style output
                    if (firstOutput.content) {
                      nodeSpan.setAttribute('n8n.node.ai_output.content', 
                        typeof firstOutput.content === 'string' 
                          ? firstOutput.content.substring(0, 1000) 
                          : JSON.stringify(firstOutput.content).substring(0, 1000));
                    }
                    
                    // Generic output handling (text/content)
                    if (firstOutput.text && !nodeSpan.attributes['n8n.node.ai_output.text']) {
                      nodeSpan.setAttribute('n8n.node.ai_output.text', 
                        typeof firstOutput.text === 'string' 
                          ? firstOutput.text.substring(0, 1000) 
                          : JSON.stringify(firstOutput.text).substring(0, 1000));
                    }
                    
                    if (firstOutput.output && !nodeSpan.attributes['n8n.node.ai_output.content']) {
                      nodeSpan.setAttribute('n8n.node.ai_output.output', 
                        typeof firstOutput.output === 'string' 
                          ? firstOutput.output.substring(0, 1000) 
                          : JSON.stringify(firstOutput.output).substring(0, 1000));
                    }
                  }
                } catch (jsonError) {
                  logger.warn(`Error processing node output for ${nodeName}:`, jsonError);
                }
              }
            } catch (error) {
              logger.warn(`Failed to set node output attributes for ${nodeName}:`, error);
            }
            
            return result;
          } catch (error) {
            nodeSpan.recordException(error);
            nodeSpan.setStatus({
              code: SpanStatusCode.ERROR,
              message: String(error.message || error),
            });
            nodeSpan.setAttribute('n8n.node.status', 'error');
            logger.debug(`Node ${nodeName} execution failed with error: ${error.message}`);
            throw error;
          } finally {
            nodeSpan.end();
          }
        }
      );
    };

    logger.info('n8n OpenTelemetry instrumentation setup completed successfully');
    return true;
  } catch (e) {
    logger.error("Failed to set up n8n OpenTelemetry instrumentation:", e);
    return false;
  }
}

module.exports = setupN8nOpenTelemetry;
