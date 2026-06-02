import { createRoute, z } from '@hono/zod-openapi';
import {
  createRepositorySchema,
  createTaskSchema,
  repositorySchema,
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
