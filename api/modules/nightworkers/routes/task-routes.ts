import { createRoute, z } from '@hono/zod-openapi';
import {
  blueprintSpecificationWorkspaceSchema,
  createDesignQuestionnaireRequestSchema,
  designQuestionnaireSessionSchema,
  saveDesignQuestionnaireAnswersSchema,
} from '../../../../shared/schemas/design-questionnaire.schema';
import {
  blueprintAdoptionRequestSchema,
  blueprintAdoptionSchema,
  blueprintPreviewDesignSettingsSchema,
  blueprintSessionDesignSettingsSchema,
  createTaskSchema,
  taskRunSchema,
  taskSchema,
} from '../../../../shared/schemas/nightworkers.schema';
export const listTasksRoute = createRoute({
  method: 'get',
  path: '/tasks',
  responses: {
    200: {
      content: {
        'application/json': {
          schema: z.array(taskSchema),
        },
      },
      description: 'List of all tasks',
    },
  },
});
export const createTaskRoute = createRoute({
  method: 'post',
  path: '/tasks',
  request: {
    body: {
      content: {
        'application/json': {
          schema: createTaskSchema,
        },
      },
    },
  },
  responses: {
    201: {
      content: {
        'application/json': {
          schema: taskSchema,
        },
      },
      description: 'Task created successfully',
    },
  },
});
export const getTaskRoute = createRoute({
  method: 'get',
  path: '/tasks/:id',
  request: {
    params: z.object({
      id: z.string().uuid().openapi({ example: 'task-uuid' }),
    }),
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: taskSchema,
        },
      },
      description: 'Task detail',
    },
    404: {
      description: 'Task not found',
    },
  },
});
export const deleteTaskRoute = createRoute({
  method: 'delete',
  path: '/tasks/:id',
  request: {
    params: z.object({
      id: z.string().uuid().openapi({ example: 'task-uuid' }),
    }),
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: taskSchema,
        },
      },
      description: 'Task deleted successfully',
    },
    404: {
      description: 'Task not found',
    },
  },
});
export const updateTaskRoute = createRoute({
  method: 'patch',
  path: '/tasks/:id',
  request: {
    params: z.object({
      id: z.string().uuid().openapi({ example: 'task-uuid' }),
    }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            title: z.string().optional(),
            description: z.string().optional(),
            objective: z.string().optional(),
            acceptanceCriteria: z.string().optional(),
            status: z.string().optional(),
            priority: z.number().optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: taskSchema,
        },
      },
      description: 'Task updated successfully',
    },
    404: {
      description: 'Task not found',
    },
  },
});
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
export const startTaskRunRoute = createRoute({
  method: 'post',
  path: '/tasks/:id/run',
  request: {
    params: z.object({
      id: z.string().uuid().openapi({ example: 'task-uuid' }),
    }),
  },
  responses: {
    201: {
      content: {
        'application/json': {
          schema: taskRunSchema,
        },
      },
      description: 'Task run started successfully',
    },
    404: {
      description: 'Task not found',
    },
  },
});
export const appendTaskMessageRoute = createRoute({
  method: 'post',
  path: '/tasks/:id/messages',
  request: {
    params: z.object({
      id: z.string().uuid().openapi({ example: 'task-uuid' }),
    }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            prompt: z.string().min(1),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: taskSchema,
        },
      },
      description: 'Task message appended',
    },
    404: {
      description: 'Task not found',
    },
  },
});
const workbenchArtifactContextSchema = z.object({
  artifactId: z.string(),
  kind: z.string(),
  title: z.string(),
  summary: z.string().optional(),
  source: z.object({ type: z.string() }).passthrough(),
  metadata: z
    .object({
      intent: z.string().optional(),
      appBlueprintName: z.string().optional(),
      artifactType: z.string().optional(),
      screenNames: z.array(z.string()).optional(),
      sectionNames: z.array(z.string()).optional(),
      tableNames: z.array(z.string()).optional(),
      initialTab: z.string().optional(),
      blueprintCount: z.number().optional(),
    })
    .optional(),
});
export const appendWorkbenchMessageRoute = createRoute({
  method: 'post',
  path: '/workbench/sessions/:id/messages',
  request: {
    params: z.object({
      id: z.string().uuid().openapi({ example: 'task-uuid' }),
    }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            prompt: z.string().min(1),
            waitForIntake: z.boolean().optional(),
            artifactContext: workbenchArtifactContextSchema.nullable().optional(),
            intent: z
              .enum([
                'intake',
                'draft',
                'draft_spec',
                'create_task',
                'queue',
                'run_task',
                'adjust_running',
                'review_followup',
                'learning_capture',
                'design_component',
                'design_blueprint_data',
              ])
              .default('intake'),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: z.unknown() } },
      description: 'Workbench message handled',
    },
    404: { description: 'Task not found' },
  },
});
export const createDesignQuestionnaireRoute = createRoute({
  method: 'post',
  path: '/tasks/:id/design-questionnaire',
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: {
      content: {
        'application/json': {
          schema: createDesignQuestionnaireRequestSchema,
        },
      },
    },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: designQuestionnaireSessionSchema } },
      description: 'Design Questionnaire session created',
    },
  },
});
export const listDesignQuestionnairesRoute = createRoute({
  method: 'get',
  path: '/tasks/:id/design-questionnaire',
  request: {
    params: z.object({ id: z.string().uuid() }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: z.array(designQuestionnaireSessionSchema) } },
      description: 'Design Questionnaire sessions',
    },
  },
});
export const getDesignQuestionnaireRoute = createRoute({
  method: 'get',
  path: '/tasks/:id/design-questionnaire/:sessionId',
  request: {
    params: z.object({ id: z.string().uuid(), sessionId: z.string().uuid() }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: designQuestionnaireSessionSchema } },
      description: 'Design Questionnaire session',
    },
  },
});
export const saveDesignQuestionnaireAnswersRoute = createRoute({
  method: 'post',
  path: '/tasks/:id/design-questionnaire/:sessionId/answers',
  request: {
    params: z.object({ id: z.string().uuid(), sessionId: z.string().uuid() }),
    body: {
      content: {
        'application/json': {
          schema: saveDesignQuestionnaireAnswersSchema,
        },
      },
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: designQuestionnaireSessionSchema } },
      description: 'Design Questionnaire answers saved',
    },
  },
});
export const generateDesignQuestionnaireFollowUpRoute = createRoute({
  method: 'post',
  path: '/tasks/:id/design-questionnaire/:sessionId/follow-up',
  request: {
    params: z.object({ id: z.string().uuid(), sessionId: z.string().uuid() }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: designQuestionnaireSessionSchema } },
      description: 'Design Questionnaire follow-up generated',
    },
  },
});
export const generateDesignQuestionnaireReviewRoute = createRoute({
  method: 'post',
  path: '/tasks/:id/design-questionnaire/:sessionId/review',
  request: {
    params: z.object({ id: z.string().uuid(), sessionId: z.string().uuid() }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: z.unknown() } },
      description: 'Design Questionnaire review generated',
    },
  },
});
export const acceptDesignQuestionnaireReviewRoute = createRoute({
  method: 'post',
  path: '/tasks/:id/design-questionnaire/:sessionId/review/accept',
  request: {
    params: z.object({ id: z.string().uuid(), sessionId: z.string().uuid() }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: designQuestionnaireSessionSchema } },
      description: 'Design Questionnaire review accepted',
    },
  },
});
export const leaveDesignQuestionnaireReviewUnadoptedRoute = createRoute({
  method: 'post',
  path: '/tasks/:id/design-questionnaire/:sessionId/review/leave-unadopted',
  request: {
    params: z.object({ id: z.string().uuid(), sessionId: z.string().uuid() }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: designQuestionnaireSessionSchema } },
      description: 'Design Questionnaire review left unadopted',
    },
  },
});
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
export const createWorkbenchSessionRoute = createRoute({
  method: 'post',
  path: '/workbench/sessions',
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            repositoryId: z.string().uuid(),
            title: z.string().optional(),
            description: z.string().optional(),
            objective: z.string().optional(),
            acceptanceCriteria: z.string().optional(),
            timeoutSeconds: z.number().optional(),
            priority: z.number().optional(),
            createdBy: z.string().optional(),
          }),
        },
      },
    },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: taskSchema } },
      description: 'Workbench session created',
    },
  },
});
