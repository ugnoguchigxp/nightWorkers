import { createRoute, z } from '@hono/zod-openapi';
import {
  createRepositorySchema,
  createReviewerEvaluationRequestSchema,
  createReviewerReplayEvaluationRequestSchema,
  createTaskSchema,
  learningCandidateSchema,
  memoryFeedbackEvaluationSchema,
  repositorySchema,
  reviewerEvaluationSchema,
  reviewRunRequestSchema,
  reviewRunResponseSchema,
  taskMessageSchema,
  taskRunDetailSchema,
  taskRunSchema,
  taskSchema,
} from '../../../shared/schemas/nightworkers.schema';
import { AppError, ValidationError } from '../../lib/errors';
import { createOpenApiRouter } from '../../lib/openapi';
import * as service from './nightworkers.service';

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
            intent: z
              .enum([
                'discuss',
                'draft_spec',
                'create_task',
                'queue',
                'run_task',
                'adjust_running',
                'review_followup',
                'learning_capture',
              ])
              .default('discuss'),
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

const reviewTaskRunRoute = createRoute({
  method: 'post',
  path: '/runs/:id/review',
  request: {
    params: z.object({
      id: z.string().uuid().openapi({ example: 'run-uuid' }),
    }),
    body: {
      content: {
        'application/json': {
          schema: reviewRunRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: reviewRunResponseSchema,
        },
      },
      description: 'Review saved successfully',
    },
    404: {
      description: 'Run not found',
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

const listMemoryCandidatesRoute = createRoute({
  method: 'get',
  path: '/runs/:id/memory-candidates',
  request: {
    params: z.object({ id: z.string().uuid() }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: z.array(learningCandidateSchema) } },
      description: 'Memory learning candidates for a run',
    },
    404: { description: 'Run not found' },
  },
});

const generateMemoryCandidatesRoute = createRoute({
  method: 'post',
  path: '/runs/:id/memory-candidates',
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: {
      content: {
        'application/json': {
          schema: z.object({}).optional(),
        },
      },
    },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: z.array(learningCandidateSchema) } },
      description: 'Memory learning candidates generated',
    },
    404: { description: 'Run not found' },
  },
});

const approveMemoryCandidateRoute = createRoute({
  method: 'post',
  path: '/runs/:id/memory-candidates/:candidateId/approve',
  request: {
    params: z.object({ id: z.string().uuid(), candidateId: z.string().uuid() }),
    body: {
      content: {
        'application/json': {
          schema: z.object({ note: z.string().optional() }),
        },
      },
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: learningCandidateSchema } },
      description: 'Memory candidate approved',
    },
    404: { description: 'Run or candidate not found' },
    409: { description: 'Candidate status conflict' },
  },
});

const rejectMemoryCandidateRoute = createRoute({
  method: 'post',
  path: '/runs/:id/memory-candidates/:candidateId/reject',
  request: {
    params: z.object({ id: z.string().uuid(), candidateId: z.string().uuid() }),
    body: {
      content: {
        'application/json': {
          schema: z.object({ note: z.string().optional() }),
        },
      },
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: learningCandidateSchema } },
      description: 'Memory candidate rejected',
    },
    404: { description: 'Run or candidate not found' },
    409: { description: 'Candidate status conflict' },
  },
});

const registerMemoryCandidateRoute = createRoute({
  method: 'post',
  path: '/runs/:id/memory-candidates/:candidateId/register',
  request: {
    params: z.object({ id: z.string().uuid(), candidateId: z.string().uuid() }),
    body: {
      content: {
        'application/json': {
          schema: z.object({}).optional(),
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: z.object({
            candidate: learningCandidateSchema,
            registration: z.object({
              status: z.enum(['registered', 'degraded', 'failed']),
              externalId: z.string().optional(),
              errorCode: z.string().optional(),
              errorMessage: z.string().optional(),
            }),
          }),
        },
      },
      description: 'Approved candidate registered to contextStill',
    },
    404: { description: 'Run or candidate not found' },
    409: { description: 'Candidate is not approved' },
  },
});

const evaluateMemoryFeedbackRoute = createRoute({
  method: 'post',
  path: '/runs/:id/memory-feedback/evaluate',
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            baselineRunId: z.string().uuid(),
            candidateIds: z.array(z.string().uuid()).min(1),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: memoryFeedbackEvaluationSchema } },
      description: 'Memory feedback effectiveness evaluation',
    },
    404: { description: 'Run not found' },
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
    const task = await service.updateTask(id, data);
    if (!task) return c.json({ error: 'Task not found' }, 404);
    return c.json(task, 200);
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
  .openapi(listTaskRunsRoute, async (c) => {
    const id = c.req.param('id');
    const runs = await service.getTaskRunsForTask(id);
    return c.json(runs, 200);
  })
  .openapi(reviewTaskRunRoute, async (c) => {
    const id = c.req.param('id');
    const request = c.req.valid('json');
    try {
      const result = await service.reviewTaskRun(id, request);
      return c.json(result, 200);
    } catch (err: any) {
      if (err instanceof AppError) {
        return c.json({ error: err.message, code: err.code }, err.statusCode as any);
      }
      return c.json({ error: String(err?.message || err) }, 500);
    }
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
  })
  .openapi(listMemoryCandidatesRoute, async (c) => {
    try {
      const candidates = await service.listMemoryCandidates(c.req.param('id'));
      return c.json(candidates, 200);
    } catch (err: any) {
      if (err instanceof AppError) {
        return c.json({ error: err.message, code: err.code }, err.statusCode as any);
      }
      return c.json({ error: String(err?.message || err) }, 500);
    }
  })
  .openapi(generateMemoryCandidatesRoute, async (c) => {
    try {
      const candidates = await service.generateMemoryCandidates(c.req.param('id'));
      return c.json(candidates, 201);
    } catch (err: any) {
      if (err instanceof AppError) {
        return c.json({ error: err.message, code: err.code }, err.statusCode as any);
      }
      return c.json({ error: String(err?.message || err) }, 500);
    }
  })
  .openapi(approveMemoryCandidateRoute, async (c) => {
    try {
      const body = c.req.valid('json');
      const candidate = await service.approveMemoryCandidate(
        c.req.param('id'),
        c.req.param('candidateId'),
        body.note
      );
      return c.json(candidate, 200);
    } catch (err: any) {
      if (err instanceof AppError) {
        return c.json({ error: err.message, code: err.code }, err.statusCode as any);
      }
      return c.json({ error: String(err?.message || err) }, 500);
    }
  })
  .openapi(rejectMemoryCandidateRoute, async (c) => {
    try {
      const body = c.req.valid('json');
      const candidate = await service.rejectMemoryCandidate(
        c.req.param('id'),
        c.req.param('candidateId'),
        body.note
      );
      return c.json(candidate, 200);
    } catch (err: any) {
      if (err instanceof AppError) {
        return c.json({ error: err.message, code: err.code }, err.statusCode as any);
      }
      return c.json({ error: String(err?.message || err) }, 500);
    }
  })
  .openapi(registerMemoryCandidateRoute, async (c) => {
    try {
      const result = await service.registerMemoryCandidate(
        c.req.param('id'),
        c.req.param('candidateId')
      );
      return c.json(result, 200);
    } catch (err: any) {
      if (err instanceof AppError) {
        return c.json({ error: err.message, code: err.code }, err.statusCode as any);
      }
      return c.json({ error: String(err?.message || err) }, 500);
    }
  })
  .openapi(evaluateMemoryFeedbackRoute, async (c) => {
    try {
      const body = c.req.valid('json');
      const result = await service.evaluateMemoryFeedbackForRuns({
        baselineRunId: body.baselineRunId,
        followupRunId: c.req.param('id'),
        candidateIds: body.candidateIds,
      });
      return c.json(result, 200);
    } catch (err: any) {
      if (err instanceof AppError) {
        return c.json({ error: err.message, code: err.code }, err.statusCode as any);
      }
      return c.json({ error: String(err?.message || err) }, 500);
    }
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
