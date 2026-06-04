import { createRoute, z } from '@hono/zod-openapi';
import {
  activityReplaySchema,
  blueprintAdoptionRequestSchema,
  blueprintAdoptionSchema,
  blueprintPreviewDesignSettingsSchema,
  blueprintSessionDesignSettingsSchema,
  createRepositorySchema,
  createReviewerEvaluationRequestSchema,
  createReviewerReplayEvaluationRequestSchema,
  createTaskSchema,
  repositorySchema,
  reviewerEvaluationSchema,
  taskEventSchema,
  taskMessageSchema,
  taskRunDetailSchema,
  taskRunSchema,
  taskSchema,
} from '../../../shared/schemas/nightworkers.schema';
import { AppError, ValidationError } from '../../lib/errors';
import { logEvent } from '../../lib/logger';
import { createOpenApiRouter } from '../../lib/openapi';
import * as service from './nightworkers.service';

function queueRouteError(c: any, err: any): any {
  if (err instanceof AppError) {
    return c.json({ error: err.message, code: err.code }, err.statusCode as any);
  }
  return c.json({ error: String(err?.message || err) }, 500);
}

const listRepositoriesRoute = createRoute({
  method: 'get',
  path: '/repositories',
  responses: {
    200: {
      content: {
        'application/json': {
          schema: z.array(repositorySchema),
        },
      },
      description: 'List of all repositories',
    },
  },
});

const createRepositoryRoute = createRoute({
  method: 'post',
  path: '/repositories',
  request: {
    body: {
      content: {
        'application/json': {
          schema: createRepositorySchema,
        },
      },
    },
  },
  responses: {
    201: {
      content: {
        'application/json': {
          schema: repositorySchema,
        },
      },
      description: 'Repository created successfully',
    },
  },
});

const getRepositoryRoute = createRoute({
  method: 'get',
  path: '/repositories/:id',
  request: {
    params: z.object({
      id: z.string().uuid().openapi({ example: 'repo-uuid' }),
    }),
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: repositorySchema,
        },
      },
      description: 'Repository detail',
    },
    404: {
      description: 'Repository not found',
    },
  },
});

const updateRepositoryRoute = createRoute({
  method: 'patch',
  path: '/repositories/:id',
  request: {
    params: z.object({
      id: z.string().uuid().openapi({ example: 'repo-uuid' }),
    }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            queueEnabled: z.boolean().optional(),
            maxConcurrentSessions: z.number().int().positive().optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: repositorySchema,
        },
      },
      description: 'Repository updated successfully',
    },
    404: {
      description: 'Repository not found',
    },
  },
});

const listProjectFilesRoute = createRoute({
  method: 'get',
  path: '/repositories/:id/files',
  request: {
    params: z.object({
      id: z.string().uuid().openapi({ example: 'repo-uuid' }),
    }),
    query: z.object({
      path: z.string().optional(),
    }),
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: z.array(
            z.object({
              name: z.string(),
              path: z.string(),
              type: z.enum(['file', 'directory']),
              size: z.number().optional(),
            })
          ),
        },
      },
      description: 'Project file tree entries',
    },
    404: { description: 'Repository not found' },
  },
});

const readProjectFileRoute = createRoute({
  method: 'get',
  path: '/repositories/:id/file',
  request: {
    params: z.object({
      id: z.string().uuid().openapi({ example: 'repo-uuid' }),
    }),
    query: z.object({
      path: z.string(),
    }),
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: z.object({
            path: z.string(),
            content: z.string(),
            size: z.number(),
            truncated: z.boolean(),
          }),
        },
      },
      description: 'Project file content',
    },
    404: { description: 'Repository not found' },
  },
});

const deleteRepositoryRoute = createRoute({
  method: 'delete',
  path: '/repositories/:id',
  request: {
    params: z.object({
      id: z.string().uuid().openapi({ example: 'repo-uuid' }),
    }),
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: repositorySchema,
        },
      },
      description: 'Repository deleted successfully',
    },
    404: {
      description: 'Repository not found',
    },
  },
});

const listTasksRoute = createRoute({
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

const createTaskRoute = createRoute({
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

const getTaskRoute = createRoute({
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

const deleteTaskRoute = createRoute({
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

const updateTaskRoute = createRoute({
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

const getBlueprintDesignSettingsRoute = createRoute({
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

const saveBlueprintDesignSettingsRoute = createRoute({
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

const blueprintAdoptionQuerySchema = z.object({
  messageId: z.string().uuid(),
});

const getBlueprintArtifactAdoptionRoute = createRoute({
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

const saveBlueprintArtifactAdoptionRoute = createRoute({
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

const getBlueprintDbDesignAdoptionRoute = createRoute({
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

const saveBlueprintDbDesignAdoptionRoute = createRoute({
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

const getBlueprintDesignTokenAdoptionRoute = createRoute({
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

const saveBlueprintDesignTokenAdoptionRoute = createRoute({
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

const startTaskRunRoute = createRoute({
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

const appendTaskMessageRoute = createRoute({
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

const appendWorkbenchMessageRoute = createRoute({
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
      content: { 'application/json': { schema: z.any() } },
      description: 'Workbench message handled',
    },
    404: { description: 'Task not found' },
  },
});

const createWorkbenchSessionRoute = createRoute({
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

const implementationQueueEntrySchema = z.object({
  id: z.string().uuid(),
  taskId: z.string().uuid(),
  repositoryId: z.string().uuid(),
  status: z.string(),
  priority: z.number(),
  queuePosition: z.number().nullable().optional(),
  processorSlot: z.number().nullable().optional(),
  activeRunId: z.string().uuid().nullable().optional(),
  claimedAt: z.any().nullable().optional(),
  lastHeartbeatAt: z.any().nullable().optional(),
  archivedAt: z.any().nullable().optional(),
  statusReason: z.string().nullable().optional(),
  createdAt: z.any(),
  updatedAt: z.any(),
});

const implementationQueueDashboardRoute = createRoute({
  method: 'get',
  path: '/implementation-queue',
  responses: {
    200: {
      content: {
        'application/json': {
          schema: z.object({
            settings: z.object({ processorCount: z.number().int() }),
            processors: z.array(
              z.object({
                slot: z.number().int(),
                entry: implementationQueueEntrySchema
                  .extend({ task: taskSchema, repository: repositorySchema })
                  .nullable(),
              })
            ),
            queued: z.array(
              implementationQueueEntrySchema.extend({
                task: taskSchema,
                repository: repositorySchema,
              })
            ),
            completed: z.array(
              implementationQueueEntrySchema.extend({
                task: taskSchema,
                repository: repositorySchema,
              })
            ),
            notQueued: z.array(z.object({ task: taskSchema, repository: repositorySchema })),
          }),
        },
      },
      description: 'Implementation Queue dashboard',
    },
  },
});

const createImplementationQueueEntryRoute = createRoute({
  method: 'post',
  path: '/implementation-queue/entries',
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({ taskId: z.string().uuid() }),
        },
      },
    },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: implementationQueueEntrySchema } },
      description: 'Implementation Queue Entry created',
    },
  },
});

const patchImplementationQueueEntryRoute = createRoute({
  method: 'patch',
  path: '/implementation-queue/entries/:id',
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            action: z.enum(['cancel', 'resume']).optional(),
            priority: z.number().int().optional(),
            queuePosition: z.number().int().nullable().optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: implementationQueueEntrySchema } },
      description: 'Implementation Queue Entry updated',
    },
  },
});

const archiveImplementationQueueEntryRoute = createRoute({
  method: 'post',
  path: '/implementation-queue/entries/:id/archive',
  request: {
    params: z.object({ id: z.string().uuid() }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: implementationQueueEntrySchema } },
      description: 'Implementation Queue Entry archived',
    },
  },
});

const drainImplementationQueueRoute = createRoute({
  method: 'post',
  path: '/implementation-queue/drain',
  responses: {
    200: {
      content: { 'application/json': { schema: z.object({ started: z.number().int() }) } },
      description: 'Implementation Queue drain triggered',
    },
  },
});

const getImplementationQueueSettingsRoute = createRoute({
  method: 'get',
  path: '/implementation-queue/settings',
  responses: {
    200: {
      content: { 'application/json': { schema: z.object({ processorCount: z.number().int() }) } },
      description: 'Implementation Queue settings',
    },
  },
});

const patchImplementationQueueSettingsRoute = createRoute({
  method: 'patch',
  path: '/implementation-queue/settings',
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({ processorCount: z.number().int().min(1).max(3) }),
        },
      },
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: z.object({ processorCount: z.number().int() }) } },
      description: 'Implementation Queue settings updated',
    },
  },
});

const todoWorkflowSettingsSchema = z.object({
  id: z.string(),
  requirePerTodoReview: z.boolean(),
  requirePerTodoFix: z.boolean(),
  requireFinalVerification: z.boolean(),
  askCommitOnCompletion: z.boolean(),
  hookPolicyJson: z.any().nullable().optional(),
  createdAt: z.any(),
  updatedAt: z.any(),
});

const todoWorkflowSettingsInputSchema = z.object({
  requirePerTodoReview: z.boolean().optional(),
  requirePerTodoFix: z.boolean().optional(),
  requireFinalVerification: z.boolean().optional(),
  askCommitOnCompletion: z.boolean().optional(),
  hookPolicyJson: z.any().optional(),
});

const getTodoWorkflowSettingsRoute = createRoute({
  method: 'get',
  path: '/todo-workflow/settings',
  responses: {
    200: {
      content: { 'application/json': { schema: todoWorkflowSettingsSchema } },
      description: 'Todo Workflow settings',
    },
  },
});

const patchTodoWorkflowSettingsRoute = createRoute({
  method: 'patch',
  path: '/todo-workflow/settings',
  request: {
    body: {
      content: { 'application/json': { schema: todoWorkflowSettingsInputSchema } },
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: todoWorkflowSettingsSchema } },
      description: 'Todo Workflow settings updated',
    },
  },
});

const queueWorkbenchSessionRoute = createRoute({
  method: 'post',
  path: '/workbench/sessions/:id/queue',
  request: {
    params: z.object({ id: z.string().uuid() }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: taskSchema } },
      description: 'Workbench session queued',
    },
    404: { description: 'Task not found' },
  },
});

const runWorkbenchSessionRoute = createRoute({
  method: 'post',
  path: '/workbench/sessions/:id/run',
  request: {
    params: z.object({ id: z.string().uuid() }),
  },
  responses: {
    201: {
      content: { 'application/json': { schema: taskRunSchema } },
      description: 'Workbench session run started',
    },
    404: { description: 'Task not found' },
  },
});

const archiveWorkbenchSessionRoute = createRoute({
  method: 'patch',
  path: '/workbench/sessions/:id/archive',
  request: {
    params: z.object({ id: z.string().uuid() }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: taskSchema } },
      description: 'Workbench session archived',
    },
    404: { description: 'Task not found' },
  },
});

const listTaskMessagesRoute = createRoute({
  method: 'get',
  path: '/tasks/:id/messages',
  request: {
    params: z.object({
      id: z.string().uuid().openapi({ example: 'task-uuid' }),
    }),
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: z.array(taskMessageSchema),
        },
      },
      description: 'Task message list',
    },
    404: {
      description: 'Task not found',
    },
  },
});

const listTaskActivityEventsRoute = createRoute({
  method: 'get',
  path: '/tasks/:id/activity-events',
  request: {
    params: z.object({
      id: z.string().uuid().openapi({ example: 'task-uuid' }),
    }),
    query: z.object({
      afterSeq: z.coerce.number().int().min(0).optional(),
    }),
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: activityReplaySchema,
        },
      },
      description: 'Task activity events after an optional task sequence cursor',
    },
    404: {
      description: 'Task not found',
    },
  },
});

const getTaskRunRoute = createRoute({
  method: 'get',
  path: '/runs/:id',
  request: {
    params: z.object({
      id: z.string().uuid().openapi({ example: 'run-uuid' }),
    }),
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: taskRunDetailSchema,
        },
      },
      description: 'Task run details and log events',
    },
    404: {
      description: 'Run not found',
    },
  },
});

const listTaskRunEventsRoute = createRoute({
  method: 'get',
  path: '/runs/:id/events',
  request: {
    params: z.object({
      id: z.string().uuid().openapi({ example: 'run-uuid' }),
    }),
    query: z.object({
      afterSeq: z.coerce.number().int().min(0).optional(),
    }),
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: z.array(taskEventSchema),
        },
      },
      description: 'Task run events after an optional sequence cursor',
    },
    404: {
      description: 'Run not found',
    },
  },
});

const listTaskRunActivityEventsRoute = createRoute({
  method: 'get',
  path: '/runs/:id/activity-events',
  request: {
    params: z.object({
      id: z.string().uuid().openapi({ example: 'run-uuid' }),
    }),
    query: z.object({
      afterSeq: z.coerce.number().int().min(0).optional(),
    }),
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: activityReplaySchema,
        },
      },
      description: 'Run activity events after an optional task sequence cursor',
    },
    404: {
      description: 'Run not found',
    },
  },
});

const listTaskRunsRoute = createRoute({
  method: 'get',
  path: '/tasks/:id/runs',
  request: {
    params: z.object({
      id: z.string().uuid().openapi({ example: 'task-uuid' }),
    }),
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: z.array(taskRunSchema),
        },
      },
      description: 'List of runs for the task',
    },
    404: {
      description: 'Task not found',
    },
  },
});

const listReviewRubricsRoute = createRoute({
  method: 'get',
  path: '/review-rubrics',
  responses: {
    200: {
      content: {
        'application/json': {
          schema: z.array(
            z.object({
              id: z.string(),
              title: z.string(),
              description: z.string().optional(),
              source: z.enum(['builtin', 'repository', 'inline']),
              digest: z.string(),
              criteriaCount: z.number().int().nonnegative(),
              llm: z
                .object({
                  enabledByDefault: z.boolean(),
                  promptHints: z.array(z.string()).optional(),
                  maxEvidenceChars: z.number().int().positive(),
                })
                .optional(),
            })
          ),
        },
      },
      description: 'List available review rubrics',
    },
  },
});

const createReviewerEvaluationRoute = createRoute({
  method: 'post',
  path: '/runs/:id/reviewer-evaluations',
  request: {
    params: z.object({
      id: z.string().uuid().openapi({ example: 'run-uuid' }),
    }),
    body: {
      content: {
        'application/json': {
          schema: createReviewerEvaluationRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: reviewerEvaluationSchema,
        },
      },
      description: 'Reviewer evaluation created successfully',
    },
    404: {
      description: 'Run not found',
    },
  },
});

const createReviewerReplayEvaluationRoute = createRoute({
  method: 'post',
  path: '/runs/:id/reviewer-evaluations/replay',
  request: {
    params: z.object({
      id: z.string().uuid().openapi({ example: 'run-uuid' }),
    }),
    body: {
      content: {
        'application/json': {
          schema: createReviewerReplayEvaluationRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: reviewerEvaluationSchema,
        },
      },
      description: 'Read-only replay reviewer evaluation completed',
    },
    400: {
      content: {
        'application/json': {
          schema: z.object({ error: z.string(), code: z.string().optional() }),
        },
      },
      description: 'Invalid reviewer replay input',
    },
    500: {
      content: {
        'application/json': {
          schema: z.object({ error: z.string(), code: z.string().optional() }),
        },
      },
      description: 'Reviewer replay evaluation failed',
    },
  },
});

const exportTaskRunJsonlRoute = createRoute({
  method: 'get',
  path: '/runs/:id/export.jsonl',
  request: {
    params: z.object({
      id: z.string().uuid().openapi({ example: 'run-uuid' }),
    }),
  },
  responses: {
    200: {
      description: 'Run JSONL export',
      content: {
        'application/x-ndjson': {
          schema: z.string(),
        },
      },
    },
    404: {
      description: 'Run not found',
    },
  },
});

const router = createOpenApiRouter()
  // Repositories
  .openapi(listRepositoriesRoute, async (c) => {
    const list = await service.listRepositories();
    return c.json(list, 200);
  })
  .openapi(createRepositoryRoute, async (c) => {
    let data = c.req.valid('json');

    // Resilient Fallback: If validated data is missing required fields,
    // manually extract them from the raw body to avoid DB constraint crashes.
    if (!data?.name || !data.localPath) {
      try {
        const rawJson = await c.req.json();
        if (rawJson) {
          data = {
            ...data,
            name: data?.name || rawJson.name || '',
            localPath: data?.localPath || rawJson.localPath || rawJson.local_path || '',
            branch: data?.branch || rawJson.branch || 'main',
            allowed:
              data?.allowed !== undefined
                ? data.allowed
                : rawJson.allowed !== undefined
                  ? rawJson.allowed
                  : true,
            queueEnabled:
              data?.queueEnabled !== undefined
                ? data.queueEnabled
                : rawJson.queueEnabled !== undefined
                  ? rawJson.queueEnabled
                  : false,
            maxConcurrentSessions:
              data?.maxConcurrentSessions !== undefined
                ? data.maxConcurrentSessions
                : rawJson.maxConcurrentSessions !== undefined
                  ? rawJson.maxConcurrentSessions
                  : 1,
            safetyPolicy: data?.safetyPolicy || rawJson.safetyPolicy || undefined,
          };
        }
      } catch (_e) {
        // Ignore body parsing errors
      }
    }

    // Double check: if still missing required fields, throw a ValidationError rather than crashing the DB
    if (!data?.name || !data.localPath) {
      throw new ValidationError('Name and local path are required');
    }

    const repo = await service.createRepository(data);
    return c.json(repo, 201);
  })
  .openapi(getRepositoryRoute, async (c) => {
    const id = c.req.param('id');
    const repo = await service.getRepository(id);
    if (!repo) return c.json({ error: 'Repository not found' }, 404);
    return c.json(repo, 200);
  })
  .openapi(updateRepositoryRoute, async (c) => {
    try {
      const repo = await service.updateRepository(c.req.param('id'), c.req.valid('json'));
      return c.json(repo, 200);
    } catch (err: any) {
      if (err instanceof AppError) {
        return c.json({ error: err.message, code: err.code }, err.statusCode as any);
      }
      return c.json({ error: String(err?.message || err) }, 500);
    }
  })
  .openapi(listProjectFilesRoute, async (c) => {
    try {
      const entries = await service.listProjectFiles(c.req.param('id'), c.req.query('path'));
      return c.json(entries, 200);
    } catch (err: any) {
      if (err instanceof AppError) {
        return c.json({ error: err.message, code: err.code }, err.statusCode as any);
      }
      return c.json({ error: String(err?.message || err) }, 500);
    }
  })
  .openapi(readProjectFileRoute, async (c) => {
    try {
      const filePath = c.req.query('path');
      if (!filePath) return c.json({ error: 'path is required' }, 400);
      const file = await service.readProjectFile(c.req.param('id'), filePath);
      return c.json(file, 200);
    } catch (err: any) {
      if (err instanceof AppError) {
        return c.json({ error: err.message, code: err.code }, err.statusCode as any);
      }
      return c.json({ error: String(err?.message || err) }, 500);
    }
  })
  .openapi(deleteRepositoryRoute, async (c) => {
    const id = c.req.param('id');
    const repo = await service.deleteRepository(id);
    if (!repo) return c.json({ error: 'Repository not found' }, 404);
    return c.json(repo, 200);
  })
  // Tasks
  .openapi(listTasksRoute, async (c) => {
    const list = await service.listTasks();
    return c.json(list, 200);
  })
  .openapi(createTaskRoute, async (c) => {
    let data = c.req.valid('json');

    // Resilient Fallback: If validated data is missing required fields,
    // manually extract them from the raw body to avoid DB constraint crashes.
    if (!data?.repositoryId || !data.title) {
      try {
        const rawJson = await c.req.json();
        if (rawJson) {
          data = {
            ...data,
            repositoryId: data?.repositoryId || rawJson.repositoryId || rawJson.repository_id || '',
            title: data?.title || rawJson.title || '',
            description: data?.description || rawJson.description || '',
            objective: data?.objective || rawJson.objective || '',
            acceptanceCriteria:
              data?.acceptanceCriteria ||
              rawJson.acceptanceCriteria ||
              rawJson.acceptance_criteria ||
              '',
            timeoutSeconds:
              data?.timeoutSeconds !== undefined
                ? data.timeoutSeconds
                : rawJson.timeoutSeconds !== undefined
                  ? rawJson.timeoutSeconds
                  : rawJson.timeout_seconds !== undefined
                    ? rawJson.timeout_seconds
                    : 3600,
            priority:
              data?.priority !== undefined
                ? data.priority
                : rawJson.priority !== undefined
                  ? rawJson.priority
                  : 0,
            createdBy: data?.createdBy || rawJson.createdBy || rawJson.created_by || undefined,
          };
        }
      } catch (_e) {
        // Ignore body parsing errors
      }
    }

    // Double check: if still missing required fields, throw a ValidationError rather than crashing the DB
    if (!data?.repositoryId || !data.title) {
      throw new ValidationError('Repository ID and title are required');
    }

    const task = await service.createTask(data);
    return c.json(task, 201);
  })
  .openapi(getTaskRoute, async (c) => {
    const id = c.req.param('id');
    const task = await service.getTask(id);
    if (!task) return c.json({ error: 'Task not found' }, 404);
    return c.json(task, 200);
  })
  .openapi(deleteTaskRoute, async (c) => {
    const id = c.req.param('id');
    const task = await service.deleteTask(id);
    if (!task) return c.json({ error: 'Task not found' }, 404);
    return c.json(task, 200);
  })
  .openapi(updateTaskRoute, async (c) => {
    const id = c.req.param('id');
    const data = c.req.valid('json');
    logEvent({
      channel: 'api',
      level: 'info',
      message: 'task update requested',
      meta: {
        taskId: id,
        requestedStatus: data.status,
        hasPriority: data.priority !== undefined,
      },
    });
    const task = await service.updateTask(id, data);
    if (!task) return c.json({ error: 'Task not found' }, 404);
    return c.json(task, 200);
  })
  .openapi(getBlueprintDesignSettingsRoute, async (c) => {
    try {
      const settings = await service.getBlueprintDesignSettings(c.req.param('id'));
      return c.json(settings, 200);
    } catch (err: any) {
      if (err instanceof AppError) {
        return c.json({ error: err.message, code: err.code }, err.statusCode as any);
      }
      return c.json({ error: String(err?.message || err) }, 500);
    }
  })
  .openapi(saveBlueprintDesignSettingsRoute, async (c) => {
    try {
      const settings = await service.saveBlueprintDesignSettings(
        c.req.param('id'),
        c.req.valid('json')
      );
      return c.json(settings, 200);
    } catch (err: any) {
      if (err instanceof AppError) {
        return c.json({ error: err.message, code: err.code }, err.statusCode as any);
      }
      return c.json({ error: String(err?.message || err) }, 500);
    }
  })
  .openapi(getBlueprintArtifactAdoptionRoute, async (c) => {
    try {
      const adoption = await service.getBlueprintArtifactAdoption(
        c.req.param('id'),
        c.req.valid('query').messageId
      );
      return c.json(adoption, 200);
    } catch (err: any) {
      if (err instanceof AppError) {
        return c.json({ error: err.message, code: err.code }, err.statusCode as any);
      }
      return c.json({ error: String(err?.message || err) }, 500);
    }
  })
  .openapi(saveBlueprintArtifactAdoptionRoute, async (c) => {
    try {
      const body = c.req.valid('json');
      const adoption = await service.saveBlueprintArtifactAdoption(
        c.req.param('id'),
        body.messageId,
        body.adopted
      );
      return c.json(adoption, 200);
    } catch (err: any) {
      if (err instanceof AppError) {
        return c.json({ error: err.message, code: err.code }, err.statusCode as any);
      }
      return c.json({ error: String(err?.message || err) }, 500);
    }
  })
  .openapi(getBlueprintDbDesignAdoptionRoute, async (c) => {
    try {
      const adoption = await service.getBlueprintDbDesignAdoption(
        c.req.param('id'),
        c.req.valid('query').messageId
      );
      return c.json(adoption, 200);
    } catch (err: any) {
      if (err instanceof AppError) {
        return c.json({ error: err.message, code: err.code }, err.statusCode as any);
      }
      return c.json({ error: String(err?.message || err) }, 500);
    }
  })
  .openapi(saveBlueprintDbDesignAdoptionRoute, async (c) => {
    try {
      const body = c.req.valid('json');
      const adoption = await service.saveBlueprintDbDesignAdoption(
        c.req.param('id'),
        body.messageId,
        body.adopted
      );
      return c.json(adoption, 200);
    } catch (err: any) {
      if (err instanceof AppError) {
        return c.json({ error: err.message, code: err.code }, err.statusCode as any);
      }
      return c.json({ error: String(err?.message || err) }, 500);
    }
  })
  .openapi(getBlueprintDesignTokenAdoptionRoute, async (c) => {
    try {
      const adoption = await service.getBlueprintDesignTokenAdoption(
        c.req.param('id'),
        c.req.valid('query').messageId
      );
      return c.json(adoption, 200);
    } catch (err: any) {
      if (err instanceof AppError) {
        return c.json({ error: err.message, code: err.code }, err.statusCode as any);
      }
      return c.json({ error: String(err?.message || err) }, 500);
    }
  })
  .openapi(saveBlueprintDesignTokenAdoptionRoute, async (c) => {
    try {
      const body = c.req.valid('json');
      const adoption = await service.saveBlueprintDesignTokenAdoption(
        c.req.param('id'),
        body.messageId,
        body.adopted
      );
      return c.json(adoption, 200);
    } catch (err: any) {
      if (err instanceof AppError) {
        return c.json({ error: err.message, code: err.code }, err.statusCode as any);
      }
      return c.json({ error: String(err?.message || err) }, 500);
    }
  })
  .openapi(appendTaskMessageRoute, async (c) => {
    const id = c.req.param('id');
    const { prompt } = c.req.valid('json');
    try {
      const task = await service.appendTaskMessage(id, prompt);
      return c.json(task, 200);
    } catch (err: any) {
      if (err instanceof AppError) {
        return c.json({ error: err.message, code: err.code }, err.statusCode as any);
      }
      return c.json({ error: String(err?.message || err) }, 500);
    }
  })
  .openapi(createWorkbenchSessionRoute, async (c) => {
    const data = c.req.valid('json');
    const task = await service.createWorkbenchSession(data);
    return c.json(task, 201);
  })
  .openapi(appendWorkbenchMessageRoute, async (c) => {
    const id = c.req.param('id');
    const body = c.req.valid('json');
    try {
      const result = await service.appendWorkbenchMessage(id, body);
      return c.json(result, 200);
    } catch (err: any) {
      if (err instanceof AppError) {
        return c.json({ error: err.message, code: err.code }, err.statusCode as any);
      }
      return c.json({ error: String(err?.message || err) }, 500);
    }
  })
  .openapi(implementationQueueDashboardRoute, async (c) => {
    try {
      const result = await service.listImplementationQueueDashboard();
      return c.json(result, 200);
    } catch (err: any) {
      return queueRouteError(c, err);
    }
  })
  .openapi(createImplementationQueueEntryRoute, async (c) => {
    try {
      const body = c.req.valid('json');
      const entry = await service.createImplementationQueueEntry(body.taskId);
      return c.json(entry, 201);
    } catch (err: any) {
      return queueRouteError(c, err);
    }
  })
  .openapi(patchImplementationQueueEntryRoute, async (c) => {
    try {
      const body = c.req.valid('json');
      const entry = await service.patchImplementationQueueEntry(c.req.param('id'), body);
      return c.json(entry, 200);
    } catch (err: any) {
      return queueRouteError(c, err);
    }
  })
  .openapi(archiveImplementationQueueEntryRoute, async (c) => {
    try {
      const entry = await service.archiveImplementationQueueEntry(c.req.param('id'));
      return c.json(entry, 200);
    } catch (err: any) {
      return queueRouteError(c, err);
    }
  })
  .openapi(drainImplementationQueueRoute, async (c) => {
    try {
      const started = await service.runImplementationQueue();
      return c.json({ started: started.length }, 200);
    } catch (err: any) {
      return queueRouteError(c, err);
    }
  })
  .openapi(getImplementationQueueSettingsRoute, async (c) => {
    try {
      const result = await service.listImplementationQueueDashboard();
      return c.json(result.settings, 200);
    } catch (err: any) {
      return queueRouteError(c, err);
    }
  })
  .openapi(patchImplementationQueueSettingsRoute, async (c) => {
    try {
      const body = c.req.valid('json');
      const settings = await service.updateImplementationQueueSettings(body);
      return c.json(settings, 200);
    } catch (err: any) {
      return queueRouteError(c, err);
    }
  })
  .openapi(getTodoWorkflowSettingsRoute, async (c) => {
    try {
      const settings = await service.getTodoWorkflowSettings();
      return c.json(settings, 200);
    } catch (err: any) {
      return queueRouteError(c, err);
    }
  })
  .openapi(patchTodoWorkflowSettingsRoute, async (c) => {
    try {
      const body = c.req.valid('json');
      const settings = await service.updateTodoWorkflowSettings(body);
      return c.json(settings, 200);
    } catch (err: any) {
      return queueRouteError(c, err);
    }
  })
  .openapi(queueWorkbenchSessionRoute, async (c) => {
    try {
      const task = await service.queueTask(c.req.param('id'));
      return c.json(task, 200);
    } catch (err: any) {
      if (err instanceof AppError) {
        return c.json({ error: err.message, code: err.code }, err.statusCode as any);
      }
      return c.json({ error: String(err?.message || err) }, 500);
    }
  })
  .openapi(runWorkbenchSessionRoute, async (c) => {
    try {
      const run = await service.startWorkbenchTaskRun(c.req.param('id'));
      return c.json(run, 201);
    } catch (err: any) {
      if (err instanceof AppError) {
        return c.json({ error: err.message, code: err.code }, err.statusCode as any);
      }
      return c.json({ error: String(err?.message || err) }, 500);
    }
  })
  .openapi(archiveWorkbenchSessionRoute, async (c) => {
    try {
      const task = await service.archiveTask(c.req.param('id'));
      return c.json(task, 200);
    } catch (err: any) {
      if (err instanceof AppError) {
        return c.json({ error: err.message, code: err.code }, err.statusCode as any);
      }
      return c.json({ error: String(err?.message || err) }, 500);
    }
  })
  .openapi(listTaskMessagesRoute, async (c) => {
    const id = c.req.param('id');
    try {
      const messages = await service.listTaskMessages(id);
      return c.json(messages, 200);
    } catch (err: any) {
      if (err instanceof AppError) {
        return c.json({ error: err.message, code: err.code }, err.statusCode as any);
      }
      return c.json({ error: String(err?.message || err) }, 500);
    }
  })
  .openapi(listTaskActivityEventsRoute, async (c) => {
    const id = c.req.param('id');
    try {
      const events = await service.listTaskActivityEvents(id, c.req.valid('query'));
      return c.json(events, 200);
    } catch (err: any) {
      if (err instanceof AppError) {
        return c.json({ error: err.message, code: err.code }, err.statusCode as any);
      }
      return c.json({ error: String(err?.message || err) }, 500);
    }
  })
  // Execution
  .openapi(startTaskRunRoute, async (c) => {
    const id = c.req.param('id');
    try {
      const run = await service.startTaskRun(id);
      return c.json(run, 201);
    } catch (err: any) {
      if (err instanceof AppError) {
        return c.json({ error: err.message, code: err.code }, err.statusCode as any);
      }
      return c.json({ error: String(err?.message || err) }, 500);
    }
  })
  .openapi(getTaskRunRoute, async (c) => {
    const id = c.req.param('id');
    const run = await service.getTaskRun(id);
    if (!run) return c.json({ error: 'Run not found' }, 404);
    return c.json(run, 200);
  })
  .openapi(listTaskRunEventsRoute, async (c) => {
    const id = c.req.param('id');
    try {
      const events = await service.listTaskRunEvents(id, c.req.valid('query'));
      return c.json(events, 200);
    } catch (err: any) {
      if (err instanceof AppError) {
        return c.json({ error: err.message, code: err.code }, err.statusCode as any);
      }
      return c.json({ error: String(err?.message || err) }, 500);
    }
  })
  .openapi(listTaskRunActivityEventsRoute, async (c) => {
    const id = c.req.param('id');
    try {
      const events = await service.listTaskRunActivityEvents(id, c.req.valid('query'));
      return c.json(events, 200);
    } catch (err: any) {
      if (err instanceof AppError) {
        return c.json({ error: err.message, code: err.code }, err.statusCode as any);
      }
      return c.json({ error: String(err?.message || err) }, 500);
    }
  })
  .openapi(listTaskRunsRoute, async (c) => {
    const id = c.req.param('id');
    const runs = await service.getTaskRunsForTask(id);
    return c.json(runs, 200);
  })
  .openapi(listReviewRubricsRoute, async (c) => {
    return c.json(service.getReviewRubrics(), 200);
  })
  .openapi(createReviewerEvaluationRoute, async (c) => {
    const id = c.req.param('id');
    const request = c.req.valid('json');
    try {
      const result = await service.createReviewerEvaluation(id, request);
      return c.json(result, 200);
    } catch (err: any) {
      if (err instanceof AppError) {
        return c.json({ error: err.message, code: err.code }, err.statusCode as any);
      }
      return c.json({ error: String(err?.message || err) }, 500);
    }
  })
  .openapi(createReviewerReplayEvaluationRoute, async (c) => {
    const id = c.req.param('id');
    const request = c.req.valid('json');
    try {
      const result = await service.createReviewerReplayEvaluation(id, request);
      return c.json(result, 200);
    } catch (err: any) {
      if (err instanceof AppError) {
        return c.json({ error: err.message, code: err.code }, err.statusCode as any);
      }
      return c.json({ error: String(err?.message || err) }, 500);
    }
  })
  .openapi(exportTaskRunJsonlRoute, async (c) => {
    const id = c.req.param('id');
    const jsonl = await service.exportTaskRunJsonl(id);
    if (!jsonl) return c.json({ error: 'Run not found' }, 404);
    c.header('Content-Type', 'application/x-ndjson; charset=utf-8');
    c.header('Content-Disposition', `attachment; filename="nightworkers-run-${id}.jsonl"`);
    return c.body(jsonl, 200);
  });

const browseFoldersRoute = createRoute({
  method: 'get',
  path: '/utils/browse-folders',
  request: {
    query: z.object({
      path: z.string().optional(),
    }),
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: z.object({
            currentPath: z.string(),
            parentPath: z.string().nullable(),
            directories: z.array(
              z.object({
                name: z.string(),
                path: z.string(),
              })
            ),
            error: z.string().optional(),
          }),
        },
      },
      description: 'List directories under a path',
    },
  },
});

router.openapi(browseFoldersRoute, async (c) => {
  const queryPath = c.req.query('path');
  const result = await service.browseLocalFolders(queryPath);
  return c.json(result, 200);
});

export const nightworkersRouter = router;
