// logger.js
const winston = require('winston');

// Configure logger with more detailed formatting
const logger = winston.createLogger({
  level: process.env.LANGWATCH_LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ level, message, timestamp, service }) => {
      const serviceStr = service ? `[${service}] ` : '';
      return `${timestamp} ${level}: ${serviceStr}${message}`;
    })
  ),
  defaultMeta: { service: 'n8n-langwatch' },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp(),
        winston.format.printf(({ level, message, timestamp, service }) => {
          const serviceStr = service ? `[${service}] ` : '';
          return `${timestamp} ${level}: ${serviceStr}${message}`;
        })
      )
    })
  ]
});

module.exports = logger;