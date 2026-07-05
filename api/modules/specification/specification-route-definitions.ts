import { createRoute, z } from '@hono/zod-openapi';
import { planModeWorkspaceSchema } from '../../../shared/schemas/plan-mode-artifact.schema';

export const getPlanModeWorkspaceRoute = createRoute({
  method: 'get',
  path: '/tasks/:id/plan-mode/workspace',
  request: {
    params: z.object({ id: z.string().uuid() }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: planModeWorkspaceSchema } },
      description: 'Plan Mode Workspace read model',
    },
  },
});

const featurePlanGenerateRequestSchema = z.object({
  questionnaireSessionId: z.string().uuid().nullable().optional(),
  sourceBlueprintMessageId: z.string().uuid().nullable().optional(),
});

export const generateFeaturePlanRoute = createRoute({
  method: 'post',
  path: '/tasks/:id/plan-mode/feature-plan',
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: {
      content: {
        'application/json': {
          schema: featurePlanGenerateRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: z.unknown() } },
      description: 'Feature Plan generated from Plan Mode Status',
    },
  },
});
