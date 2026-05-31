import type { Logger } from 'pino';

import { z } from 'zod';

export const jwtPayloadSchema = z.object({
  userId: z.string(),
  email: z.string().email(),
  type: z.enum(['access', 'refresh']),
});

export type JWTPayload = z.infer<typeof jwtPayloadSchema>;

export type AppVariables = {
  logger: Logger;
  user?: JWTPayload;
};

export type AppEnv = {
  Variables: AppVariables;
};
