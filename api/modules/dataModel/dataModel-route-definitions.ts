import { createRoute, z } from '@hono/zod-openapi';

export const dataModelGenerateRequestSchema = z.object({
  prompt: z.string().optional(),
  questionnaireSessionId: z.string().uuid().nullable().optional(),
  featurePlanMessageId: z.string().uuid().nullable().optional(),
  sourceBlueprintMessageId: z.string().uuid().nullable().optional(),
});

export const generateDataModelRoute = createRoute({
  method: 'post',
  path: '/tasks/:id/plan-mode/data-model',
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: {
      content: {
        'application/json': {
          schema: dataModelGenerateRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: z.unknown() } },
      description: 'Data Model Plan View generated',
    },
  },
});
