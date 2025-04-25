"use strict";

// Load environment variables from .env file
require('dotenv').config();

// Import the http/https modules for direct API calls
const https = require('https');

// Create a logger
const logger = {
  info: (msg) => console.log(`[INFO] ${msg}`),
  error: (msg, err) => console.error(`[ERROR] ${msg}`, err),
  debug: (msg) => console.log(`[DEBUG] ${msg}`)
};

// Get API key from environment
const apiKey = process.env.LANGWATCH_API_KEY;
const endpoint = process.env.LANGWATCH_ENDPOINT || 'https://app.langwatch.ai';

logger.info(`Using LangWatch endpoint: ${endpoint}`);
logger.info(`API Key: ${apiKey ? apiKey.substring(0, 10) + '...' : 'Not set'}`);

// Create a test trace exactly matching the example format
const testTrace = {
  "trace_id": "trace-" + Date.now(),
  "spans": [
    {
      "type": "llm",
      "span_id": "span-" + Date.now(),
      "vendor": "openai",
      "model": "gpt-4",
      "input": {
        "type": "chat_messages",
        "value": [
          {
            "role": "user",
            "content": "Input to the LLM"
          }
        ]
      },
      "output": {
        "type": "chat_messages",
        "value": [
          {
            "role": "assistant",
            "content": "Output from the LLM",
            "function_call": null,
            "tool_calls": []
          }
        ]
      },
      "params": {
        "temperature": 0.7,
        "stream": false
      },
      "metrics": {
        "prompt_tokens": 100,
        "completion_tokens": 150
      },
      "timestamps": {
        "started_at": Date.now() - 2000,
        "finished_at": Date.now()
      }
    }
  ],
  "metadata": {
    "user_id": "test_user",
    "thread_id": "test_thread",
    "customer_id": "n8n_test",
    "labels": ["test_label_1", "test_label_2"]
  }
};

// Function to send data to LangWatch
function sendToLangWatch(data) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(data);
    const url = new URL(`${endpoint}/api/collector`);
    
    logger.debug("Sending data to LangWatch:");
    logger.debug(`- Endpoint: ${url.toString()}`);
    logger.debug(`- API Key: ${apiKey ? apiKey.substring(0, 10) + '...' : 'undefined'}`);
    logger.debug(`- Payload size: ${Buffer.byteLength(payload)} bytes`);
    logger.debug(`- Payload: ${payload}`);
    
    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === "https:" ? 443 : 80),
      path: url.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
        "X-Auth-Token": apiKey
      }
    };

    const req = https.request(options, (res) => {
      let responseData = "";
      
      res.on("data", (chunk) => {
        responseData += chunk;
      });
      
      res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          logger.info(`Successfully sent data to LangWatch`);
          resolve(responseData);
        } else {
          logger.error(`Error sending data to LangWatch: ${res.statusCode} - ${responseData}`);
          logger.debug("Response headers:", res.headers);
          reject(new Error(`HTTP error ${res.statusCode}: ${responseData}`));
        }
      });
    });

    req.on("error", (error) => {
      logger.error("Error sending data to LangWatch:", error);
      reject(error);
    });

    req.write(payload);
    req.end();
  });
}

// Send the test trace
logger.info("Sending test trace to LangWatch...");
sendToLangWatch(testTrace)
  .then(response => {
    logger.info("Test trace sent successfully!");
    if (response) {
      logger.debug("Response:", response);
    }
    process.exit(0);
  })
  .catch(error => {
    logger.error("Failed to send test trace:", error);
    process.exit(1);
  });
