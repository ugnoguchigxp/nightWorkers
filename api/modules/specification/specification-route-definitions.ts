import { createRoute, z } from '@hono/zod-openapi';
import { blueprintSpecificationWorkspaceSchema } from '../../../shared/schemas/design-questionnaire.schema';

export const getBlueprintSpecificationWorkspaceRoute = createRoute({
  method: 'get',
  path: '/tasks/:id/blueprint-specification-workspace',
  request: {
    params: z.object({ id: z.string().uuid() }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: blueprintSpecificationWorkspaceSchema } },
      description: 'Blueprint Specification Workspace read model',
    },
  },
});

export const getSpecificationWorkspaceRoute = createRoute({
  method: 'get',
  path: '/tasks/:id/specification-workspace',
  request: {
    params: z.object({ id: z.string().uuid() }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: blueprintSpecificationWorkspaceSchema } },
      description: 'Specification Workspace read model',
    },
  },
});

const specificationStatusGenerateRequestSchema = z.object({
  questionnaireSessionId: z.string().uuid().nullable().optional(),
  sourceBlueprintMessageId: z.string().uuid().nullable().optional(),
  reviewAfterGenerate: z.boolean().optional(),
});

export const generateSpecificationStatusDesignDocumentRoute = createRoute({
  method: 'post',
  path: '/tasks/:id/specification-workspace/design-doc',
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
      description: 'Specification generated from Status',
    },
  },
});
