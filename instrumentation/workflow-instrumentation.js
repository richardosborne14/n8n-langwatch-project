// instrumentation/workflow-instrumentation.js - Instruments n8n workflow execution
const { logger } = require('../logger');

/**
 * Patch n8n workflow execution to track workflow runs
 * @param {Object} TraceManager - The trace manager instance
 */
function setupWorkflowInstrumentation(traceManager) {
  try {
    // Import n8n core modules
    const { WorkflowExecute } = require('n8n-core');
    
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
          traceManager.completeWorkflowExecution(workflow.id, { 
            error: error.message || String(error) 
          });
        }
      );
      
      return result;
    };
    
    logger.debug('Workflow instrumentation set up successfully');
  } catch (error) {
    logger.error(`Error setting up workflow instrumentation: ${error.message}`);
  }
}

module.exports = { setupWorkflowInstrumentation };