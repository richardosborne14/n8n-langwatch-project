// logger.js
const winston = require('winston');

// Create a custom format that handles undefined errors
const safeErrorFormat = winston.format((info) => {
  // If the message contains error.message and error is undefined, replace it
  if (typeof info.message === 'string' && 
      info.message.includes('error.message') && 
      (info.error === undefined || info.error === null)) {
    info.message = info.message.replace(/error\.message/g, "'undefined'");
  }
  return info;
});

// Configure logger with more detailed formatting
const logger = winston.createLogger({
  level: process.env.LANGWATCH_LOG_LEVEL || 'info',
  format: winston.format.combine(
    safeErrorFormat(),
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
        safeErrorFormat(),
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
