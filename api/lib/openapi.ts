import { OpenAPIHono } from '@hono/zod-openapi';
import type { AppEnv } from './types';
import { validationHook } from './validation-hook';

export const createOpenApiRouter = () =>
  new OpenAPIHono<AppEnv>({
    defaultHook: validationHook,
  });
