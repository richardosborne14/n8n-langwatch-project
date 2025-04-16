// instrumentation/workflow-instrumentation.js - Instruments n8n workflow execution
const { logger } = require('../logger');

/**
 * Patch n8n workflow execution to track workflow runs
 * @param {Object} TraceManager - The trace manager instance
 */
function setupWorkflowInstrumentation(traceManager) {
  try {
    // Import n8n core modules
    let WorkflowExecute;
    try {
      const n8nCore = require('n8n-core');
      WorkflowExecute = n8nCore.WorkflowExecute;
      if (!WorkflowExecute) {
        throw new Error('WorkflowExecute not found in n8n-core');
      }
    } catch (importError) {
      logger.error(`Failed to import n8n-core: ${importError.message}`);
      return false;
    }
    
    // Save the original method
    const originalProcessRun = WorkflowExecute.prototype.processRunExecutionData;
    
    // Replace with our instrumented version
    WorkflowExecute.prototype.processRunExecutionData = function (workflow) {
      // Create a trace for this workflow execution
      const executionData = traceManager.createWorkflowExecution(workflow);
      
      // Call the original method and get the result
      const result = originalProcessRun.apply(this, arguments);
      
      // Handle workflow completion
      result.then(
        (executionResult) => {
          // Complete the workflow execution with success
          traceManager.completeWorkflowExecution(workflow.id, { 
            success: !executionResult?.data?.resultData?.error 
          });
        },
        (error) => {
          // Complete the workflow execution with error
          const errorMessage = error ? (error.message || String(error)) : 'Unknown error';
          traceManager.completeWorkflowExecution(workflow.id, { 
            error: errorMessage
          });
        }
      );
      
      return result;
    };
    
    logger.debug('Workflow instrumentation set up successfully');
  } catch (error) {
    const errorMessage = error ? error.message : 'Unknown error (error object is undefined)';
    logger.error(`Error setting up workflow instrumentation: ${errorMessage}`);
    return false;
  }
}

module.exports = { setupWorkflowInstrumentation };
