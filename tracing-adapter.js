"use strict";

console.log('Loading LangWatch adapter for n8n (Homebrew installation)...');

// Create simple logger
const logger = {
  info: (msg) => console.log(`[INFO] ${msg}`),
  error: (msg) => console.error(`[ERROR] ${msg}`),
  debug: (msg) => process.env.LANGWATCH_LOG_LEVEL === 'debug' ? console.log(`[DEBUG] ${msg}`) : null
};

// Try to load n8n instrumentation
logger.info('Loading n8n LangWatch instrumentation module...');
let instrumentationModule;

try {
  // Load from the current directory
  const path = require('path');
  const localPath = path.join(__dirname, 'instrumentation/n8n-langwatch-instrumentation.js');
  logger.info(`Trying to load instrumentation from: ${localPath}`);
  
  instrumentationModule = require(localPath);
  logger.info('Found instrumentation module in local directory');
} catch (error) {
  logger.error(`Failed to import n8n-langwatch-instrumentation: ${error.message}`);
  logger.error(error.stack);
}

// Setup global context with n8n paths
try {
  // Explicitly set the n8n path for instrumentation
  global.n8nLangwatchConfig = {
    n8nPath: '/opt/homebrew/lib/node_modules/n8n',
    n8nVersion: '1.88.0',
    homebrewInstall: true
  };
  
  logger.info(`Set global n8n path: ${global.n8nLangwatchConfig.n8nPath}`);
} catch (configError) {
  logger.error(`Failed to set n8n path: ${configError.message}`);
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
        return instrumentationModule.setupN8nLangWatchInstrumentation();
      }
      // Otherwise just return true since we loaded the module
      logger.info("Instrumentation module loaded as object without setup function");
      return true;
    }
    
    // Default case, return true since we loaded something
    return true;
  } catch (error) {
    logger.error(`Error initializing instrumentation: ${error.message}`);
    logger.error(error.stack);
    return false;
  }
}

// Set up HTTP support for trace sending
const apiKey = process.env.LANGWATCH_API_KEY || "";
const baseUrl = process.env.LANGWATCH_ENDPOINT || "https://app.langwatch.ai";
const collectorUrl = `${baseUrl}/api/collector`;

logger.info(`Using LangWatch collector URL: ${collectorUrl}`);

// Initialize the instrumentation
const result = initializeInstrumentation();
logger.info(`Instrumentation initialization ${result ? 'successful' : 'failed'}`);

console.log('LangWatch adapter initialization complete');

// Export the wrapper function
module.exports = initializeInstrumentation;