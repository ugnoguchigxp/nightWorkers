import { z } from '@hono/zod-openapi';

export const designOperationModeSchema = z
  .enum(['fixed', 'configurable', 'hybrid'])
  .openapi('DesignOperationMode');

export const designPresetSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .regex(/^[a-z][a-z0-9-]*$/),
    name: z.string().min(1),
    mode: designOperationModeSchema,
    theme: z.string().min(1),
    density: z.enum(['compact', 'default', 'comfortable']),
    radius: z.enum(['sharp', 'default', 'rounded', 'pill']),
    shadow: z.enum(['none', 'subtle', 'medium', 'strong']),
    fontScale: z.enum(['small', 'default', 'large']),
    contrast: z.enum(['standard', 'high']),
    motion: z.enum(['reduced', 'standard']),
  })
  .openapi('DesignPreset');

export type DesignOperationMode = z.infer<typeof designOperationModeSchema>;
export type DesignPreset = z.infer<typeof designPresetSchema>;
