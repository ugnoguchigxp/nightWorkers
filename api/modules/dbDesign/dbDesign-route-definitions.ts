import { createRoute, z } from '@hono/zod-openapi';
import {
  blueprintAdoptionRequestSchema,
  blueprintAdoptionSchema,
} from '../../../shared/schemas/nightworkers.schema';

export const blueprintAdoptionQuerySchema = z.object({
  messageId: z.string().uuid(),
});

export const getBlueprintDbDesignAdoptionRoute = createRoute({
  method: 'get',
  path: '/tasks/:id/blueprint-db-design-adoption',
  request: {
    params: z.object({
      id: z.string().uuid().openapi({ example: 'task-uuid' }),
    }),
    query: blueprintAdoptionQuerySchema,
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: blueprintAdoptionSchema,
        },
      },
      description: 'Blueprint DB Design adoption state',
    },
    404: { description: 'Task or message not found' },
  },
});

export const saveBlueprintDbDesignAdoptionRoute = createRoute({
  method: 'put',
  path: '/tasks/:id/blueprint-db-design-adoption',
  request: {
    params: z.object({
      id: z.string().uuid().openapi({ example: 'task-uuid' }),
    }),
    body: {
      content: {
        'application/json': {
          schema: blueprintAdoptionRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: blueprintAdoptionSchema,
        },
      },
      description: 'Blueprint DB Design adoption state saved',
    },
    404: { description: 'Task or message not found' },
  },
});

const specificationStatusGenerateRequestSchema = z.object({
  questionnaireSessionId: z.string().uuid().nullable().optional(),
  sourceBlueprintMessageId: z.string().uuid().nullable().optional(),
  reviewAfterGenerate: z.boolean().optional(),
});

export const generateSpecificationStatusDbDesignRoute = createRoute({
  method: 'post',
  path: '/tasks/:id/specification-workspace/db-design',
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: {
      content: {
        'application/json': {
          schema: specificationStatusGenerateRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: z.unknown() } },
      description: 'DB Design generated from Status',
    },
  },
});
