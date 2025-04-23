"use strict";

const LangWatchExporter = require('./langwatch-exporter');

// Create a test trace
const testTrace = {
  trace_id: "test-trace-" + Date.now(),
  spans: [
    {
      type: "llm",
      span_id: "test-span-" + Date.now(),
      vendor: "openai",
      model: "gpt-3.5-turbo",
      input: {
        type: "text",
        value: "Write a short poem about automation."
      },
      output: {
        type: "text",
        value: "Silicon servants work with grace,\nAutomation sets the pace.\nTasks once manual, now set free,\nEfficiency's sweet symphony."
      },
      timestamps: {
        started_at: Date.now() - 2000,
        finished_at: Date.now()
      }
    }
  ],
  metadata: {
    user_id: "test-user",
    thread_id: "test-thread",
    customer_id: "n8n-test",
    labels: [
      "workflow:test-workflow",
      "node:OpenAI",
      "node_type:n8n-nodes-base.openAi"
    ]
  }
};

// Create the exporter
const exporter = new LangWatchExporter({
  apiKey: process.env.LANGWATCH_API_KEY,
  endpoint: process.env.LANGWATCH_ENDPOINT || 'https://app.langwatch.ai',
  serviceName: 'n8n-test'
});

// Send the test trace
console.log("Sending test trace to LangWatch...");
exporter.sendToLangWatch(testTrace)
  .then(() => {
    console.log("Test trace sent successfully!");
    process.exit(0);
  })
  .catch(error => {
    console.error("Error sending test trace:", error);
    process.exit(1);
  });