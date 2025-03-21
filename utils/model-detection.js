// utils/model-detection.js - Utilities for detecting LLM models
const { logger } = require('../logger');

/**
 * Detect if a node is an AI/LLM node
 * @param {Object} node - Node definition
 * @returns {boolean} True if node is an AI/LLM node
 */
function isAINode(node) {
  if (!node) return false;
  
  const nodeType = node.type?.toLowerCase() || '';
  const nodeName = node.name?.toLowerCase() || '';
  
  // Check node type
  if (
    nodeType.includes('ai') ||
    nodeType.includes('openai') ||
    nodeType.includes('llm') ||
    nodeType.includes('gpt') ||
    nodeType.includes('agent') ||
    nodeType.includes('chat') ||
    nodeType.includes('completion') ||
    nodeType.includes('langchain')
  ) {
    return true;
  }
  
  // Check node name patterns
  if (
    nodeName.includes('ai') ||
    nodeName.includes('openai') ||
    nodeName.includes('llm') ||
    nodeName.includes('gpt') ||
    nodeName.includes('agent') ||
    nodeName.includes('chat') ||
    nodeName.includes('completion')
  ) {
    return true;
  }
  
  // Deep inspection of parameters
  if (node.parameters) {
    if (
      node.parameters.model || 
      node.parameters.prompt || 
      node.parameters.system || 
      node.parameters.messages ||
      (node.parameters.options && node.parameters.options.model)
    ) {
      return true;
    }
  }
  
  return false;
}

/**
 * Detect model information from node
 * @param {Object} node - Node definition
 * @returns {Object} Model information (vendor and model)
 */
function detectModelInfo(node) {
  let modelInfo = {
    vendor: "n8n",
    model: "unknown"
  };
  
  if (!node) return modelInfo;
  
  // Check for LangChain agent model
  if (node.parameters && node.parameters.options && node.parameters.options.model) {
    const modelParam = node.parameters.options.model;
    
    if (typeof modelParam === 'string') {
      modelInfo.model = modelParam;
      
      // Attempt to determine vendor from model name
      if (modelParam.includes('gpt') || modelParam.startsWith('text-') || modelParam.includes('davinci')) {
        modelInfo.vendor = 'openai';
      } else if (modelParam.includes('claude')) {
        modelInfo.vendor = 'anthropic';
      } else if (modelParam.includes('gemini')) {
        modelInfo.vendor = 'google';
      } else if (modelParam.includes('mistral')) {
        modelInfo.vendor = 'mistral';
      } else if (modelParam.includes('llama')) {
        modelInfo.vendor = 'meta';
      }
    }
  }
  
  // Check for direct model parameter
  if (node.parameters && node.parameters.model && modelInfo.model === 'unknown') {
    const modelParam = node.parameters.model;
    
    if (typeof modelParam === 'string') {
      modelInfo.model = modelParam;
      
      // Attempt to determine vendor from model name
      if (modelParam.includes('gpt') || modelParam.startsWith('text-') || modelParam.includes('davinci')) {
        modelInfo.vendor = 'openai';
      } else if (modelParam.includes('claude')) {
        modelInfo.vendor = 'anthropic';
      } else if (modelParam.includes('gemini')) {
        modelInfo.vendor = 'google';
      } else if (modelParam.includes('mistral')) {
        modelInfo.vendor = 'mistral';
      } else if (modelParam.includes('llama')) {
        modelInfo.vendor = 'meta';
      }
    }
  }
  
  // Look for credentials for better vendor detection
  if (node.credentials) {
    // Map credential types to vendors
    if (Object.keys(node.credentials).some(key => key.includes('openai'))) {
      modelInfo.vendor = 'openai';
    } else if (Object.keys(node.credentials).some(key => key.includes('anthropic'))) {
      modelInfo.vendor = 'anthropic';
    } else if (Object.keys(node.credentials).some(key => key.includes('google'))) {
      modelInfo.vendor = 'google';
    } else if (Object.keys(node.credentials).some(key => key.includes('mistral'))) {
      modelInfo.vendor = 'mistral';
    }
  }
  
  // n8n OpenAI nodes
  if (node.type && node.type.includes('openai')) {
    modelInfo.vendor = 'openai';
    // Try to extract model from parameters
    if (node.parameters && node.parameters.model) {
      modelInfo.model = node.parameters.model;
    } else {
      modelInfo.model = 'gpt-4';  // Likely default
    }
  }
  
  // We can guess the model if credential type is available
  if (node.type === '@n8n/n8n-nodes-langchain.agent' || node.type === '@n8n/n8n-nodes-langchain.llm') {
    if (modelInfo.vendor === 'openai' && modelInfo.model === 'unknown') {
      modelInfo.model = 'gpt-4';  // Default model for OpenAI in LangChain nodes
    }
  }
  
  logger.debug(`Detected model: ${modelInfo.vendor}/${modelInfo.model} for node ${node.name}`);
  return modelInfo;
}

/**
 * Extract model parameters from node
 * @param {Object} node - Node definition
 * @returns {Object} Model parameters
 */
function extractModelParameters(node) {
  const parameters = node.parameters || {};
  const modelParams = {};
  
  // Extract parameters from different places
  if (parameters.temperature !== undefined) {
    modelParams.temperature = parameters.temperature;
  } else if (parameters.options && parameters.options.temperature !== undefined) {
    modelParams.temperature = parameters.options.temperature;
  }
  
  if (parameters.maxTokens !== undefined) {
    modelParams.max_tokens = parameters.maxTokens;
  } else if (parameters.options && parameters.options.maxTokens !== undefined) {
    modelParams.max_tokens = parameters.options.maxTokens;
  }
  
  if (parameters.topP !== undefined) {
    modelParams.top_p = parameters.topP;
  } else if (parameters.options && parameters.options.topP !== undefined) {
    modelParams.top_p = parameters.options.topP;
  }
  
  if (parameters.frequencyPenalty !== undefined) {
    modelParams.frequency_penalty = parameters.frequencyPenalty;
  } else if (parameters.options && parameters.options.frequencyPenalty !== undefined) {
    modelParams.frequency_penalty = parameters.options.frequencyPenalty;
  }
  
  if (parameters.presencePenalty !== undefined) {
    modelParams.presence_penalty = parameters.presencePenalty;
  } else if (parameters.options && parameters.options.presencePenalty !== undefined) {
    modelParams.presence_penalty = parameters.options.presencePenalty;
  }
  
  if (parameters.stop !== undefined) {
    modelParams.stop = parameters.stop;
  } else if (parameters.options && parameters.options.stop !== undefined) {
    modelParams.stop = parameters.options.stop;
  }
  
  return modelParams;
}

module.exports = {
  isAINode,
  detectModelInfo,
  extractModelParameters
};