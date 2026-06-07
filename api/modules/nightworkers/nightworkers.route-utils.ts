import { AppError } from '../../lib/errors';

export function queueRouteError(c: any, err: any): any {
  if (err instanceof AppError)
    return c.json({ error: err.message, code: err.code }, err.statusCode as any);
  return c.json({ error: String(err?.message || err) }, 500);
}
