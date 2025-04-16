"use strict";

console.log('Loading minimal LangWatch adapter for n8n...');

// Create simple logger
const logger = {
  info: (msg) => console.log(`[INFO] ${msg}`),
  error: (msg) => console.error(`[ERROR] ${msg}`),
  debug: (msg) => process.env.LANGWATCH_LOG_LEVEL === 'debug' ? console.log(`[DEBUG] ${msg}`) : null
};

// Try to load n8n instrumentation
console.log('Loading n8n LangWatch instrumentation module...');
let instrumentationModule;

try {
  // Only try to load from instrumentation directory
  instrumentationModule = require("./instrumentation/n8n-langwatch-instrumentation");
  console.log('Found instrumentation module in instrumentation directory');
} catch (error) {
  console.error('Failed to import n8n-langwatch-instrumentation');
  console.error('Error:', error.message);
}

// Display what we found
if (instrumentationModule) {
  logger.info("Instrumentation module loaded successfully");
  logger.info(`Module type: ${typeof instrumentationModule}`);
  
  if (typeof instrumentationModule === 'function') {
    logger.info("Module is a function, will call directly");
  } else if (typeof instrumentationModule === 'object') {
    logger.info(`Module keys: ${Object.keys(instrumentationModule).join(', ')}`);
    
    // Check if it has setupN8nLangWatchInstrumentation
    if (typeof instrumentationModule.setupN8nLangWatchInstrumentation === 'function') {
      logger.info("Found setupN8nLangWatchInstrumentation function in module");
    }
  }
}

// Wrapper function that works with any structure
function initializeInstrumentation() {
  logger.info("Initializing LangWatch instrumentation");
  
  try {
    // If no module was loaded, return false
    if (!instrumentationModule) {
      logger.error("No instrumentation module was loaded");
      return false;
    }
    
    // Check what type the module is and call appropriately
    if (typeof instrumentationModule === 'function') {
      // If it's a function, call it directly
      logger.info("Calling instrumentation module as function");
      return instrumentationModule();
    } 
    else if (typeof instrumentationModule === 'object') {
      // If it's an object, look for setupN8nLangWatchInstrumentation
      if (typeof instrumentationModule.setupN8nLangWatchInstrumentation === 'function') {
        logger.info("Calling setupN8nLangWatchInstrumentation from module");
        try {
          return instrumentationModule.setupN8nLangWatchInstrumentation();
        } catch (setupError) {
          logger.error(`Error in setupN8nLangWatchInstrumentation: ${setupError ? setupError.message : 'Unknown error'}`);
          return false;
        }
      }
      // Otherwise just return true since we loaded the module
      logger.info("Instrumentation module loaded as object without setup function");
      return true;
    }
    
    // Default case, return true since we loaded something
    return true;
  } catch (error) {
    const errorMessage = error ? error.message : 'Unknown error (error object is undefined)';
    logger.error(`Error initializing instrumentation: ${errorMessage}`);
    if (error && error.stack) {
      logger.error(error.stack);
    }
    return false;
  }
}

// Set up HTTP support for trace sending
const apiKey = process.env.LANGWATCH_API_KEY || "";
const baseUrl = process.env.LANGWATCH_ENDPOINT || "https://app.langwatch.ai";
const collectorUrl = `${baseUrl}/api/collector`;

logger.info(`Using LangWatch collector URL: ${collectorUrl}`);

// Setup direct HTTP export as a fallback
try {
  if (apiKey) {
    // Create a global function to send traces to LangWatch
    global.sendTraceToLangWatch = function(traceData) {
      try {
        const https = require('https');
        const http = require('http');
        
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
        
        logger.debug(`Sending trace to LangWatch via HTTP: ${collectorUrl}`);
        
        const req = client.request(options, (res) => {
          let responseData = '';
          res.on('data', (chunk) => {
            responseData += chunk;
          });
          
          res.on('end', () => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              logger.debug(`Successfully sent trace to LangWatch: ${traceData.trace_id}`);
            } else {
              logger.error(`Error sending trace to LangWatch: ${res.statusCode} ${responseData}`);
            }
          });
        });
        
        req.on('error', (error) => {
          const errorMessage = error ? error.message : 'Unknown error';
          logger.error(`Error sending HTTP request to LangWatch: ${errorMessage}`);
        });
        
        req.write(payload);
        req.end();
        
        return true;
      } catch (error) {
        const errorMessage = error ? error.message : 'Unknown error';
        logger.error(`Failed to send trace via HTTP: ${errorMessage}`);
        return false;
      }
    };
    
    logger.info("Registered global sendTraceToLangWatch function");
  } else {
    logger.error("No API Key provided for LangWatch - traces will not be sent");
  }
} catch (httpError) {
  logger.error(`Failed to set up HTTP sender: ${httpError.message}`);
}

// Initialize the instrumentation
const result = initializeInstrumentation();
logger.info(`Instrumentation initialization ${result ? 'successful' : 'failed'}`);

console.log('LangWatch adapter initialization complete');

// Export the wrapper function
module.exports = initializeInstrumentation;
