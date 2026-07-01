import { createRoute, z } from '@hono/zod-openapi';
import {
  createMissionGoalFromPresetRequestSchema,
  createMissionGoalRequestSchema,
  createProjectQualityRunRequestSchema,
  createTasksFromMissionCandidatesRequestSchema,
  createTasksFromMissionCandidatesResponseSchema,
  generateMissionTaskCandidatesRequestSchema,
  generateMissionTaskCandidatesResponseSchema,
  missionGoalPresetSchema,
  missionGoalSchema,
  missionTaskCandidateSchema,
  projectDetailMetricsSchema,
  projectQualityOverviewSchema,
  projectQualityRunSchema,
  updateMissionGoalRequestSchema,
  updateMissionTaskCandidateRequestSchema,
} from '../../../shared/schemas/project-detail.schema';
import { createOpenApiRouter } from '../../lib/openapi';
import { withOpenApiRouteError } from '../nightworkers/nightworkers.route-utils';
import * as service from './project-detail.service';

const repositoryParams = z.object({ id: z.string().uuid() });
const goalParams = z.object({ id: z.string().uuid(), goalId: z.string().uuid() });
const candidateParams = z.object({ candidateId: z.string().uuid() });
const runParams = z.object({ id: z.string().uuid(), runId: z.string().uuid() });

const getMetricsRoute = createRoute({
  method: 'get',
  path: '/repositories/:id/project-detail/metrics',
  request: { params: repositoryParams },
  responses: {
    200: {
      content: { 'application/json': { schema: projectDetailMetricsSchema } },
      description: 'Project detail metrics',
    },
  },
});

const listMissionGoalsRoute = createRoute({
  method: 'get',
  path: '/repositories/:id/mission-goals',
  request: { params: repositoryParams },
  responses: {
    200: {
      content: { 'application/json': { schema: z.array(missionGoalSchema) } },
      description: 'Mission goals',
    },
  },
});

const createMissionGoalRoute = createRoute({
  method: 'post',
  path: '/repositories/:id/mission-goals',
  request: {
    params: repositoryParams,
    body: { content: { 'application/json': { schema: createMissionGoalRequestSchema } } },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: missionGoalSchema } },
      description: 'Mission goal created',
    },
  },
});

const updateMissionGoalRoute = createRoute({
  method: 'patch',
  path: '/repositories/:id/mission-goals/:goalId',
  request: {
    params: goalParams,
    body: { content: { 'application/json': { schema: updateMissionGoalRequestSchema } } },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: missionGoalSchema } },
      description: 'Mission goal updated',
    },
  },
});

const deleteMissionGoalRoute = createRoute({
  method: 'delete',
  path: '/repositories/:id/mission-goals/:goalId',
  request: { params: goalParams },
  responses: {
    200: {
      content: { 'application/json': { schema: missionGoalSchema } },
      description: 'Mission goal deleted',
    },
  },
});

const listMissionGoalPresetsRoute = createRoute({
  method: 'get',
  path: '/mission-goal-presets',
  responses: {
    200: {
      content: { 'application/json': { schema: z.array(missionGoalPresetSchema) } },
      description: 'Mission goal presets',
    },
  },
});

const createMissionGoalFromPresetRoute = createRoute({
  method: 'post',
  path: '/repositories/:id/mission-goals/from-preset',
  request: {
    params: repositoryParams,
    body: {
      content: { 'application/json': { schema: createMissionGoalFromPresetRequestSchema } },
    },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: missionGoalSchema } },
      description: 'Mission goal created from preset',
    },
  },
});

const listMissionTaskCandidatesRoute = createRoute({
  method: 'get',
  path: '/repositories/:id/mission-task-candidates',
  request: {
    params: repositoryParams,
    query: z.object({ status: z.string().optional() }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: z.array(missionTaskCandidateSchema) } },
      description: 'Mission task candidates',
    },
  },
});

const generateMissionTaskCandidatesRoute = createRoute({
  method: 'post',
  path: '/repositories/:id/mission-task-candidates/generate',
  request: {
    params: repositoryParams,
    body: {
      content: { 'application/json': { schema: generateMissionTaskCandidatesRequestSchema } },
    },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: generateMissionTaskCandidatesResponseSchema } },
      description: 'Mission task candidates generated',
    },
  },
});

const getMissionTaskCandidateRoute = createRoute({
  method: 'get',
  path: '/mission-task-candidates/:candidateId',
  request: { params: candidateParams },
  responses: {
    200: {
      content: { 'application/json': { schema: missionTaskCandidateSchema } },
      description: 'Mission task candidate detail',
    },
  },
});

const updateMissionTaskCandidateRoute = createRoute({
  method: 'patch',
  path: '/mission-task-candidates/:candidateId',
  request: {
    params: candidateParams,
    body: { content: { 'application/json': { schema: updateMissionTaskCandidateRequestSchema } } },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: missionTaskCandidateSchema } },
      description: 'Mission task candidate updated',
    },
  },
});

const createTasksFromMissionCandidatesRoute = createRoute({
  method: 'post',
  path: '/repositories/:id/mission-task-candidates/create-tasks',
  request: {
    params: repositoryParams,
    body: {
      content: {
        'application/json': { schema: createTasksFromMissionCandidatesRequestSchema },
      },
    },
  },
  responses: {
    201: {
      content: {
        'application/json': { schema: createTasksFromMissionCandidatesResponseSchema },
      },
      description: 'Tasks created from mission task candidates',
    },
  },
});

const getProjectQualityRoute = createRoute({
  method: 'get',
  path: '/repositories/:id/quality',
  request: { params: repositoryParams },
  responses: {
    200: {
      content: { 'application/json': { schema: projectQualityOverviewSchema } },
      description: 'Project quality overview',
    },
  },
});

const listProjectQualityRunsRoute = createRoute({
  method: 'get',
  path: '/repositories/:id/quality/runs',
  request: { params: repositoryParams },
  responses: {
    200: {
      content: { 'application/json': { schema: z.array(projectQualityRunSchema) } },
      description: 'Project quality runs',
    },
  },
});

const createProjectQualityRunRoute = createRoute({
  method: 'post',
  path: '/repositories/:id/quality/runs',
  request: {
    params: repositoryParams,
    body: { content: { 'application/json': { schema: createProjectQualityRunRequestSchema } } },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: projectQualityRunSchema } },
      description: 'Project quality run created',
    },
  },
});

const getProjectQualityRunRoute = createRoute({
  method: 'get',
  path: '/repositories/:id/quality/runs/:runId',
  request: { params: runParams },
  responses: {
    200: {
      content: { 'application/json': { schema: projectQualityRunSchema } },
      description: 'Project quality run detail',
    },
  },
});

const cancelProjectQualityRunRoute = createRoute({
  method: 'post',
  path: '/repositories/:id/quality/runs/:runId/cancel',
  request: { params: runParams },
  responses: {
    200: {
      content: { 'application/json': { schema: projectQualityRunSchema } },
      description: 'Project quality run cancelled',
    },
  },
});

export const projectDetailRouter = createOpenApiRouter()
  .openapi(
    getMetricsRoute,
    withOpenApiRouteError(getMetricsRoute, async (c) =>
      c.json(await service.getProjectDetailMetrics(c.req.param('id')), 200)
    )
  )
  .openapi(
    listMissionGoalsRoute,
    withOpenApiRouteError(listMissionGoalsRoute, async (c) =>
      c.json(await service.listMissionGoals(c.req.param('id')), 200)
    )
  )
  .openapi(
    createMissionGoalRoute,
    withOpenApiRouteError(createMissionGoalRoute, async (c) =>
      c.json(await service.createMissionGoal(c.req.param('id'), c.req.valid('json')), 201)
    )
  )
  .openapi(
    updateMissionGoalRoute,
    withOpenApiRouteError(updateMissionGoalRoute, async (c) =>
      c.json(
        await service.updateMissionGoal(
          c.req.param('id'),
          c.req.param('goalId'),
          c.req.valid('json')
        ),
        200
      )
    )
  )
  .openapi(
    deleteMissionGoalRoute,
    withOpenApiRouteError(deleteMissionGoalRoute, async (c) =>
      c.json(await service.deleteMissionGoal(c.req.param('id'), c.req.param('goalId')), 200)
    )
  )
  .openapi(
    listMissionGoalPresetsRoute,
    withOpenApiRouteError(listMissionGoalPresetsRoute, async (c) =>
      c.json(service.listMissionGoalPresets(), 200)
    )
  )
  .openapi(
    createMissionGoalFromPresetRoute,
    withOpenApiRouteError(createMissionGoalFromPresetRoute, async (c) =>
      c.json(await service.createMissionGoalFromPreset(c.req.param('id'), c.req.valid('json')), 201)
    )
  )
  .openapi(
    listMissionTaskCandidatesRoute,
    withOpenApiRouteError(listMissionTaskCandidatesRoute, async (c) =>
      c.json(
        await service.listMissionTaskCandidates({
          repositoryId: c.req.param('id'),
          status: c.req.valid('query').status,
        }),
        200
      )
    )
  )
  .openapi(
    generateMissionTaskCandidatesRoute,
    withOpenApiRouteError(generateMissionTaskCandidatesRoute, async (c) =>
      c.json(
        await service.generateMissionTaskCandidates({
          repositoryId: c.req.param('id'),
          ...c.req.valid('json'),
        }),
        201
      )
    )
  )
  .openapi(
    getMissionTaskCandidateRoute,
    withOpenApiRouteError(getMissionTaskCandidateRoute, async (c) =>
      c.json(await service.getMissionTaskCandidate(c.req.param('candidateId')), 200)
    )
  )
  .openapi(
    updateMissionTaskCandidateRoute,
    withOpenApiRouteError(updateMissionTaskCandidateRoute, async (c) =>
      c.json(
        await service.updateMissionTaskCandidate(c.req.param('candidateId'), c.req.valid('json')),
        200
      )
    )
  )
  .openapi(
    createTasksFromMissionCandidatesRoute,
    withOpenApiRouteError(createTasksFromMissionCandidatesRoute, async (c) =>
      c.json(
        await service.createTasksFromMissionCandidates({
          repositoryId: c.req.param('id'),
          ...c.req.valid('json'),
        }),
        201
      )
    )
  )
  .openapi(
    getProjectQualityRoute,
    withOpenApiRouteError(getProjectQualityRoute, async (c) =>
      c.json(await service.getProjectQuality(c.req.param('id')), 200)
    )
  )
  .openapi(
    listProjectQualityRunsRoute,
    withOpenApiRouteError(listProjectQualityRunsRoute, async (c) =>
      c.json(await service.listProjectQualityRuns(c.req.param('id')), 200)
    )
  )
  .openapi(
    createProjectQualityRunRoute,
    withOpenApiRouteError(createProjectQualityRunRoute, async (c) =>
      c.json(
        await service.createProjectQualityRun({
          repositoryId: c.req.param('id'),
          runType: c.req.valid('json').runType,
        }),
        201
      )
    )
  )
  .openapi(
    getProjectQualityRunRoute,
    withOpenApiRouteError(getProjectQualityRunRoute, async (c) =>
      c.json(await service.getProjectQualityRun(c.req.param('id'), c.req.param('runId')), 200)
    )
  )
  .openapi(
    cancelProjectQualityRunRoute,
    withOpenApiRouteError(cancelProjectQualityRunRoute, async (c) =>
      c.json(await service.cancelProjectQualityRun(c.req.param('id'), c.req.param('runId')), 200)
    )
  );
