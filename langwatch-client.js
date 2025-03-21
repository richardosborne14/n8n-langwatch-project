// langwatch-client.js - API client for LangWatch
const https = require('https');
const { logger } = require('./logger');

class LangWatchClient {
  constructor(options = {}) {
    this.apiKey = options.apiKey || process.env.LANGWATCH_API_KEY;
    this.endpoint = options.endpoint || process.env.LANGWATCH_ENDPOINT || 'https://app.langwatch.ai';
    this.maxRetries = options.maxRetries || 3;
    this.timeout = options.timeout || 10000; // 10 seconds
    
    if (!this.apiKey) {
      logger.warn('No LangWatch API key provided - traces will not be sent');
    }
    
    // Parse the URL to get hostname
    const url = new URL(this.endpoint);
    this.hostname = url.hostname;
    this.port = url.port || 443;
    this.protocol = url.protocol === 'https:' ? https : require('http');
  }
  
  /**
   * Send trace data to LangWatch
   * @param {Object} traceData - Trace data to send
   * @returns {Promise<Object>} Response data
   */
  async sendTrace(traceData) {
    if (!this.apiKey) {
      logger.debug('No API key, skipping trace send');
      return null;
    }
    
    return this._sendRequest('/api/collector', traceData);
  }
  
  /**
   * Send a request to the LangWatch API
   * @param {string} path - API path
   * @param {Object} data - Request payload
   * @returns {Promise<Object>} Response data
   */
  async _sendRequest(path, data, attempt = 1) {
    return new Promise((resolve, reject) => {
      try {
        const postData = JSON.stringify(data);
        
        const options = {
          hostname: this.hostname,
          port: this.port,
          path,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Auth-Token': this.apiKey,
            'Content-Length': Buffer.byteLength(postData)
          },
          timeout: this.timeout
        };
        
        const req = this.protocol.request(options, (res) => {
          let responseData = '';
          
          res.on('data', (chunk) => {
            responseData += chunk;
          });
          
          res.on('end', () => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              logger.debug(`LangWatch API request successful (${path})`);
              try {
                const parsedData = responseData ? JSON.parse(responseData) : {};
                resolve(parsedData);
              } catch (e) {
                resolve(responseData);
              }
            } else {
              const error = new Error(`HTTP Error: ${res.statusCode} ${responseData}`);
              logger.error(`LangWatch API error: ${res.statusCode} ${responseData}`);
              
              // Retry on server errors if we haven't hit max retries
              if (res.statusCode >= 500 && attempt < this.maxRetries) {
                logger.info(`Retrying request to ${path} (attempt ${attempt + 1}/${this.maxRetries})`);
                setTimeout(() => {
                  this._sendRequest(path, data, attempt + 1)
                    .then(resolve)
                    .catch(reject);
                }, Math.pow(2, attempt) * 1000); // Exponential backoff
              } else {
                reject(error);
              }
            }
          });
        });
        
        req.on('error', (error) => {
          logger.error(`Error sending request to LangWatch: ${error.message}`);
          
          // Retry on connection errors if we haven't hit max retries
          if (attempt < this.maxRetries) {
            logger.info(`Retrying request to ${path} (attempt ${attempt + 1}/${this.maxRetries})`);
            setTimeout(() => {
              this._sendRequest(path, data, attempt + 1)
                .then(resolve)
                .catch(reject);
            }, Math.pow(2, attempt) * 1000); // Exponential backoff
          } else {
            reject(error);
          }
        });
        
        req.on('timeout', () => {
          req.destroy();
          logger.error(`Request to ${path} timed out after ${this.timeout}ms`);
          
          // Retry on timeout if we haven't hit max retries
          if (attempt < this.maxRetries) {
            logger.info(`Retrying request to ${path} (attempt ${attempt + 1}/${this.maxRetries})`);
            setTimeout(() => {
              this._sendRequest(path, data, attempt + 1)
                .then(resolve)
                .catch(reject);
            }, Math.pow(2, attempt) * 1000); // Exponential backoff
          } else {
            reject(new Error(`Request timed out after ${this.timeout}ms`));
          }
        });
        
        req.write(postData);
        req.end();
      } catch (error) {
        logger.error(`Exception sending request to LangWatch: ${error.message}`);
        reject(error);
      }
    });
  }
}

module.exports = { LangWatchClient };