"use strict";

// Enable proper async context propagation globally.
const { AsyncHooksContextManager } = require("@opentelemetry/context-async-hooks");
const { context } = require("@opentelemetry/api");
const contextManager = new AsyncHooksContextManager();
context.setGlobalContextManager(contextManager.enable());

const opentelemetry = require("@opentelemetry/sdk-node");
const { getNodeAutoInstrumentations } = require("@opentelemetry/auto-instrumentations-node");
const { registerInstrumentations } = require("@opentelemetry/instrumentation");
const { Resource } = require("@opentelemetry/resources");
const { SemanticResourceAttributes } = require("@opentelemetry/semantic-conventions");
const { BatchSpanProcessor } = require("@opentelemetry/sdk-trace-base");
const LangWatchExporter = require("./langwatch-exporter");
const winston = require("winston");

// Create a logger
const logLevel = process.env.LANGWATCH_LOG_LEVEL || "info";
const logger = winston.createLogger({
  level: logLevel,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(info => `${info.timestamp} [${info.level.toUpperCase()}] ${info.message}`)
  ),
  transports: [new winston.transports.Console()]
});

logger.info(`Starting n8n with LangWatch integration (log level: ${logLevel})`);

// Check for required environment variables
if (!process.env.LANGWATCH_API_KEY) {
  logger.warn('LANGWATCH_API_KEY environment variable is not set. Traces will not be sent to LangWatch.');
}

// Configure auto-instrumentations
const autoInstrumentations = getNodeAutoInstrumentations({
  "@opentelemetry/instrumentation-dns": { enabled: false },
  "@opentelemetry/instrumentation-net": { enabled: false },
  "@opentelemetry/instrumentation-tls": { enabled: false },
  "@opentelemetry/instrumentation-fs": { enabled: false },
  // Enable enhanced database reporting for more context in spans
  "@opentelemetry/instrumentation-pg": {
    enhancedDatabaseReporting: true,
  },
  "@opentelemetry/instrumentation-mysql": {
    enhancedDatabaseReporting: true,
  },
  // More detailed HTTP instrumentation
  "@opentelemetry/instrumentation-http": {
    ignoreIncomingPaths: [
      '/healthz',
      '/metrics',
      '/favicon.ico'
    ],
  }
});

// Register instrumentations
registerInstrumentations({
  instrumentations: [autoInstrumentations],
});

// Create the LangWatch exporter
const langWatchExporter = new LangWatchExporter({
  apiKey: process.env.LANGWATCH_API_KEY,
  endpoint: process.env.LANGWATCH_ENDPOINT || 'https://app.langwatch.ai',
  serviceName: process.env.OTEL_SERVICE_NAME || 'n8n',
  logger: logger
});

// Set up a custom span processor that will batch spans and send them to LangWatch
const batchSpanProcessor = new BatchSpanProcessor(langWatchExporter, {
  // Ensure quick processing for testing
  scheduledDelayMillis: 1000, // How often to send batches
  maxExportBatchSize: 10,     // Max number of spans to send in a batch
  exportTimeoutMillis: 30000  // Timeout for exporting spans
});

// Create a NodeSDK instance with our custom processor
const sdk = new opentelemetry.NodeSDK({
  spanProcessor: batchSpanProcessor,
  resource: new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: process.env.OTEL_SERVICE_NAME || "n8n",
    [SemanticResourceAttributes.SERVICE_VERSION]: process.env.OTEL_SERVICE_VERSION || "unknown",
    [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV || "production",
    // Add custom resource attributes
    'n8n.version': process.env.N8N_VERSION || "unknown",
    'n8n.instance_id': process.env.N8N_INSTANCE_ID || "default"
  }),
  instrumentations: [autoInstrumentations]
});

// Try to load n8n-specific instrumentation
try {
  logger.info('Loading n8n-specific OpenTelemetry instrumentation');
  const setupN8nOpenTelemetry = require("./n8n-otel-instrumentation");
  setupN8nOpenTelemetry();
  logger.info('n8n-specific OpenTelemetry instrumentation loaded successfully');
} catch (error) {
  logger.error('Failed to load n8n-specific OpenTelemetry instrumentation:', error);
}

// Handle uncaught exceptions
process.on("uncaughtException", async (err) => {
  logger.error("Uncaught Exception: " + (err.stack || err.message));
  
  try {
    logger.info("Flushing telemetry data before exit");
    await sdk.shutdown();
  } catch (flushErr) {
    logger.error("Error flushing telemetry data: " + flushErr.message);
  }
  
  process.exit(1);
});

// Handle unhandled promise rejections
process.on("unhandledRejection", (reason, promise) => {
  logger.error("Unhandled Promise Rejection: " + (reason instanceof Error ? reason.stack : reason));
});

// Handle SIGTERM for graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM signal, shutting down OpenTelemetry');
  try {
    await sdk.shutdown();
    logger.info('OpenTelemetry shutdown complete');
  } catch (err) {
    logger.error('Error during OpenTelemetry shutdown: ' + err.message);
  }
});

// Start the SDK
logger.info('Starting OpenTelemetry SDK');
sdk.start()
  .then(() => {
    logger.info('OpenTelemetry SDK with LangWatch exporter started successfully');
  })
  .catch((error) => {
    logger.error('Error starting OpenTelemetry SDK: ' + error.message);
  });

// Make exporter available globally for manual trace sending if needed
global.langWatchExporter = langWatchExporter;

// Export for testing purposes
module.exports = { sdk, langWatchExporter };