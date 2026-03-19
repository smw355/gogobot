/**
 * Structured logger for Cloud Run / Cloud Logging compatibility.
 *
 * In production: outputs JSON to stdout (Cloud Logging auto-parses severity, message, timestamp).
 * In development: outputs human-readable colored console output.
 *
 * Usage:
 *   import { logger } from '@/lib/logger';
 *   logger.info('Project created', { projectId, userId });
 *   logger.error('Deploy failed', { projectId, error: err.message });
 */

type LogSeverity = 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR';

interface LogContext {
  [key: string]: string | number | boolean | null | undefined;
}

const isProduction = process.env.NODE_ENV === 'production';

function log(severity: LogSeverity, message: string, context?: LogContext): void {
  if (isProduction) {
    // Cloud Logging structured JSON format
    // https://cloud.google.com/logging/docs/structured-logging
    const entry: Record<string, unknown> = {
      severity,
      message,
      timestamp: new Date().toISOString(),
    };
    if (context) {
      // Flatten context into top-level fields for Cloud Logging filtering
      for (const [key, value] of Object.entries(context)) {
        if (value !== undefined) {
          entry[key] = value;
        }
      }
    }
    // Cloud Run captures stdout as structured logs when JSON is detected
    process.stdout.write(JSON.stringify(entry) + '\n');
  } else {
    // Development: human-readable output
    const prefix = severity === 'ERROR' ? '❌' :
                   severity === 'WARNING' ? '⚠️' :
                   severity === 'DEBUG' ? '🔍' : 'ℹ️';
    const contextStr = context ? ` ${JSON.stringify(context)}` : '';
    const fn = severity === 'ERROR' ? console.error :
               severity === 'WARNING' ? console.warn :
               severity === 'DEBUG' ? console.debug : console.log;
    fn(`${prefix} ${message}${contextStr}`);
  }
}

export const logger = {
  debug: (message: string, context?: LogContext) => log('DEBUG', message, context),
  info: (message: string, context?: LogContext) => log('INFO', message, context),
  warn: (message: string, context?: LogContext) => log('WARNING', message, context),
  error: (message: string, context?: LogContext) => log('ERROR', message, context),
};
