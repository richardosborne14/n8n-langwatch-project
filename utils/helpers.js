// utils/helpers.js - Utility functions for n8n LangWatch integration
const { logger } = require('../logger');

/**
 * Get current timestamp in milliseconds
 * @returns {number} Current timestamp
 */
function getTimestamp() {
  return Date.now();
}

/**
 * Estimate token count based on string length
 * @param {string} text - Text to estimate token count for
 * @returns {number} Estimated token count
 */
function estimateTokenCount(text) {
  if (!text) return 0;
  // Very rough estimation: 1 token ≈ 4 characters for English text
  return Math.ceil(String(text).length / 4);
}

/**
 * Resolve n8n template expressions if possible
 * @param {string|any} expr - Expression to resolve
 * @param {Object} data - Data context for resolution
 * @returns {string|any} Resolved expression or original value
 */
function resolveExpression(expr, data) {
  if (typeof expr !== 'string') return expr;
  
  // Simple template expression resolver for n8n style expressions
  if (expr.startsWith('=')) {
    // Remove the equals sign
    const actualExpr = expr.substring(1);
    
    // Handle common expressions
    if (actualExpr.includes('$json.')) {
      // Extract the field name
      const fieldMatch = actualExpr.match(/\$json\.(\w+)/);
      if (fieldMatch && fieldMatch[1]) {
        const fieldName = fieldMatch[1];
        
        // Try to find the value in the data
        if (data && data[fieldName] !== undefined) {
          logger.debug(`Resolved $json.${fieldName} to "${data[fieldName]}"`);
          return data[fieldName];
        }
      }
    }
    
    // For system messages, try to handle date templates
    if (actualExpr.includes('$now.format')) {
      // Replace with current date
      const now = new Date();
      return actualExpr
        .replace(/\{\{\s*\$now\.format\('cccc'\)\s*\}\}/g, now.toLocaleDateString('en-US', { weekday: 'long' }))
        .replace(/\{\{\s*\$now\.format\('yyyy-MM-dd HH:mm'\)\s*\}\}/g, 
          `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ` +
          `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`);
    }
    
    // If we can't resolve it, return without the equals sign
    return actualExpr;
  }
  
  return expr;
}

/**
 * Extract system message from node parameters
 * @param {Object} parameters - Node parameters
 * @returns {string} Extracted system message
 */
function extractSystemMessage(parameters) {
  if (!parameters) return '';
  
  // Check options for systemMessage
  if (parameters.options && parameters.options.systemMessage) {
    return resolveExpression(parameters.options.systemMessage, {});
  }
  
  // Check direct systemMessage parameter
  if (parameters.systemMessage) {
    return resolveExpression(parameters.systemMessage, {});
  }
  
  // Check system parameter
  if (parameters.system) {
    return resolveExpression(parameters.system, {});
  }
  
  return '';
}

/**
 * Extract user input from node data
 * @param {Object} node - Node definition
 * @param {Object} executionData - Node execution data
 * @param {Object} runExecutionData - Run execution data
 * @param {number} runIndex - Run index
 * @returns {string} Extracted user input
 */
function extractUserInput(node, executionData, runExecutionData, runIndex) {
  try {
    // Track all places we check for user input
    const sources = [];
    
    // First, check if we can get chatInput directly from executionData.data.main
    if (executionData.data && executionData.data.main && executionData.data.main.length > 0) {
      const inputData = executionData.data.main[0];
      if (Array.isArray(inputData) && inputData.length > 0 && inputData[0].json) {
        // Found input json data, check for chatInput
        if (inputData[0].json.chatInput) {
          sources.push({ 
            source: "executionData.data.main[0][0].json.chatInput", 
            value: inputData[0].json.chatInput,
            priority: 10 // Give highest priority
          });
        }
        if (inputData[0].json.message) {
          sources.push({ 
            source: "executionData.data.main[0][0].json.message", 
            value: inputData[0].json.message,
            priority: 9
          });
        }
        if (inputData[0].json.input) {
          sources.push({ 
            source: "executionData.data.main[0][0].json.input", 
            value: inputData[0].json.input,
            priority: 8
          });
        }
        // Add the full json for debugging
        sources.push({ 
          source: "executionData.data.main[0][0].json", 
          value: inputData[0].json,
          priority: 1
        });
      } else if (typeof inputData === 'object') {
        sources.push({ 
          source: "executionData.data.main[0]", 
          value: inputData,
          priority: 5
        });
      }
    }
    
    // Next, check node parameters
    if (node.parameters) {
      const params = node.parameters;
      
      // Check for text parameter (common in n8n nodes)
      if (params.text) {
        sources.push({ 
          source: "node.parameters.text", 
          value: params.text,
          priority: 3
        });
      }
      
      // Check for prompt parameter
      if (params.prompt) {
        sources.push({ 
          source: "node.parameters.prompt", 
          value: params.prompt,
          priority: 4
        });
      }
      
      // Check for message parameter
      if (params.message) {
        sources.push({ 
          source: "node.parameters.message", 
          value: params.message,
          priority: 4
        });
      }
      
      // Check for input parameter
      if (params.input) {
        sources.push({ 
          source: "node.parameters.input", 
          value: params.input,
          priority: 4
        });
      }
      
      // Check for LangChain agent options
      if (params.options && params.options.input) {
        sources.push({ 
          source: "node.parameters.options.input", 
          value: params.options.input,
          priority: 6
        });
      }
    }
    
    // Access run data if available
    if (runExecutionData && runExecutionData.resultData && 
        runExecutionData.resultData.runData && node.name) {
        
      const nodeData = runExecutionData.resultData.runData[node.name];
      if (nodeData && nodeData.length > 0) {
        // Get the latest run for this node
        const latestRun = nodeData[nodeData.length - 1];
        
        if (latestRun.data && latestRun.data.main && latestRun.data.main.length > 0) {
          // Get input data in case it contains chatInput
          const inputItems = latestRun.data.main[0];
          if (inputItems && inputItems.length > 0) {
            const firstItem = inputItems[0];
            if (firstItem && firstItem.json) {
              // Check for chatInput or message field
              if (firstItem.json.chatInput) {
                sources.push({ 
                  source: "runExecutionData.chatInput", 
                  value: firstItem.json.chatInput,
                  priority: 7
                });
              }
              if (firstItem.json.message) {
                sources.push({ 
                  source: "runExecutionData.message", 
                  value: firstItem.json.message,
                  priority: 6
                });
              }
              if (firstItem.json.input) {
                sources.push({ 
                  source: "runExecutionData.input", 
                  value: firstItem.json.input,
                  priority: 5
                });
              }
            }
          }
        }
      }
    }
    
    // Log what we found
    logger.debug(`Found ${sources.length} possible input sources`);
    sources.forEach((s, i) => {
      const valueStr = typeof s.value === 'object' ? JSON.stringify(s.value).substring(0, 100) : String(s.value).substring(0, 100);
      logger.debug(`Source ${i}: ${s.source} = ${valueStr}...`);
    });
    
    // Sort sources by priority (higher first)
    sources.sort((a, b) => (b.priority || 0) - (a.priority || 0));
    
    // Return the best input we found based on priority
    if (sources.length > 0) {
      const bestSource = sources[0];
      logger.debug(`Selected best source: ${bestSource.source} (priority: ${bestSource.priority})`);
      
      // If it's a JSON object with chatInput, use that
      if (typeof bestSource.value === 'object' && bestSource.value.chatInput) {
        return bestSource.value.chatInput;
      }
      
      // Return the value, resolving any expressions
      return resolveExpression(bestSource.value, sources.find(s => typeof s.value === 'object')?.value || {});
    }
    
    return ""; // Default empty input
  } catch (error) {
    logger.error(`Error extracting user input: ${error.message}`);
    return "";
  }
}

/**
 * Extract output from node result data
 * @param {Object} outputData - Node output data
 * @returns {Object} Extracted output and usage data
 */
function extractLLMOutput(outputData) {
  let llmOutput = '';
  let usage = null;
  
  if (outputData && outputData.length > 0) {
    const outputJson = outputData[0]?.json;
    
    if (outputJson) {
      logger.debug(`Node output data: ${JSON.stringify(outputJson).substring(0, 500)}...`);
      
      // Try standard output field first
      if (outputJson.output !== undefined) {
        llmOutput = outputJson.output;
      } 
      // Try AI agent specific output format 
      else if (outputJson.result && outputJson.result.output) {
        llmOutput = outputJson.result.output;
      }
      // Try all common output fields
      else {
        const fieldNames = [
          'text', 'content', 'output', 'completion', 'response', 
          'answer', 'message', 'result', 'generated_text'
        ];
        
        for (const field of fieldNames) {
          if (outputJson[field] !== undefined) {
            if (typeof outputJson[field] === 'object' && outputJson[field].content) {
              llmOutput = outputJson[field].content;
            } else {
              llmOutput = outputJson[field];
            }
            break;
          }
        }
        
        // If not found in top level, check for nested structures
        if (!llmOutput && outputJson.choices && outputJson.choices.length > 0) {
          const choice = outputJson.choices[0];
          if (choice.message && choice.message.content) {
            llmOutput = choice.message.content;
          } else if (choice.text) {
            llmOutput = choice.text;
          }
        }
      }
      
      // Try to extract token usage from output
      if (outputJson.usage) {
        usage = outputJson.usage;
      } else if (outputJson.tokenUsage) {
        usage = outputJson.tokenUsage;
      }
    }
  }
  
  return { llmOutput, usage };
}

module.exports = {
  getTimestamp,
  estimateTokenCount,
  resolveExpression,
  extractSystemMessage,
  extractUserInput,
  extractLLMOutput
};