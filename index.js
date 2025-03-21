// index.js - Main entry point for n8n LangWatch integration
const { setupLogger, logger } = require('./logger');
const { setupN8nInstrumentation } = require('./instrumentation');
const { TraceManager } = require('./trace-manager');

// Initialize the logger with environment variables
setupLogger({
  logLevel: process.env.LANGWATCH_LOG_LEVEL || 'info'
});

// Log startup information
logger.info('Starting n8n LangWatch instrumentation');
logger.info(`API Endpoint: ${process.env.LANGWATCH_ENDPOINT || 'https://app.langwatch.ai'}`);
logger.info(`API Key present: ${process.env.LANGWATCH_API_KEY ? 'Yes' : 'No'}`);

// Initialize trace manager
const traceManager = new TraceManager();

// Set up instrumentation
try {
  setupN8nInstrumentation(traceManager);
  logger.info('n8n LangWatch instrumentation setup complete');
} catch (error) {
  logger.error(`Failed to set up n8n LangWatch instrumentation: ${error.message}`);
}

// Handle process termination gracefully
process.on('SIGINT', async () => {
  logger.info('Shutting down n8n LangWatch instrumentation');
  await traceManager.flushPendingTraces();
  process.exit(0);
});

process.on("uncaughtException", async (err) => {
  logger.error("Uncaught Exception", { error: err });
  await traceManager.flushPendingTraces();
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled Promise Rejection", { error: reason });
});

module.exports = { logger, traceManager };