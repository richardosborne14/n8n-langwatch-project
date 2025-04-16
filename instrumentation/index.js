// instrumentation/index.js - Combined instrumentation setup
const { setupWorkflowInstrumentation } = require('./workflow-instrumentation');
const { setupNodeInstrumentation } = require('./node-instrumentation');
const { logger } = require('../logger');

/**
 * Set up all n8n instrumentation
 * @param {Object} traceManager - The trace manager instance
 */
function setupN8nInstrumentation(traceManager) {
  try {
    // Set up workflow instrumentation
    const workflowSuccess = setupWorkflowInstrumentation(traceManager);
    if (!workflowSuccess) {
      logger.warn('Workflow instrumentation setup failed');
    }
    
    // Set up node instrumentation
    const nodeSuccess = setupNodeInstrumentation(traceManager);
    if (!nodeSuccess) {
      logger.warn('Node instrumentation setup failed');
    }
    
    // If both failed, return false
    if (!workflowSuccess && !nodeSuccess) {
      logger.error('Both workflow and node instrumentation setup failed');
      return false;
    }
    
    logger.info('n8n instrumentation setup complete');
    return true;
  } catch (error) {
    // Handle case where error might be undefined
    try {
      const errorMessage = error ? error.message : 'Unknown error (error object is undefined)';
      logger.error(`Failed to set up n8n instrumentation: ${errorMessage}`);
    } catch (logError) {
      // If we can't even log the error, just log a generic message
      console.error('[ERROR] Failed to set up n8n instrumentation and failed to log error');
    }
    return false;
  }
}

module.exports = { setupN8nInstrumentation };
