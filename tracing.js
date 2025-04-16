"use strict";

console.log('Loading simplified LangWatch integration for n8n...');

// Load our adapter that handles the instrumentation module correctly
try {
  const initializeInstrumentation = require('./tracing-adapter');
  console.log('Adapter loaded successfully, calling initialization...');
  
  const result = initializeInstrumentation();
  console.log(`Instrumentation setup ${result ? 'successful' : 'failed'}`);
} catch (error) {
  console.error('Error loading or running adapter:', error);
}

console.log('LangWatch initialization complete - n8n is starting');