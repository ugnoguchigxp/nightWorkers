import { createRoute, z } from '@hono/zod-openapi';
import {
  blueprintAdoptionRequestSchema,
  blueprintAdoptionSchema,
  blueprintPreviewDesignSettingsSchema,
  blueprintSessionDesignSettingsSchema,
} from '../../../shared/schemas/nightworkers.schema';

export const getBlueprintDesignSettingsRoute = createRoute({
  method: 'get',
  path: '/tasks/:id/blueprint-design-settings',
  request: {
    params: z.object({
      id: z.string().uuid().openapi({ example: 'task-uuid' }),
    }),
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: blueprintSessionDesignSettingsSchema,
        },
      },
      description: 'Session-scoped Blueprint Preview design settings',
    },
    404: { description: 'Task not found' },
  },
});

export const saveBlueprintDesignSettingsRoute = createRoute({
  method: 'put',
  path: '/tasks/:id/blueprint-design-settings',
  request: {
    params: z.object({
      id: z.string().uuid().openapi({ example: 'task-uuid' }),
    }),
    body: {
      content: {
        'application/json': {
          schema: blueprintPreviewDesignSettingsSchema,
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: blueprintSessionDesignSettingsSchema,
        },
      },
      description: 'Session-scoped Blueprint Preview design settings saved',
    },
    404: { description: 'Task not found' },
  },
});

export const blueprintAdoptionQuerySchema = z.object({
  messageId: z.string().uuid(),
});

export const getBlueprintArtifactAdoptionRoute = createRoute({
  method: 'get',
  path: '/tasks/:id/blueprint-adoption',
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
      description: 'Blueprint artifact adoption state',
    },
    404: { description: 'Task or message not found' },
  },
});

export const saveBlueprintArtifactAdoptionRoute = createRoute({
  method: 'put',
  path: '/tasks/:id/blueprint-adoption',
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
      description: 'Blueprint artifact adoption state saved',
    },
    404: { description: 'Task or message not found' },
  },
});

export const getBlueprintDesignTokenAdoptionRoute = createRoute({
  method: 'get',
  path: '/tasks/:id/blueprint-design-token-adoption',
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
      description: 'Blueprint design token adoption state',
    },
    404: { description: 'Task or message not found' },
  },
});

export const saveBlueprintDesignTokenAdoptionRoute = createRoute({
  method: 'put',
  path: '/tasks/:id/blueprint-design-token-adoption',
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
      description: 'Blueprint design token adoption state saved',
    },
    404: { description: 'Task or message not found' },
  },
});

const specificationStatusGenerateRequestSchema = z.object({
  questionnaireSessionId: z.string().uuid().nullable().optional(),
  sourceBlueprintMessageId: z.string().uuid().nullable().optional(),
  reviewAfterGenerate: z.boolean().optional(),
});

export const generateSpecificationStatusBlueprintRoute = createRoute({
  method: 'post',
  path: '/tasks/:id/specification-workspace/blueprint',
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
      description: 'Blueprint generated from Status',
    },
  },
});
