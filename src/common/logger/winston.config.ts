import { WinstonModuleOptions } from 'nest-winston';
import * as winston from 'winston';

/**
 * Winston Logger Configuration
 *
 * Winston is a professional logging library that:
 * - Structures logs as JSON (easy to search/analyze)
 * - Supports different log levels (error, warn, info, debug)
 * - Can write to files, databases, external services
 * - Much better than console.log for production!
 *
 * Log Levels (from most to least severe):
 * - error: Something broke (500 errors, exceptions)
 * - warn: Something's wrong but not critical (deprecated API usage)
 * - info: Normal operations (user logged in, email sent)
 * - debug: Detailed info for debugging (only in development)
 */
export const createLogger = (): WinstonModuleOptions => {
  const isProduction = process.env.NODE_ENV === 'production';

  return {
    level: isProduction ? 'info' : 'debug',
    format: winston.format.combine(
      winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      winston.format.errors({ stack: true }),
      winston.format.splat(),
      // In production, use JSON format for log aggregation tools
      // In development, use colorized format for readability
      isProduction
        ? winston.format.json()
        : winston.format.combine(
            winston.format.colorize(),
            winston.format.printf(
              ({ timestamp, level, message, context, trace, requestId }) => {
                const rid = requestId ? `[${requestId}]` : '';
                const ctx = context ? `[${context}]` : '';
                return `${timestamp} ${level} ${rid}${ctx}: ${message}${trace ? `\n${trace}` : ''}`;
              },
            ),
          ),
    ),
    transports: [
      new winston.transports.Console(),
      // In production, you might want to add file transports:
      // new winston.transports.File({ filename: 'error.log', level: 'error' }),
      // new winston.transports.File({ filename: 'combined.log' }),
    ],
  };
};
