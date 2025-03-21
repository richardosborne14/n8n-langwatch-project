// n8n-langwatch-instrumentation.js
const { trace, context, SpanStatusCode, SpanKind } = require('@opentelemetry/api');
const flat = require('flat');
const tracer = trace.getTracer('n8n-langwatch-instrumentation', '1.0.0');

function setupN8nLangWatchInstrumentation() {
  try {
    const { WorkflowExecute } = require('n8n-core');

    // Patch workflow execution to create a trace
    const originalProcessRun = WorkflowExecute.prototype.processRunExecutionData;
    WorkflowExecute.prototype.processRunExecutionData = function (workflow) {
      const wfData = workflow || {};
      const workflowId = wfData?.id ?? "";
      const workflowName = wfData?.name ?? "";

      const workflowAttributes = {
        'n8n.workflow.id': workflowId,
        'n8n.workflow.name': workflowName,
      };

      // Add workflow settings if available (with flattening)
      if (wfData?.settings) {
        try {
          const flatSettings = flat(wfData.settings, { delimiter: '.' });
          for (const [key, value] of Object.entries(flatSettings)) {
            if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
              workflowAttributes[`n8n.workflow.settings.${key}`] = value;
            } else if (value !== null && value !== undefined) {
              workflowAttributes[`n8n.workflow.settings.${key}`] = JSON.stringify(value);
            }
          }
        } catch (e) {
          console.warn('Failed to flatten workflow settings:', e);
        }
      }

      // Start workflow span
      const span = tracer.startSpan('n8n.workflow.execute', {
        attributes: workflowAttributes,
        kind: SpanKind.INTERNAL
      });

      // Set active span context
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

    // Patch node execution to create spans for each node
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
      // Guard against undefined context
      if (!this) {
        console.warn('WorkflowExecute context is undefined');
        return originalRunNode.apply(this, arguments);
      }

      const executionId = additionalData?.executionId ?? 'unknown';
      const userId = additionalData?.userId ?? 'unknown';
      const node = executionData?.node ?? {};
      
      // Special handling for AI/LLM nodes
      const isAINode = 
        (node?.type && (
          node.type.toLowerCase().includes('ai') || 
          node.type.toLowerCase().includes('openai') || 
          node.type.toLowerCase().includes('llm') ||
          node.type.toLowerCase().includes('gpt')
        )) || false;
      
      // Basic node attributes
      const nodeAttributes = {
        'n8n.workflow.id': workflow?.id ?? 'unknown',
        'n8n.execution.id': executionId,
        'n8n.user.id': userId,
        'n8n.node.type': node?.type ?? 'unknown',
        'n8n.node.name': node?.name ?? 'unknown',
      };
      
      // For AI nodes, we'll use LangWatch-specific span type
      const spanName = isAINode ? 'llm' : 'n8n.node.execute';
      
      return tracer.startActiveSpan(
        spanName,
        { attributes: nodeAttributes, kind: SpanKind.INTERNAL },
        async (nodeSpan) => {
          try {
            // If AI node, add input parameters as LangWatch input format
            if (isAINode) {
              // Try to extract the input prompt from parameters
              const parameters = node?.parameters ?? {};
              if (parameters.prompt || parameters.message || parameters.input) {
                const prompt = parameters.prompt || parameters.message || parameters.input;
                nodeSpan.setAttribute('input.type', 'text');
                nodeSpan.setAttribute('input.value', prompt);
              }
              
              // Add model information if available
              if (parameters.model) {
                nodeSpan.setAttribute('model', parameters.model);
              }
            }
            
            const result = await originalRunNode.apply(this, [
              workflow, executionData, runExecutionData, runIndex, additionalData, mode, abortSignal
            ]);
            
            try {
              const outputData = result?.data?.[runIndex];
              
              // For AI nodes, format output for LangWatch
              if (isAINode && outputData) {
                const outputJson = outputData.map(item => item.json);
                
                // Look for JSON fields that might contain the LLM output
                let llmOutput = '';
                if (outputJson && outputJson.length > 0) {
                  // Try common output field names
                  const possibleOutputFields = ['text', 'content', 'output', 'completion', 'response'];
                  for (const field of possibleOutputFields) {
                    if (outputJson[0][field]) {
                      llmOutput = outputJson[0][field];
                      break;
                    }
                  }
                  
                  // If we found output, set it as LangWatch output
                  if (llmOutput) {
                    nodeSpan.setAttribute('output.type', 'text');
                    nodeSpan.setAttribute('output.value', llmOutput);
                  }
                  
                  // Look for token usage information
                  if (outputJson[0].usage) {
                    const usage = outputJson[0].usage;
                    if (usage.prompt_tokens) {
                      nodeSpan.setAttribute('metrics.promptTokens', usage.prompt_tokens);
                    }
                    if (usage.completion_tokens) {
                      nodeSpan.setAttribute('metrics.completionTokens', usage.completion_tokens);
                    }
                    if (usage.total_tokens) {
                      nodeSpan.setAttribute('metrics.totalTokens', usage.total_tokens);
                    }
                  }
                }
              }
              
              // Store a summary of the output for debugging (to avoid overly large spans)
              if (outputData && outputData.length > 0) {
                try {
                  const summary = {
                    count: outputData.length,
                    sample: outputData[0].json
                  };
                  nodeSpan.setAttribute('n8n.node.output_summary', JSON.stringify(summary));
                } catch (error) {
                  console.warn('Failed to create output summary:', error);
                }
              }
            } catch (error) {
              console.warn('Failed to set node output attributes: ', error);
            }
            
            return result;
          } catch (error) {
            nodeSpan.recordException(error);
            nodeSpan.setStatus({
              code: SpanStatusCode.ERROR,
              message: String(error.message || error),
            });
            nodeSpan.setAttribute('n8n.node.status', 'error');
            throw error;
          } finally {
            nodeSpan.end();
          }
        }
      );
    };

  } catch (e) {
    console.error("Failed to set up n8n LangWatch instrumentation:", e);
  }
}

module.exports = setupN8nLangWatchInstrumentation;