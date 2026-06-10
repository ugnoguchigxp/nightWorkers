import type { RouteConfig, RouteHandler } from '@hono/zod-openapi';
import type { AppEnv } from '../../lib/types';
import { withOpenApiRouteError } from './nightworkers.route-utils';
import * as service from './nightworkers.service';
import {
  createReviewerEvaluationRoute,
  createReviewerReplayEvaluationRoute,
  createRunReviewRoute,
  type exportTaskRunJsonlRoute,
  type getBackgroundProcessRoute,
  type getTaskRunRoute,
  listBackgroundProcessesRoute,
  type listReviewRubricsRoute,
  listTaskRunActivityEventsRoute,
  listTaskRunEventsRoute,
  type listTaskRunsRoute,
  startBackgroundProcessRoute,
  stopBackgroundProcessRoute,
  stopTaskRunRoute,
} from './routes/run-routes';
import {
  acceptDesignQuestionnaireReviewRoute,
  createDesignQuestionnaireRoute,
  generateDesignQuestionnaireFollowUpRoute,
  generateDesignQuestionnaireReviewRoute,
  generateSpecificationStatusBlueprintRoute,
  generateSpecificationStatusDbDesignRoute,
  generateSpecificationStatusDesignDocumentRoute,
  getBlueprintSpecificationWorkspaceRoute,
  getDesignQuestionnaireRoute,
  getSpecificationWorkspaceRoute,
  leaveDesignQuestionnaireReviewUnadoptedRoute,
  listDesignQuestionnairesRoute,
  saveDesignQuestionnaireAnswersRoute,
  startTaskRunRoute,
} from './routes/task-routes';

type NightWorkersRouteHandler<Route extends RouteConfig> = RouteHandler<Route, AppEnv>;
type NightWorkersRouteContext<Route extends RouteConfig> = Parameters<
  NightWorkersRouteHandler<Route>
>[0];

function routeNotFound<Route extends RouteConfig>(
  c: NightWorkersRouteContext<Route>,
  message: string
): never {
  return c.json({ error: message }, 404) as never;
}

export const createDesignQuestionnaireHandler = withOpenApiRouteError(
  createDesignQuestionnaireRoute,
  async (c) => {
    const id = c.req.param('id');
    const request = c.req.valid('json');
    const session = await service.createDesignQuestionnaire(id, request.sourceBlueprintMessageId);
    return c.json(session, 201);
  }
);

export const listDesignQuestionnairesHandler = withOpenApiRouteError(
  listDesignQuestionnairesRoute,
  async (c) => {
    const id = c.req.param('id');
    const sessions = await service.listDesignQuestionnaires(id);
    return c.json(sessions, 200);
  }
);

export const getDesignQuestionnaireHandler = withOpenApiRouteError(
  getDesignQuestionnaireRoute,
  async (c) => {
    const id = c.req.param('id');
    const sessionId = c.req.param('sessionId');
    const session = await service.getDesignQuestionnaireSession(id, sessionId);
    return c.json(session, 200);
  }
);

export const saveDesignQuestionnaireAnswersHandler = withOpenApiRouteError(
  saveDesignQuestionnaireAnswersRoute,
  async (c) => {
    const id = c.req.param('id');
    const sessionId = c.req.param('sessionId');
    const request = c.req.valid('json');
    const session = await service.saveDesignQuestionnaireAnswers(id, sessionId, request.answers);
    return c.json(session, 200);
  }
);

export const generateDesignQuestionnaireFollowUpHandler = withOpenApiRouteError(
  generateDesignQuestionnaireFollowUpRoute,
  async (c) => {
    const id = c.req.param('id');
    const sessionId = c.req.param('sessionId');
    const session = await service.generateDesignQuestionnaireFollowUp(id, sessionId);
    return c.json(session, 200);
  }
);

export const generateDesignQuestionnaireReviewHandler = withOpenApiRouteError(
  generateDesignQuestionnaireReviewRoute,
  async (c) => {
    const id = c.req.param('id');
    const sessionId = c.req.param('sessionId');
    const result = await service.generateDesignQuestionnaireReview(id, sessionId);
    return c.json(result, 200);
  }
);

export const acceptDesignQuestionnaireReviewHandler = withOpenApiRouteError(
  acceptDesignQuestionnaireReviewRoute,
  async (c) => {
    const id = c.req.param('id');
    const sessionId = c.req.param('sessionId');
    const session = await service.acceptDesignQuestionnaireReview(id, sessionId);
    return c.json(session, 200);
  }
);

export const leaveDesignQuestionnaireReviewUnadoptedHandler = withOpenApiRouteError(
  leaveDesignQuestionnaireReviewUnadoptedRoute,
  async (c) => {
    const id = c.req.param('id');
    const sessionId = c.req.param('sessionId');
    const session = await service.leaveDesignQuestionnaireReviewUnadopted(id, sessionId);
    return c.json(session, 200);
  }
);

export const getBlueprintSpecificationWorkspaceHandler = withOpenApiRouteError(
  getBlueprintSpecificationWorkspaceRoute,
  async (c) => {
    const id = c.req.param('id');
    const workspace = await service.getBlueprintSpecificationWorkspace(id);
    return c.json(workspace, 200);
  }
);

export const getSpecificationWorkspaceHandler = withOpenApiRouteError(
  getSpecificationWorkspaceRoute,
  async (c) => {
    const id = c.req.param('id');
    const workspace = await service.getSpecificationWorkspace(id);
    return c.json(workspace, 200);
  }
);

export const generateSpecificationStatusBlueprintHandler = withOpenApiRouteError(
  generateSpecificationStatusBlueprintRoute,
  async (c) => {
    const id = c.req.param('id');
    const request = c.req.valid('json');
    const result = await service.generateSpecificationStatusBlueprint(id, request);
    return c.json(result, 200);
  }
);

export const generateSpecificationStatusDbDesignHandler = withOpenApiRouteError(
  generateSpecificationStatusDbDesignRoute,
  async (c) => {
    const id = c.req.param('id');
    const request = c.req.valid('json');
    const result = await service.generateSpecificationStatusDbDesign(id, request);
    return c.json(result, 200);
  }
);

export const generateSpecificationStatusDesignDocumentHandler = withOpenApiRouteError(
  generateSpecificationStatusDesignDocumentRoute,
  async (c) => {
    const id = c.req.param('id');
    const request = c.req.valid('json');
    const result = await service.generateSpecificationStatusDesignDocument(id, request);
    return c.json(result, 200);
  }
);

export const startTaskRunHandler = withOpenApiRouteError(startTaskRunRoute, async (c) => {
  const id = c.req.param('id');
  const run = await service.startTaskRun(id);
  return c.json(run, 201);
});

export const getTaskRunHandler: NightWorkersRouteHandler<typeof getTaskRunRoute> = async (c) => {
  const id = c.req.param('id');
  const run = await service.getTaskRun(id);
  if (!run) return routeNotFound(c, 'Run not found');
  return c.json(run, 200);
};

export const stopTaskRunHandler = withOpenApiRouteError(stopTaskRunRoute, async (c) => {
  const id = c.req.param('id');
  const run = await service.stopTaskRun(id);
  return c.json(run, 200);
});

export const listTaskRunEventsHandler = withOpenApiRouteError(listTaskRunEventsRoute, async (c) => {
  const id = c.req.param('id');
  const events = await service.listTaskRunEvents(id, c.req.valid('query'));
  return c.json(events, 200);
});

export const listTaskRunActivityEventsHandler = withOpenApiRouteError(
  listTaskRunActivityEventsRoute,
  async (c) => {
    const id = c.req.param('id');
    const events = await service.listTaskRunActivityEvents(id, c.req.valid('query'));
    return c.json(events, 200);
  }
);

export const startBackgroundProcessHandler = withOpenApiRouteError(
  startBackgroundProcessRoute,
  async (c) => {
    const request = c.req.valid('json');
    const processRecord = await service.startTaskBackgroundProcess(request);
    return c.json(processRecord, 201);
  }
);

export const listBackgroundProcessesHandler = withOpenApiRouteError(
  listBackgroundProcessesRoute,
  async (c) => {
    const processes = await service.listTaskBackgroundProcesses(c.req.valid('query'));
    return c.json(processes, 200);
  }
);

export const getBackgroundProcessHandler: NightWorkersRouteHandler<
  typeof getBackgroundProcessRoute
> = async (c) => {
  const processRecord = await service.getTaskBackgroundProcess(c.req.param('id'));
  if (!processRecord) return routeNotFound(c, 'Background process not found');
  return c.json(processRecord, 200);
};

export const stopBackgroundProcessHandler = withOpenApiRouteError(
  stopBackgroundProcessRoute,
  async (c) => {
    const processRecord = await service.stopTaskBackgroundProcess(c.req.param('id'));
    return c.json(processRecord, 200);
  }
);

export const createRunReviewHandler = withOpenApiRouteError(createRunReviewRoute, async (c) => {
  const id = c.req.param('id');
  const request = c.req.valid('json');
  const result = await service.reviewTaskRun(id, request);
  return c.json(result, 200);
});

export const listTaskRunsHandler: NightWorkersRouteHandler<typeof listTaskRunsRoute> = async (
  c
) => {
  const id = c.req.param('id');
  const runs = await service.getTaskRunsForTask(id);
  return c.json(runs, 200);
};

export const listReviewRubricsHandler: NightWorkersRouteHandler<
  typeof listReviewRubricsRoute
> = async (c) => {
  return c.json(service.getReviewRubrics(), 200);
};

export const createReviewerEvaluationHandler = withOpenApiRouteError(
  createReviewerEvaluationRoute,
  async (c) => {
    const id = c.req.param('id');
    const request = c.req.valid('json');
    const result = await service.createReviewerEvaluation(id, request);
    return c.json(result, 200);
  }
);

export const createReviewerReplayEvaluationHandler = withOpenApiRouteError(
  createReviewerReplayEvaluationRoute,
  async (c) => {
    const id = c.req.param('id');
    const request = c.req.valid('json');
    const result = await service.createReviewerReplayEvaluation(id, request);
    return c.json(result, 200);
  }
);

export const exportTaskRunJsonlHandler: NightWorkersRouteHandler<
  typeof exportTaskRunJsonlRoute
> = async (c) => {
  const id = c.req.param('id');
  const jsonl = await service.exportTaskRunJsonl(id);
  if (!jsonl) return routeNotFound(c, 'Run not found');
  c.header('Content-Type', 'application/x-ndjson; charset=utf-8');
  c.header('Content-Disposition', `attachment; filename="nightworkers-run-${id}.jsonl"`);
  return c.body(jsonl, 200);
};
