import { createRoute, z } from '@hono/zod-openapi';
import {
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
            providerEndpointId: z.string().optional(),
            model: z.string().optional(),
            thinkingDepth: z.enum(['low', 'medium', 'high', 'very_high']).optional(),
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
