// tracing.js
"use strict";

const opentelemetry = require("@opentelemetry/sdk-node");
const { OTLPTraceExporter } = require("@opentelemetry/exporter-trace-otlp-http");
const { getNodeAutoInstrumentations } = require("@opentelemetry/auto-instrumentations-node");
const { registerInstrumentations } = require("@opentelemetry/instrumentation");
const { SemanticResourceAttributes } = require("@opentelemetry/semantic-conventions");
const setupN8nLangWatchInstrumentation = require("./n8n-langwatch-instrumentation");
const winston = require("winston");

// Configure logger
const logger = winston.createLogger({
  level: process.env.OTEL_LOG_LEVEL?.toLowerCase() || "info",
  format: winston.format.json(),
  transports: [new winston.transports.Console()]
});

// Configure auto-instrumentations
const autoInstrumentations = getNodeAutoInstrumentations({
  "@opentelemetry/instrumentation-dns": { enabled: false },
  "@opentelemetry/instrumentation-net": { enabled: false },
  "@opentelemetry/instrumentation-tls": { enabled: false },
  "@opentelemetry/instrumentation-fs": { enabled: false },
  "@opentelemetry/instrumentation-pg": {
    enhancedDatabaseReporting: true
  }
});

registerInstrumentations({
  instrumentations: [autoInstrumentations]
});

// Parse the exact trace endpoint URL
// LangWatch expects the traces at /api/collector/traces or /api/otel/v1/traces
const apiKey = process.env.LANGWATCH_API_KEY || "";
const baseUrl = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || "https://app.langwatch.ai";
// Try different endpoint paths
const collectorUrl = `${baseUrl}/api/collector/traces`;

logger.info(`Using LangWatch collector URL: ${collectorUrl}`);

// Parse the headers string into an object
let headers = {};
if (apiKey) {
  headers = { "X-Auth-Token": apiKey };
  logger.info("API Key configured for LangWatch");
}

// Set up custom n8n instrumentation
setupN8nLangWatchInstrumentation();

// Initialize and start the OpenTelemetry SDK
const sdk = new opentelemetry.NodeSDK({
  resourceAttributes: {
    [SemanticResourceAttributes.SERVICE_NAME]: process.env.OTEL_SERVICE_NAME || "n8n",
  },
  traceExporter: new OTLPTraceExporter({
    url: collectorUrl,
    headers: headers
  })
});

// Handle exceptions
process.on("uncaughtException", async (err) => {
  logger.error("Uncaught Exception", { error: err });
  try {
    await sdk.forceFlush();
  } catch (flushErr) {
    logger.error("Error flushing telemetry data", { error: flushErr });
  }
});

process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled Promise Rejection", { error: reason });
});

try {
  sdk.start();
  logger.info("OpenTelemetry SDK started successfully");
} catch (error) {
  logger.error("Failed to start OpenTelemetry SDK", { error });
}