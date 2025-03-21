// logger.js - Logging configuration for n8n LangWatch integration
const winston = require('winston');

// Initialize logger with default configuration
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  defaultMeta: { service: 'n8n-langwatch' },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ level, message, timestamp, ...meta }) => {
          const metaStr = Object.keys(meta).length > 0 
            ? ` ${JSON.stringify(meta)}` 
            : '';
          return `${timestamp} [${level}]: ${message}${metaStr}`;
        })
      )
    })
  ]
});

/**
 * Configure the logger with custom settings
 * @param {Object} options - Logger configuration options
 * @param {string} options.logLevel - Log level (error, warn, info, debug)
 */
function setupLogger(options = {}) {
  if (options.logLevel) {
    logger.level = options.logLevel.toLowerCase();
    logger.info(`Log level set to: ${logger.level}`);
  }
}

module.exports = { 
  logger, 
  setupLogger 
};