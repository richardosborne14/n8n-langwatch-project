"use strict";

const path = require('path');
const winston = require('winston');

// Create logger with more detailed output
const logger = winston.createLogger({
  level: process.env.LANGWATCH_LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ level, message, timestamp }) => {
      return `${timestamp} ${level}: [n8n-langwatch] ${message}`;
    })
  ),
  transports: [new winston.transports.Console()]
});

// Main instrumentation setup function
function setupN8nLangWatchInstrumentation() {
  try {
    logger.info('Setting up n8n LangWatch instrumentation from main module');
    
    // Try to get OpenTelemetry API
    try {
      const { trace, context, SpanStatusCode, SpanKind } = require('@opentelemetry/api');
      logger.info('OpenTelemetry API loaded successfully');
    } catch (otelError) {
      logger.error(`Failed to load OpenTelemetry API: ${otelError.message}`);
      logger.error(otelError.stack);
      return false;
    }
    
    // Try to import node modules
    let flatModule;
    try {
      flatModule = require('flat');
      logger.info('Flat module loaded successfully');
    } catch (flatError) {
      logger.error(`Failed to load flat module: ${flatError.message}`);
      logger.error(flatError.stack);
      return false;
    }
    
    // Try to import n8n Core
    let WorkflowExecute;
    try {
      const n8nCore = require('n8n-core');
      WorkflowExecute = n8nCore.WorkflowExecute;
      logger.info('n8n-core loaded successfully, found WorkflowExecute');
      
      if (!WorkflowExecute) {
        logger.error('WorkflowExecute not found in n8n-core');
        return false;
      }
      
      if (!WorkflowExecute.prototype || !WorkflowExecute.prototype.processRunExecutionData) {
        logger.error('WorkflowExecute.prototype.processRunExecutionData method not found');
        logger.info(`Available methods: ${Object.keys(WorkflowExecute.prototype).join(', ')}`);
        return false;
      }
    } catch (coreError) {
      logger.error(`Failed to load n8n-core: ${coreError.message}`);
      logger.error(coreError.stack);
      return false;
    }
    
    // Create a tracer instance
    const { trace, context, SpanStatusCode, SpanKind } = require('@opentelemetry/api');
    const tracer = trace.getTracer('n8n-langwatch', '1.0.0');
    
    // Patch the workflow execution with comprehensive error handling
    try {
      const originalProcessRun = WorkflowExecute.prototype.processRunExecutionData;
      logger.info('Successfully captured original processRunExecutionData method');
      
      WorkflowExecute.prototype.processRunExecutionData = function (workflow) {
        try {
          const wfData = workflow || {};
          const workflowId = wfData?.id ?? "";
          const workflowName = wfData?.name ?? "";
          
          logger.info(`Workflow execution: ${workflowName} (${workflowId})`);
          
          // Create basic attributes
          const workflowAttributes = {
            "n8n.workflow.id": workflowId,
            "n8n.workflow.name": workflowName,
          };
          
          // Try to add settings if they exist
          try {
            if (wfData?.settings) {
              const flat = require('flat');
              const flattenedSettings = flat(wfData.settings, {
                delimiter: ".",
                transformKey: (key) => `n8n.workflow.settings.${key}`,
              });
              
              Object.assign(workflowAttributes, flattenedSettings);
              logger.debug(`Added ${Object.keys(flattenedSettings).length} settings attributes`);
            }
          } catch (settingsError) {
            logger.warn(`Failed to flatten workflow settings: ${settingsError.message}`);
          }
          
          // Create span for workflow execution
          const span = tracer.startSpan("n8n.workflow.execute", {
            attributes: workflowAttributes,
            kind: SpanKind.INTERNAL,
          });
          
          logger.info(`Starting span for workflow: ${workflowName}`);
          
          // Set the span as active
          const activeContext = trace.setSpan(context.active(), span);
          
          return context.with(activeContext, () => {
            // Call original function
            const cancelable = originalProcessRun.apply(this, arguments);
            
            // Handle promise result
            cancelable
              .then(
                (result) => {
                  if (result?.data?.resultData?.error) {
                    const err = result.data.resultData.error;
                    span.recordException(err);
                    span.setStatus({
                      code: SpanStatusCode.ERROR,
                      message: String(err.message || err),
                    });
                    logger.error(`Workflow execution error: ${err.message}`);
                  } else {
                    logger.info(`Workflow execution completed: ${workflowName}`);
                  }
                },
                (error) => {
                  span.recordException(error);
                  span.setStatus({
                    code: SpanStatusCode.ERROR,
                    message: String(error.message || error),
                  });
                  logger.error(`Workflow execution rejected: ${error.message}`);
                }
              )
              .finally(() => {
                span.end();
                logger.info(`Ended span for workflow: ${workflowName}`);
              });
            
            return cancelable;
          });
        } catch (wrapperError) {
          logger.error(`Error in processRunExecutionData wrapper: ${wrapperError.message}`);
          logger.error(wrapperError.stack);
          
          // Fall back to original function if our wrapper fails
          return originalProcessRun.apply(this, arguments);
        }
      };
      
      logger.info('Successfully patched processRunExecutionData method');
    } catch (patchError) {
      logger.error(`Failed to patch workflow execution: ${patchError.message}`);
      logger.error(patchError.stack);
      return false;
    }
    
    // Patch the node execution with comprehensive error handling
    try {
      const originalRunNode = WorkflowExecute.prototype.runNode;
      logger.info('Successfully captured original runNode method');
      
      WorkflowExecute.prototype.runNode = async function (
        workflow,
        executionData,
        runExecutionData,
        runIndex,
        additionalData,
        mode,
        abortSignal
      ) {
        try {
          // Safeguard against undefined this context
          if (!this) {
            logger.warn("WorkflowExecute context is undefined");
            return originalRunNode.apply(this, arguments);
          }
          
          const node = executionData?.node ?? { name: "unknown" };
          const nodeName = node.name || "unknown";
          const nodeType = node.type || "unknown";
          
          logger.info(`Node execution: ${nodeName} (${nodeType})`);
          
          const executionId = additionalData?.executionId ?? "unknown";
          
          // Create basic node attributes
          const nodeAttributes = {
            "n8n.workflow.id": workflow?.id ?? "unknown",
            "n8n.execution.id": executionId,
            "n8n.node.name": nodeName,
            "n8n.node.type": nodeType,
          };
          
          // Create and start node execution span
          return tracer.startActiveSpan(
            `n8n.node.execute`,
            { attributes: nodeAttributes, kind: SpanKind.INTERNAL },
            async (nodeSpan) => {
              try {
                // Call original method
                const result = await originalRunNode.apply(this, [
                  workflow,
                  executionData,
                  runExecutionData,
                  runIndex,
                  additionalData,
                  mode,
                  abortSignal,
                ]);
                
                // Capture output data
                try {
                  const outputData = result?.data?.[runIndex];
                  
                  if (outputData && Array.isArray(outputData)) {
                    const outputCount = outputData.length;
                    nodeSpan.setAttribute("n8n.node.output_count", outputCount);
                    logger.info(`Node ${nodeName} output: ${outputCount} items`);
                    
                    // Try to capture first item for debugging
                    if (outputCount > 0 && outputData[0].json) {
                      // Only log in debug mode to avoid cluttering logs
                      logger.debug(`Node ${nodeName} first output item: ${JSON.stringify(outputData[0].json).substring(0, 200)}...`);
                    }
                  }
                } catch (outputError) {
                  logger.warn(`Failed to process node output: ${outputError.message}`);
                }
                
                return result;
              } catch (error) {
                nodeSpan.recordException(error);
                nodeSpan.setStatus({
                  code: SpanStatusCode.ERROR,
                  message: String(error.message || error),
                });
                nodeSpan.setAttribute("n8n.node.status", "error");
                logger.error(`Node execution error: ${error.message}`);
                throw error;
              } finally {
                nodeSpan.end();
                logger.info(`Ended span for node: ${nodeName}`);
              }
            }
          );
        } catch (wrapperError) {
          logger.error(`Error in runNode wrapper: ${wrapperError.message}`);
          logger.error(wrapperError.stack);
          
          // Fall back to original function if our wrapper fails
          return originalRunNode.apply(this, arguments);
        }
      };
      
      logger.info('Successfully patched runNode method');
      
      // Success - attach a global trace sender if we have an API key
      if (global.sendTraceToLangWatch && process.env.LANGWATCH_API_KEY) {
        logger.info('Setting up LangWatch direct trace export');
        
        // Create a simple export function
        const sendTrace = (traceData) => {
          try {
            logger.debug(`Sending trace to LangWatch: ${traceData.trace_id}`);
            const result = global.sendTraceToLangWatch(traceData);
            return result;
          } catch (error) {
            logger.error(`Failed to send trace: ${error.message}`);
            return false;
          }
        };
        
        // Attach to global for other modules to use
        global.langwatchExporter = {
          sendTrace,
        };
        
        logger.info('Successfully set up LangWatch trace export');
      }
      
      return true;
    } catch (patchError) {
      logger.error(`Failed to patch node execution: ${patchError.message}`);
      logger.error(patchError.stack);
      return false;
    }
  } catch (error) {
    logger.error(`Failed to set up n8n instrumentation: ${error.message}`);
    logger.error(error.stack);
    return false;
  }
}

// Export the setup function
module.exports = {
  setupN8nLangWatchInstrumentation,
};