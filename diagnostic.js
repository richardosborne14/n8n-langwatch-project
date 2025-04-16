"use strict";

/**
 * n8n-LangWatch Integration Diagnostic Tool
 * 
 * This script performs a diagnostic check of the n8n environment and
 * the required dependencies for LangWatch integration.
 * 
 * Run inside your n8n container with:
 * node diagnostic.js
 */

const fs = require('fs');
const path = require('path');

console.log('=========================================');
console.log('n8n LangWatch Integration Diagnostic Tool');
console.log('=========================================');

// Check Node.js version
console.log('\n📌 Node.js Environment:');
console.log(`Node.js version: ${process.version}`);
console.log(`Platform: ${process.platform}`);
console.log(`Architecture: ${process.arch}`);

// Check environment variables
console.log('\n📌 Environment Variables:');
console.log(`LANGWATCH_API_KEY: ${process.env.LANGWATCH_API_KEY ? '✅ Set' : '❌ Not set'}`);
console.log(`LANGWATCH_ENDPOINT: ${process.env.LANGWATCH_ENDPOINT || 'Not set (will use default)'}`);
console.log(`LANGWATCH_LOG_LEVEL: ${process.env.LANGWATCH_LOG_LEVEL || 'Not set (will use default)'}`);

// Check required files
console.log('\n📌 Required Files:');
const n8nDir = '/usr/local/lib/node_modules/n8n';
const requiredFiles = [
  { path: path.join(n8nDir, 'tracing.js'), name: 'Tracing entry point' },
  { path: path.join(n8nDir, 'tracing-adapter.js'), name: 'Tracing adapter' },
  { path: path.join(n8nDir, 'n8n-langwatch-instrumentation.js'), name: 'Main instrumentation' },
  { path: path.join(n8nDir, 'instrumentation/n8n-langwatch-instrumentation.js'), name: 'Directory instrumentation' },
  { path: '/docker-entrypoint.sh', name: 'Docker entrypoint' }
];

requiredFiles.forEach(file => {
  try {
    const exists = fs.existsSync(file.path);
    console.log(`${file.name}: ${exists ? '✅ Found' : '❌ Missing'} (${file.path})`);
    
    if (exists) {
      const stats = fs.statSync(file.path);
      console.log(`  - Size: ${stats.size} bytes`);
      console.log(`  - Permissions: ${stats.mode.toString(8).slice(-3)}`);
      
      // Check if it's readable
      try {
        const content = fs.readFileSync(file.path, 'utf8');
        console.log(`  - Content: ${content.length > 0 ? '✅ Not empty' : '❌ Empty'}`);
      } catch (e) {
        console.log(`  - Content: ❌ Can't read (${e.message})`);
      }
    }
  } catch (error) {
    console.log(`${file.name}: ❌ Error checking (${error.message})`);
  }
});

// Check required dependencies
console.log('\n📌 Required Dependencies:');
const requiredDeps = [
  '@opentelemetry/api',
  '@opentelemetry/context-async-hooks',
  '@opentelemetry/auto-instrumentations-node',
  '@opentelemetry/instrumentation',
  '@opentelemetry/sdk-node',
  '@opentelemetry/resources',
  '@opentelemetry/semantic-conventions',
  'winston',
  'flat'
];

requiredDeps.forEach(dep => {
  try {
    const module = require(dep);
    console.log(`${dep}: ✅ Found`);
    
    // For OpenTelemetry API, check if trace is available
    if (dep === '@opentelemetry/api') {
      console.log(`  - trace: ${module.trace ? '✅ Available' : '❌ Missing'}`);
      console.log(`  - context: ${module.context ? '✅ Available' : '❌ Missing'}`);
      console.log(`  - SpanKind: ${module.SpanKind ? '✅ Available' : '❌ Missing'}`);
    }
  } catch (error) {
    console.log(`${dep}: ❌ Missing or error (${error.message})`);
  }
});

// Try importing n8n core
console.log('\n📌 n8n Core Module:');
try {
  const n8nCore = require('n8n-core');
  console.log('n8n-core: ✅ Found');
  
  if (n8nCore.WorkflowExecute) {
    console.log('  - WorkflowExecute: ✅ Available');
    
    // Check for required methods
    const methods = [
      'processRunExecutionData',
      'runNode'
    ];
    
    methods.forEach(method => {
      console.log(`  - WorkflowExecute.prototype.${method}: ${
        typeof n8nCore.WorkflowExecute.prototype[method] === 'function' ? 
        '✅ Available' : 
        '❌ Missing'
      }`);
    });
  } else {
    console.log('  - WorkflowExecute: ❌ Missing');
  }
} catch (error) {
  console.log(`n8n-core: ❌ Missing or error (${error.message})`);
}

// Try to load the instrumentation module
console.log('\n📌 Instrumentation Module:');
try {
  let instrumentationModule;
  
  try {
    instrumentationModule = require(path.join(n8nDir, 'n8n-langwatch-instrumentation.js'));
    console.log('Root instrumentation module: ✅ Loaded');
  } catch (rootError) {
    console.log(`Root instrumentation module: ❌ Failed to load (${rootError.message})`);
    
    try {
      instrumentationModule = require(path.join(n8nDir, 'instrumentation/n8n-langwatch-instrumentation.js'));
      console.log('Directory instrumentation module: ✅ Loaded');
    } catch (dirError) {
      console.log(`Directory instrumentation module: ❌ Failed to load (${dirError.message})`);
    }
  }
  
  if (instrumentationModule) {
    console.log(`Module type: ${typeof instrumentationModule}`);
    
    if (typeof instrumentationModule === 'function') {
      console.log('setupN8nLangWatchInstrumentation: ✅ Found (as main export)');
    } else if (typeof instrumentationModule === 'object') {
      const hasSetup = typeof instrumentationModule.setupN8nLangWatchInstrumentation === 'function';
      console.log(`setupN8nLangWatchInstrumentation: ${hasSetup ? '✅ Found' : '❌ Missing'}`);
      
      console.log(`Available exports: ${Object.keys(instrumentationModule).join(', ')}`);
    } else {
      console.log(`Unexpected module type: ${typeof instrumentationModule}`);
    }
  }
} catch (error) {
  console.log(`Loading instrumentation: ❌ Error (${error.message})`);
}

console.log('\n=========================================');
console.log('Diagnostic complete');
console.log('=========================================');