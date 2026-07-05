import { createRoute, z } from '@hono/zod-openapi';
import { genericPlanViewSchema } from './planView-generation.service';

export const planViewGenerateRequestSchema = z.object({
  prompt: z.string().optional(),
  questionnaireSessionId: z.string().uuid().nullable().optional(),
  featurePlanMessageId: z.string().uuid().nullable().optional(),
  sourceBlueprintMessageId: z.string().uuid().nullable().optional(),
  sourceDataModelMessageId: z.string().uuid().nullable().optional(),
});

export const generatePlanViewRoute = createRoute({
  method: 'post',
  path: '/tasks/:id/plan-mode/views/:view/generate',
  request: {
    params: z.object({
      id: z.string().uuid(),
      view: genericPlanViewSchema,
    }),
    body: {
      content: {
        'application/json': {
          schema: planViewGenerateRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: z.unknown() } },
      description: 'Generic Plan View generated',
    },
  },
});
