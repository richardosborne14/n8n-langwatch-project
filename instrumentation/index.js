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
    setupWorkflowInstrumentation(traceManager);
    
    // Set up node instrumentation
    setupNodeInstrumentation(traceManager);
    
    logger.info('n8n instrumentation setup complete');
    return true;
  } catch (error) {
    logger.error(`Failed to set up n8n instrumentation: ${error.message}`);
    return false;
  }
}

module.exports = { setupN8nInstrumentation };