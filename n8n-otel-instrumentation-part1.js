"use strict";

const { trace, context, SpanStatusCode, SpanKind } = require('@opentelemetry/api');
const flat = require('flat');
const winston = require('winston');

// Create a logger
const logLevel = process.env.LANGWATCH_LOG_LEVEL || "info";
const logger = winston.createLogger({
  level: logLevel,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [new winston.transports.Console()]
});

// List of AI-related node types to monitor closely
const AI_NODE_TYPES = [
  'n8n-nodes-base.openAi',
  'n8n-nodes-base.openAiChat',
  'n8n-nodes-base.openAiAssistant', 
  'n8n-nodes-base.anthropic',
  'n8n-nodes-base.claude',
  'n8n-nodes-base.gpt',
  'n8n-nodes-base.llm',
  'n8n-nodes-base.chatModel',
  'n8n-nodes-base.textGeneration',
  'n8n-nodes-base.gemini',
  'n8n-nodes-base.mistral',
  'n8n-nodes-base.huggingFace',
  'n8n-nodes-base.microsoftAzureOpenAI',
  'n8n-nodes-base.googlePalm',
  'n8n-nodes-base.cohere',
  'n8n-nodes-base.ollama',
  // Add more as needed
];

// AI-related keywords to check in node names
const AI_NODE_KEYWORDS = [
  'openai', 'gpt', 'claude', 'anthropic', 'llm', 'chatgpt', 
  'completion', 'chat', 'ai', 'generative', 'mistral', 
  'gemini', 'palm', 'cohere', 'huggingface', 'ollama'
];

// Tracer for the instrumentation
const tracer = trace.getTracer('n8n-instrumentation', '1.0.0');

/**
 * Determines if a node is AI-related based on type or name
 * @param {string} nodeType Node type ID
 * @param {string} nodeName Node name
 * @returns {boolean} Whether the node is AI-related
 */
function isAINode(nodeType, nodeName) {
  // Check if it's a known AI node type
  if (AI_NODE_TYPES.some(type => nodeType?.includes(type))) {
    return true;
  }
  
  // Check node name for common AI keywords
  if (nodeName && AI_NODE_KEYWORDS.some(keyword => 
    nodeName.toLowerCase().includes(keyword.toLowerCase())
  )) {
    return true;
  }
  
  return false;
}

/**
 * Extract AI-specific parameters from node parameters
 * @param {object} parameters Node parameters object
 * @returns {object} AI-specific parameters
 */
function extractAIParameters(parameters) {
  if (!parameters) return {};
  
  // Common AI-specific parameters to extract
  const aiParams = {};
  
  // Extract model information
  if (parameters.model) {
    aiParams.model = parameters.model;
  }
  
  // Extract temperature
  if (parameters.temperature !== undefined) {
    aiParams.temperature = parameters.temperature;
  }
  
  // Extract max tokens
  if (parameters.maxTokens !== undefined || parameters.max_tokens !== undefined) {
    aiParams.max_tokens = parameters.maxTokens || parameters.max_tokens;
  }
  
  // Extract top p
  if (parameters.top_p !== undefined || parameters.topP !== undefined) {
    aiParams.top_p = parameters.top_p || parameters.topP;
  }
  
  // Extract top k
  if (parameters.top_k !== undefined || parameters.topK !== undefined) {
    aiParams.top_k = parameters.top_k || parameters.topK;
  }
  
  // Extract presence and frequency penalties
  if (parameters.presence_penalty !== undefined || parameters.presencePenalty !== undefined) {
    aiParams.presence_penalty = parameters.presence_penalty || parameters.presencePenalty;
  }
  
  if (parameters.frequency_penalty !== undefined || parameters.frequencyPenalty !== undefined) {
    aiParams.frequency_penalty = parameters.frequency_penalty || parameters.frequencyPenalty;
  }
  
  return aiParams;
}
