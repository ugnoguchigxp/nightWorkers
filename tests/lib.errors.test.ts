import { describe, expect, it } from 'vitest';
import {
  AppError,
  AuthError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../api/lib/errors';

describe('error classes', () => {
  it('creates AppError with metadata', () => {
    const err = new AppError(418, 'TEAPOT', 'short and stout', { extra: true });
    expect(err).toBeInstanceOf(Error);
    expect(err.statusCode).toBe(418);
    expect(err.code).toBe('TEAPOT');
    expect(err.message).toBe('short and stout');
    expect(err.details).toEqual({ extra: true });
    expect(err.name).toBe('AppError');
  });

  it('creates ValidationError', () => {
    const err = new ValidationError('invalid input', { field: 'email' });
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.details).toEqual({ field: 'email' });
  });

  it('creates AuthError with default message', () => {
    const err = new AuthError();
    expect(err.statusCode).toBe(401);
    expect(err.code).toBe('UNAUTHORIZED');
    expect(err.message).toBe('Unauthorized');
  });

  it('creates ForbiddenError and NotFoundError', () => {
    expect(new ForbiddenError().statusCode).toBe(403);
    expect(new NotFoundError().statusCode).toBe(404);
  });
});
