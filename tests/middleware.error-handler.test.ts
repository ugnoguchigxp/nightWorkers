import { describe, expect, it, vi } from 'vitest';
import { AppError, ValidationError } from '../api/lib/errors';
import { errorHandler } from '../api/middleware/error-handler';

describe('errorHandler', () => {
  it('returns AppError payload and status for 4xx errors', async () => {
    const logger = {
      warn: vi.fn(),
      error: vi.fn(),
    };

    const c = {
      get: vi.fn().mockReturnValue(logger),
      json: vi.fn((payload, status) => ({ payload, status })),
    } as unknown as Parameters<typeof errorHandler>[1];

    const err = new ValidationError('invalid data', { field: 'email' });
    const result = await errorHandler(err, c);

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.error).not.toHaveBeenCalled();
    expect(result).toEqual({
      payload: {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'invalid data',
          details: { field: 'email' },
        },
      },
      status: 400,
    });
  });

  it('logs AppError 5xx as error', async () => {
    const logger = {
      warn: vi.fn(),
      error: vi.fn(),
    };

    const c = {
      get: vi.fn().mockReturnValue(logger),
      json: vi.fn((payload, status) => ({ payload, status })),
    } as unknown as Parameters<typeof errorHandler>[1];

    const err = new AppError(500, 'SERVER_FAIL', 'boom');
    const result = await errorHandler(err, c);

    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      payload: {
        error: {
          code: 'SERVER_FAIL',
          message: 'boom',
          details: undefined,
        },
      },
      status: 500,
    });
  });

  it('returns generic 500 payload for unknown errors', async () => {
    const logger = {
      warn: vi.fn(),
      error: vi.fn(),
    };

    const c = {
      get: vi.fn().mockReturnValue(logger),
      json: vi.fn((payload, status) => ({ payload, status })),
    } as unknown as Parameters<typeof errorHandler>[1];

    const result = await errorHandler(new Error('unexpected'), c);

    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      payload: {
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'An unexpected error occurred',
        },
      },
      status: 500,
    });
  });
});
