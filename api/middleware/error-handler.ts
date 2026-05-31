import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { AppError } from '../lib/errors';
import { logger as globalLogger } from '../lib/logger';

export const errorHandler = async (err: Error, c: Context) => {
  const logger = c.get('logger') || globalLogger;

  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      logger.error(err, 'AppError');
    } else {
      logger.warn({ code: err.code, message: err.message, details: err.details }, 'AppError');
    }
    return c.json(
      {
        error: {
          code: err.code,
          message: err.message,
          details: err.details,
        },
      },
      err.statusCode as ContentfulStatusCode
    );
  }

  logger.error(err, 'Unhandled Error');
  return c.json(
    {
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An unexpected error occurred',
      },
    },
    500
  );
};
