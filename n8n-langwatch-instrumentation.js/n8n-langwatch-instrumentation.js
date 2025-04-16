// n8n-langwatch-instrumentation.js - Main instrumentation module for n8n LangWatch integration
const { logger } = require('../logger');
const { setupN8nInstrumentation } = require('./index');
const { TraceManager } = require('../trace-manager');

/**
 * Set up n8n LangWatch instrumentation
 * This function is called by the tracing-adapter.js
 * @returns {boolean} Success status
 */
function setupN8nLangWatchInstrumentation() {
  try {
    logger.info('Setting up n8n LangWatch instrumentation from main module');
    
    // Initialize trace manager
    const traceManager = new TraceManager();
    
    // Override the sendWorkflowToLangWatch method to add enhanced logging and fallback
    traceManager.sendWorkflowToLangWatch = function(executionData) {
      try {
        const workflow = executionData.workflow;
        const traceId = executionData.traceId;
        
        logger.debug(`Preparing to send ${executionData.spans.length} spans for workflow ${workflow.id}`);
        
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
        
        // Try to use the global function if available (from tracing.js)
        if (typeof global.sendTraceToLangWatch === 'function') {
          logger.info('Using global sendTraceToLangWatch function');
          const success = global.sendTraceToLangWatch(traceData);
          if (success) {
            logger.info(`Sent workflow execution trace to LangWatch using global function: ${traceId}`);
            return;
          } else {
            logger.warn('Global sendTraceToLangWatch function failed, falling back to direct HTTP');
          }
        }
        
        // Fallback to direct HTTP call if global function not available or failed
        try {
          const https = require('https');
          const http = require('http');
          
          const apiKey = process.env.LANGWATCH_API_KEY;
          if (!apiKey) {
            logger.error('No LangWatch API key provided - cannot send trace');
            return;
          }
          
          const baseUrl = process.env.LANGWATCH_ENDPOINT || "https://app.langwatch.ai";
          const collectorUrl = `${baseUrl}/api/collector`;
          
          const payload = JSON.stringify(traceData);
          const isHttps = baseUrl.startsWith('https');
          const client = isHttps ? https : http;
          
          const url = new URL(collectorUrl);
          
          const options = {
            hostname: url.hostname,
            port: url.port || (isHttps ? 443 : 80),
            path: url.pathname,
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(payload),
              'X-Auth-Token': apiKey
            }
          };
          
          logger.info(`Sending trace to LangWatch via direct HTTP: ${collectorUrl}`);
          
          const req = client.request(options, (res) => {
            let responseData = '';
            res.on('data', (chunk) => {
              responseData += chunk;
            });
            
            res.on('end', () => {
              if (res.statusCode >= 200 && res.statusCode < 300) {
                logger.info(`Successfully sent trace to LangWatch: ${traceId}`);
              } else {
                logger.error(`Error sending trace to LangWatch: ${res.statusCode} ${responseData}`);
              }
            });
          });
          
          req.on('error', (error) => {
            logger.error(`Error sending HTTP request to LangWatch: ${error.message}`);
          });
          
          req.write(payload);
          req.end();
          
        } catch (httpError) {
          logger.error(`Failed to send trace via HTTP: ${httpError.message}`);
        }
        
        logger.info(`Processed workflow execution trace for LangWatch: ${traceId}`);
      } catch (error) {
        logger.error(`Error sending workflow spans: ${error.message}`);
        logger.error(error.stack);
      }
    };
    
    // Set up instrumentation
    const success = setupN8nInstrumentation(traceManager);
    
    if (success) {
      logger.info('n8n LangWatch instrumentation setup complete');
      
      // Export the trace manager for other modules to use
      global.n8nLangWatchTraceManager = traceManager;
      
      return true;
    } else {
      logger.error('Failed to set up n8n instrumentation');
      return false;
    }
  } catch (error) {
    logger.error(`Error in setupN8nLangWatchInstrumentation: ${error.message}`);
    logger.error(error.stack);
    return false;
  }
}

// Export the setup function
module.exports = {
  setupN8nLangWatchInstrumentation
};
