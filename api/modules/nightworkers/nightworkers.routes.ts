import { createRoute, z } from '@hono/zod-openapi';
import {
  createRepositorySchema,
  createTaskSchema,
  repositorySchema,
  taskRunSchema,
  taskSchema,
} from '../../../shared/schemas/nightworkers.schema';
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
          schema: taskRunSchema.extend({
            events: z.array(z.unknown()),
          }),
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

const router = createOpenApiRouter()
  // Repositories
  .openapi(listRepositoriesRoute, async (c) => {
    const list = await service.listRepositories();
    return c.json(list, 200);
  })
  .openapi(createRepositoryRoute, async (c) => {
    const data = c.req.valid('json');
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
    const data = c.req.valid('json');
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
  // Execution
  .openapi(startTaskRunRoute, async (c) => {
    const id = c.req.param('id');
    try {
      const run = await service.startTaskRun(id);
      return c.json(run, 201);
      // biome-ignore lint/suspicious/noExplicitAny: catch block error
    } catch (err: any) {
      return c.json({ error: err.message }, 404);
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
  });

export const nightworkersRouter = router;
