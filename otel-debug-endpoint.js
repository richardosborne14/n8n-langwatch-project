"use strict";

const http = require('http');
const fs = require('fs');
const path = require('path');

// Configuration
const PORT = process.env.DEBUG_ENDPOINT_PORT || 3000;
const LOG_DIR = path.join(__dirname, 'otel_logs');

// Ensure log directory exists
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

// Create a timestamp-based log filename
function getLogFilename() {
  const now = new Date();
  return path.join(
    LOG_DIR, 
    `otel_trace_${now.toISOString().replace(/[:.]/g, '-')}.json`
  );
}

// Create HTTP server
const server = http.createServer((req, res) => {
  // Only accept POST requests to /debug-otel
  if (req.method === 'POST' && req.url === '/debug-otel') {
    console.log(`[${new Date().toISOString()}] Received OpenTelemetry data`);
    
    let body = '';
    
    req.on('data', (chunk) => {
      body += chunk.toString();
    });
    
    req.on('end', () => {
      try {
        // Parse the JSON to validate and format it
        const data = JSON.parse(body);
        
        // Enhanced logging with more details
        console.log('=== RECEIVED OTEL DATA ===');
        console.log(`Trace ID: ${data.trace_id || 'unknown'}`);
        console.log(`Number of spans: ${data.spans ? data.spans.length : 0}`);
        
        // Log workflow information if available
        if (data.workflow_execution) {
          console.log('\n=== WORKFLOW EXECUTION ===');
          console.log(`Workflow ID: ${data.workflow_execution.id}`);
          console.log(`Workflow Name: ${data.workflow_execution.name}`);
          console.log(`Duration: ${data.workflow_execution.duration_ms ? data.workflow_execution.duration_ms.toFixed(2) : 'unknown'}ms`);
          console.log(`Nodes: ${data.workflow_execution.nodes ? data.workflow_execution.nodes.length : 0}`);
          
          // Log node information
          if (data.workflow_execution.nodes && data.workflow_execution.nodes.length > 0) {
            console.log('\n=== NODE EXECUTIONS ===');
            data.workflow_execution.nodes.forEach((node, index) => {
              console.log(`\n[${index + 1}] ${node.name} (${node.type})`);
              console.log(`  Duration: ${node.duration_ms ? node.duration_ms.toFixed(2) : 'unknown'}ms`);
              
              // Log output summary if available
              if (node.output) {
                if (Array.isArray(node.output)) {
                  console.log(`  Output: Array with ${node.output.length} items`);
                } else if (typeof node.output === 'object') {
                  console.log(`  Output: Object with keys: ${Object.keys(node.output).join(', ')}`);
                } else {
                  console.log(`  Output: ${typeof node.output}`);
                }
              }
            });
          }
        }
        
        // Write to file with timestamp
        const logFile = getLogFilename();
        fs.writeFileSync(
          logFile, 
          JSON.stringify(data, null, 2)
        );
        console.log(`\nData written to ${logFile}`);
        
        // Send success response
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          status: 'success', 
          message: 'Data received and logged',
          logFile
        }));
      } catch (error) {
        console.error('Error processing data:', error);
        
        // Log raw data to file in case of parsing error
        const errorLogFile = path.join(LOG_DIR, `error_${Date.now()}.txt`);
        fs.writeFileSync(errorLogFile, body);
        console.log(`Raw data written to ${errorLogFile}`);
        
        // Send error response
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          status: 'error', 
          message: `Error processing data: ${error.message}`,
          errorLogFile
        }));
      }
    });
  } else {
    // Handle other requests
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'error', message: 'Not found' }));
  }
});

// Start the server
server.listen(PORT, () => {
  console.log(`OpenTelemetry debug endpoint listening on port ${PORT}`);
  console.log(`POST your OpenTelemetry data to http://localhost:${PORT}/debug-otel`);
  console.log(`Logs will be saved to ${LOG_DIR}`);
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('Received SIGTERM, shutting down server');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('Received SIGINT, shutting down server');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
