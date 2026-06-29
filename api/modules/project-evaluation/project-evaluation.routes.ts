import { createRoute, z } from '@hono/zod-openapi';
import { taskSchema } from '../../../shared/schemas/nightworkers.schema';
import {
  createProjectEvaluationRequestSchema,
  createTasksFromProjectImprovementsRequestSchema,
  generateProjectImprovementsRequestSchema,
  projectEvaluationDetailSchema,
  projectEvaluationRunSchema,
  projectEvaluationTaskLinkSchema,
  projectImprovementIdeaSchema,
} from '../../../shared/schemas/project-evaluation.schema';
import { createOpenApiRouter } from '../../lib/openapi';
import { withOpenApiRouteError } from '../nightworkers/nightworkers.route-utils';
import * as service from './project-evaluation.service';

const listProjectEvaluationsRoute = createRoute({
  method: 'get',
  path: '/repositories/:id/evaluations',
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: {
      content: { 'application/json': { schema: z.array(projectEvaluationRunSchema) } },
      description: 'Project evaluation history',
    },
  },
});

const getLatestProjectEvaluationRoute = createRoute({
  method: 'get',
  path: '/repositories/:id/evaluations/latest',
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: {
      content: { 'application/json': { schema: projectEvaluationRunSchema.nullable() } },
      description: 'Latest project evaluation',
    },
  },
});

const createProjectEvaluationRoute = createRoute({
  method: 'post',
  path: '/repositories/:id/evaluations',
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: { content: { 'application/json': { schema: createProjectEvaluationRequestSchema } } },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: projectEvaluationDetailSchema } },
      description: 'Project evaluation created',
    },
  },
});

const getProjectEvaluationRoute = createRoute({
  method: 'get',
  path: '/project-evaluations/:evaluationId',
  request: { params: z.object({ evaluationId: z.string().uuid() }) },
  responses: {
    200: {
      content: { 'application/json': { schema: projectEvaluationDetailSchema } },
      description: 'Project evaluation detail',
    },
  },
});

const generateProjectImprovementsRoute = createRoute({
  method: 'post',
  path: '/project-evaluations/:evaluationId/improvements',
  request: {
    params: z.object({ evaluationId: z.string().uuid() }),
    body: { content: { 'application/json': { schema: generateProjectImprovementsRequestSchema } } },
  },
  responses: {
    201: {
      content: {
        'application/json': {
          schema: z.object({
            ideas: z.array(projectImprovementIdeaSchema),
            selectedDimensionKeys: z.array(z.string()),
          }),
        },
      },
      description: 'Project improvement ideas generated',
    },
  },
});

const listProjectImprovementsRoute = createRoute({
  method: 'get',
  path: '/project-evaluations/:evaluationId/improvements',
  request: { params: z.object({ evaluationId: z.string().uuid() }) },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: z.object({ ideas: z.array(projectImprovementIdeaSchema) }),
        },
      },
      description: 'Project improvement ideas',
    },
  },
});

const createProjectEvaluationTasksRoute = createRoute({
  method: 'post',
  path: '/project-evaluations/:evaluationId/tasks',
  request: {
    params: z.object({ evaluationId: z.string().uuid() }),
    body: {
      content: {
        'application/json': { schema: createTasksFromProjectImprovementsRequestSchema },
      },
    },
  },
  responses: {
    201: {
      content: {
        'application/json': {
          schema: z.object({
            tasks: z.array(taskSchema),
            taskLinks: z.array(projectEvaluationTaskLinkSchema),
          }),
        },
      },
      description: 'Tasks created from selected improvement ideas',
    },
  },
});

export const projectEvaluationRouter = createOpenApiRouter()
  .openapi(
    listProjectEvaluationsRoute,
    withOpenApiRouteError(listProjectEvaluationsRoute, async (c) => {
      return c.json(await service.listProjectEvaluations(c.req.param('id')), 200);
    })
  )
  .openapi(
    getLatestProjectEvaluationRoute,
    withOpenApiRouteError(getLatestProjectEvaluationRoute, async (c) => {
      return c.json(await service.getLatestProjectEvaluation(c.req.param('id')), 200);
    })
  )
  .openapi(
    createProjectEvaluationRoute,
    withOpenApiRouteError(createProjectEvaluationRoute, async (c) => {
      return c.json(
        await service.runProjectEvaluation({
          repositoryId: c.req.param('id'),
          baselinePrompt: c.req.valid('json').baselinePrompt,
        }),
        201
      );
    })
  )
  .openapi(
    getProjectEvaluationRoute,
    withOpenApiRouteError(getProjectEvaluationRoute, async (c) => {
      return c.json(await service.getProjectEvaluationDetail(c.req.param('evaluationId')), 200);
    })
  )
  .openapi(
    generateProjectImprovementsRoute,
    withOpenApiRouteError(generateProjectImprovementsRoute, async (c) => {
      return c.json(
        await service.generateProjectImprovements({
          evaluationId: c.req.param('evaluationId'),
          dimensionKeys: c.req.valid('json').dimensionKeys,
        }),
        201
      );
    })
  )
  .openapi(
    listProjectImprovementsRoute,
    withOpenApiRouteError(listProjectImprovementsRoute, async (c) => {
      return c.json(await service.listProjectImprovements(c.req.param('evaluationId')), 200);
    })
  )
  .openapi(
    createProjectEvaluationTasksRoute,
    withOpenApiRouteError(createProjectEvaluationTasksRoute, async (c) => {
      const body = c.req.valid('json');
      return c.json(
        await service.createTasksFromProjectImprovements({
          evaluationId: c.req.param('evaluationId'),
          ideaIds: body.ideaIds,
          mode: body.mode,
        }),
        201
      );
    })
  );
