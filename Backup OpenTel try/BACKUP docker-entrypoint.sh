#!/bin/sh
# docker-entrypoint.sh

echo "n8n with LangWatch OpenTelemetry integration"

# Set OpenTelemetry environment variables for LangWatch
export OTEL_SERVICE_NAME="${OTEL_SERVICE_NAME:-n8n}"
export OTEL_EXPORTER_OTLP_PROTOCOL="http/protobuf"
export OTEL_EXPORTER_OTLP_ENDPOINT="${OTEL_EXPORTER_OTLP_ENDPOINT:-https://app.langwatch.ai}"

# No longer using these env vars in this file since we hardcode the full URL in tracing.js
# export OTEL_EXPORTER_OTLP_TRACES_ENDPOINT="${OTEL_EXPORTER_OTLP_ENDPOINT}/api/otel/v1/traces"
# export OTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer ${LANGWATCH_API_KEY}"

echo "OTEL_EXPORTER_OTLP_ENDPOINT: ${OTEL_EXPORTER_OTLP_ENDPOINT}"
echo "LANGWATCH_API_KEY is ${LANGWATCH_API_KEY:+set}"

# Start n8n with OpenTelemetry instrumentation
echo "Starting n8n with LangWatch OpenTelemetry integration..."
exec node --require /usr/local/lib/node_modules/n8n/tracing.js /usr/local/bin/n8n