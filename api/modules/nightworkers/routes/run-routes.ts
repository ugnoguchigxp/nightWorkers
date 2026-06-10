import { createRoute, z } from '@hono/zod-openapi';
import {
  activityReplaySchema,
  backgroundProcessSchema,
  createReviewerEvaluationRequestSchema,
  createReviewerReplayEvaluationRequestSchema,
  overviewDashboardSchema,
  reviewActionSchema,
  reviewEvidenceRefSchema,
  reviewerEvaluationSchema,
  reviewFindingSchema,
  reviewResultSchema,
  startBackgroundProcessRequestSchema,
  taskEventSchema,
  taskLlmUsageSummarySchema,
  taskMessageSchema,
  taskRunDetailSchema,
  taskRunSchema,
} from '../../../../shared/schemas/nightworkers.schema';
import { validateTimezone } from '../../../services/settings/general-settings';

export const listTaskMessagesRoute = createRoute({
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

export const getTaskLlmUsageRoute = createRoute({
  method: 'get',
  path: '/tasks/:id/llm-usage',
  request: {
    params: z.object({
      id: z.string().uuid().openapi({ example: 'task-uuid' }),
    }),
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: taskLlmUsageSummarySchema,
        },
      },
      description: 'Task LLM token usage summary',
    },
    404: {
      description: 'Task not found',
    },
  },
});

export const getOverviewDashboardRoute = createRoute({
  method: 'get',
  path: '/overview',
  request: {
    query: z.object({
      range: z.enum(['24h', '7d', '30d', 'all']).optional(),
      repositoryId: z.string().uuid().optional(),
      timezone: z.string().refine(validateTimezone, 'Invalid timezone').optional(),
      currency: z.enum(['JPY', 'USD', 'EUR']).optional(),
    }),
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: overviewDashboardSchema,
        },
      },
      description: 'NightWorkers overview dashboard',
    },
    404: {
      description: 'Repository not found',
    },
  },
});

export const listTaskActivityEventsRoute = createRoute({
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

export const getTaskRunRoute = createRoute({
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

export const stopTaskRunRoute = createRoute({
  method: 'post',
  path: '/runs/:id/stop',
  request: {
    params: z.object({
      id: z.string().uuid().openapi({ example: 'run-uuid' }),
    }),
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: taskRunSchema,
        },
      },
      description: 'Task run stop requested successfully',
    },
    404: {
      description: 'Run not found',
    },
  },
});

export const listTaskRunEventsRoute = createRoute({
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

export const listTaskRunActivityEventsRoute = createRoute({
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

export const startBackgroundProcessRoute = createRoute({
  method: 'post',
  path: '/background-processes',
  request: {
    body: {
      content: {
        'application/json': {
          schema: startBackgroundProcessRequestSchema,
        },
      },
    },
  },
  responses: {
    201: {
      content: {
        'application/json': {
          schema: backgroundProcessSchema,
        },
      },
      description: 'Background process started',
    },
  },
});

export const listBackgroundProcessesRoute = createRoute({
  method: 'get',
  path: '/background-processes',
  request: {
    query: z.object({
      repositoryId: z.string().uuid().optional(),
      taskId: z.string().uuid().optional(),
      runId: z.string().uuid().optional(),
    }),
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: z.array(backgroundProcessSchema),
        },
      },
      description: 'Background process list',
    },
  },
});

export const getBackgroundProcessRoute = createRoute({
  method: 'get',
  path: '/background-processes/:id',
  request: {
    params: z.object({
      id: z.string().uuid().openapi({ example: 'background-process-uuid' }),
    }),
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: backgroundProcessSchema,
        },
      },
      description: 'Background process detail',
    },
    404: { description: 'Background process not found' },
  },
});

export const stopBackgroundProcessRoute = createRoute({
  method: 'post',
  path: '/background-processes/:id/stop',
  request: {
    params: z.object({
      id: z.string().uuid().openapi({ example: 'background-process-uuid' }),
    }),
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: backgroundProcessSchema,
        },
      },
      description: 'Background process stopped',
    },
    404: { description: 'Background process not found' },
  },
});

export const listTaskRunsRoute = createRoute({
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

export const listReviewRubricsRoute = createRoute({
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

export const createReviewerEvaluationRoute = createRoute({
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

export const createRunReviewRoute = createRoute({
  method: 'post',
  path: '/runs/:id/reviews',
  request: {
    params: z.object({
      id: z.string().uuid().openapi({ example: 'run-uuid' }),
    }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            action: reviewActionSchema,
            note: z.string().optional(),
            evidenceRefs: z.array(reviewEvidenceRefSchema).optional(),
            findings: z.array(reviewFindingSchema).optional(),
            humanCallouts: z.array(reviewFindingSchema).optional(),
            agentFollowUps: z.array(z.string()).optional(),
            suggestedNextTasks: z.array(z.string()).optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: z.object({
            ok: z.boolean(),
            status: z.string(),
            outcome: z.unknown(),
            reviewResult: reviewResultSchema,
          }),
        },
      },
      description: 'Human run review saved',
    },
    404: {
      description: 'Run not found',
    },
  },
});

export const createReviewerReplayEvaluationRoute = createRoute({
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

export const exportTaskRunJsonlRoute = createRoute({
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
