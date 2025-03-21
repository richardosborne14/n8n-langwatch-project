// tracing.js
"use strict";

// Set up async context manager for proper context propagation
const { AsyncHooksContextManager } = require("@opentelemetry/context-async-hooks");
const { context } = require("@opentelemetry/api");
const contextManager = new AsyncHooksContextManager();
context.setGlobalContextManager(contextManager.enable());

const opentelemetry = require("@opentelemetry/sdk-node");
const { OTLPTraceExporter } = require("@opentelemetry/exporter-trace-otlp-http");
const { getNodeAutoInstrumentations } = require("@opentelemetry/auto-instrumentations-node");
const { registerInstrumentations } = require("@opentelemetry/instrumentation");
const { Resource } = require("@opentelemetry/resources");
const { SemanticResourceAttributes } = require("@opentelemetry/semantic-conventions");
const logger = require("./logger");

// Import the n8n instrumentation
const setupN8nLangWatchInstrumentation = require("./n8n-langwatch-instrumentation");

// Set up n8n instrumentation
logger.info("Setting up n8n LangWatch instrumentation");
setupN8nLangWatchInstrumentation();

// Configure OpenTelemetry auto-instrumentations
const autoInstrumentations = getNodeAutoInstrumentations({
  // Disable some instrumentations that aren't useful for LangWatch
  "@opentelemetry/instrumentation-dns": { enabled: false },
  "@opentelemetry/instrumentation-net": { enabled: false },
  "@opentelemetry/instrumentation-tls": { enabled: false },
  "@opentelemetry/instrumentation-fs": { enabled: false },
  // But enable detailed database monitoring
  "@opentelemetry/instrumentation-pg": {
    enhancedDatabaseReporting: true
  },
  // Add HTTP instrumentation for API calls
  "@opentelemetry/instrumentation-http": {
    ignoreIncomingPaths: ['/healthcheck', '/favicon.ico'],
    // Capture request and response bodies for API calls
    applyCustomAttributesOnSpan: (span, request, response) => {
      // Only track bodies for requests that match LLM API endpoints
      const url = request.url?.toString() || '';
      if (url.includes('openai.com') || 
          url.includes('api.anthropic.com') || 
          url.includes('api.mistral.ai')) {
        try {
          span.setAttribute('http.request.body', 
            typeof request.body === 'string' 
              ? request.body 
              : JSON.stringify(request.body)
          );
          
          if (response.body) {
            span.setAttribute('http.response.body', 
              typeof response.body === 'string'
                ? response.body
                : JSON.stringify(response.body)
            );
          }
        } catch (e) {
          logger.debug(`Error capturing HTTP body: ${e.message}`);
        }
      }
    }
  }
});

registerInstrumentations({
  instrumentations: [autoInstrumentations]
});

// Parse the LangWatch endpoint URL
const apiKey = process.env.LANGWATCH_API_KEY || "";
const baseUrl = process.env.LANGWATCH_ENDPOINT || "https://app.langwatch.ai";
// Try different endpoint paths based on LangWatch docs
const collectorUrl = `${baseUrl}/api/collector/traces`;

logger.info(`Using LangWatch collector URL: ${collectorUrl}`);

// Set up headers for LangWatch
let headers = {};
if (apiKey) {
  headers = { "X-Auth-Token": apiKey };
  logger.info("API Key configured for LangWatch");
}

// Initialize and start the OpenTelemetry SDK
const sdk = new opentelemetry.NodeSDK({
  resource: new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: "n8n",
    [SemanticResourceAttributes.SERVICE_VERSION]: process.env.N8N_VERSION || "unknown",
  }),
  traceExporter: new OTLPTraceExporter({
    url: collectorUrl,
    headers: headers
  })
});

// Handle uncaught exceptions 
process.on("uncaughtException", async (err) => {
  logger.error(`Uncaught Exception: ${err.message}`);
  logger.error(err.stack);
  
  try {
    await sdk.forceFlush();
  } catch (flushErr) {
    logger.error(`Error flushing telemetry data: ${flushErr.message}`);
  }
});

process.on("unhandledRejection", (reason) => {
  logger.error(`Unhandled Promise Rejection: ${String(reason)}`);
});

try {
  sdk.start();
  logger.info("OpenTelemetry SDK started successfully");
} catch (error) {
  logger.error(`Failed to start OpenTelemetry SDK: ${error.message}`);
}