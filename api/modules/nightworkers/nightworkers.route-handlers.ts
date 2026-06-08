import { queueRouteError } from './nightworkers.route-utils';
import * as service from './nightworkers.service';

export async function createDesignQuestionnaireHandler(c: any): Promise<any> {
  const id = c.req.param('id');
  const request = c.req.valid('json');
  try {
    const session = await service.createDesignQuestionnaire(id, request.sourceBlueprintMessageId);
    return c.json(session, 201);
  } catch (err: any) {
    return queueRouteError(c, err);
  }
}

export async function listDesignQuestionnairesHandler(c: any): Promise<any> {
  const id = c.req.param('id');
  try {
    const sessions = await service.listDesignQuestionnaires(id);
    return c.json(sessions, 200);
  } catch (err: any) {
    return queueRouteError(c, err);
  }
}

export async function getDesignQuestionnaireHandler(c: any): Promise<any> {
  const id = c.req.param('id');
  const sessionId = c.req.param('sessionId');
  try {
    const session = await service.getDesignQuestionnaireSession(id, sessionId);
    return c.json(session, 200);
  } catch (err: any) {
    return queueRouteError(c, err);
  }
}

export async function saveDesignQuestionnaireAnswersHandler(c: any): Promise<any> {
  const id = c.req.param('id');
  const sessionId = c.req.param('sessionId');
  const request = c.req.valid('json');
  try {
    const session = await service.saveDesignQuestionnaireAnswers(id, sessionId, request.answers);
    return c.json(session, 200);
  } catch (err: any) {
    return queueRouteError(c, err);
  }
}

export async function generateDesignQuestionnaireFollowUpHandler(c: any): Promise<any> {
  const id = c.req.param('id');
  const sessionId = c.req.param('sessionId');
  try {
    const session = await service.generateDesignQuestionnaireFollowUp(id, sessionId);
    return c.json(session, 200);
  } catch (err: any) {
    return queueRouteError(c, err);
  }
}

export async function generateDesignQuestionnaireReviewHandler(c: any): Promise<any> {
  const id = c.req.param('id');
  const sessionId = c.req.param('sessionId');
  try {
    const result = await service.generateDesignQuestionnaireReview(id, sessionId);
    return c.json(result, 200);
  } catch (err: any) {
    return queueRouteError(c, err);
  }
}

export async function acceptDesignQuestionnaireReviewHandler(c: any): Promise<any> {
  const id = c.req.param('id');
  const sessionId = c.req.param('sessionId');
  try {
    const session = await service.acceptDesignQuestionnaireReview(id, sessionId);
    return c.json(session, 200);
  } catch (err: any) {
    return queueRouteError(c, err);
  }
}

export async function leaveDesignQuestionnaireReviewUnadoptedHandler(c: any): Promise<any> {
  const id = c.req.param('id');
  const sessionId = c.req.param('sessionId');
  try {
    const session = await service.leaveDesignQuestionnaireReviewUnadopted(id, sessionId);
    return c.json(session, 200);
  } catch (err: any) {
    return queueRouteError(c, err);
  }
}

export async function getBlueprintSpecificationWorkspaceHandler(c: any): Promise<any> {
  const id = c.req.param('id');
  try {
    const workspace = await service.getBlueprintSpecificationWorkspace(id);
    return c.json(workspace, 200);
  } catch (err: any) {
    return queueRouteError(c, err);
  }
}

export async function getSpecificationWorkspaceHandler(c: any): Promise<any> {
  const id = c.req.param('id');
  try {
    const workspace = await service.getSpecificationWorkspace(id);
    return c.json(workspace, 200);
  } catch (err: any) {
    return queueRouteError(c, err);
  }
}

export async function generateSpecificationStatusBlueprintHandler(c: any): Promise<any> {
  const id = c.req.param('id');
  const request = c.req.valid('json');
  try {
    const result = await service.generateSpecificationStatusBlueprint(id, request);
    return c.json(result, 200);
  } catch (err: any) {
    return queueRouteError(c, err);
  }
}

export async function generateSpecificationStatusDbDesignHandler(c: any): Promise<any> {
  const id = c.req.param('id');
  const request = c.req.valid('json');
  try {
    const result = await service.generateSpecificationStatusDbDesign(id, request);
    return c.json(result, 200);
  } catch (err: any) {
    return queueRouteError(c, err);
  }
}

export async function generateSpecificationStatusDesignDocumentHandler(c: any): Promise<any> {
  const id = c.req.param('id');
  const request = c.req.valid('json');
  try {
    const result = await service.generateSpecificationStatusDesignDocument(id, request);
    return c.json(result, 200);
  } catch (err: any) {
    return queueRouteError(c, err);
  }
}

export async function startTaskRunHandler(c: any) {
  const id = c.req.param('id');
  try {
    const run = await service.startTaskRun(id);
    return c.json(run, 201);
  } catch (err: any) {
    return queueRouteError(c, err);
  }
}

export async function getTaskRunHandler(c: any) {
  const id = c.req.param('id');
  const run = await service.getTaskRun(id);
  if (!run) return c.json({ error: 'Run not found' }, 404);
  return c.json(run, 200);
}

export async function listTaskRunEventsHandler(c: any) {
  const id = c.req.param('id');
  try {
    const events = await service.listTaskRunEvents(id, c.req.valid('query'));
    return c.json(events, 200);
  } catch (err: any) {
    return queueRouteError(c, err);
  }
}

export async function listTaskRunActivityEventsHandler(c: any) {
  const id = c.req.param('id');
  try {
    const events = await service.listTaskRunActivityEvents(id, c.req.valid('query'));
    return c.json(events, 200);
  } catch (err: any) {
    return queueRouteError(c, err);
  }
}

export async function createRunReviewHandler(c: any) {
  const id = c.req.param('id');
  const request = c.req.valid('json');
  try {
    const result = await service.reviewTaskRun(id, request);
    return c.json(result, 200);
  } catch (err: any) {
    return queueRouteError(c, err);
  }
}

export async function listTaskRunsHandler(c: any) {
  const id = c.req.param('id');
  const runs = await service.getTaskRunsForTask(id);
  return c.json(runs, 200);
}

export async function listReviewRubricsHandler(c: any) {
  return c.json(service.getReviewRubrics(), 200);
}

export async function createReviewerEvaluationHandler(c: any) {
  const id = c.req.param('id');
  const request = c.req.valid('json');
  try {
    const result = await service.createReviewerEvaluation(id, request);
    return c.json(result, 200);
  } catch (err: any) {
    return queueRouteError(c, err);
  }
}

export async function createReviewerReplayEvaluationHandler(c: any) {
  const id = c.req.param('id');
  const request = c.req.valid('json');
  try {
    const result = await service.createReviewerReplayEvaluation(id, request);
    return c.json(result, 200);
  } catch (err: any) {
    return queueRouteError(c, err);
  }
}

export async function exportTaskRunJsonlHandler(c: any) {
  const id = c.req.param('id');
  const jsonl = await service.exportTaskRunJsonl(id);
  if (!jsonl) return c.json({ error: 'Run not found' }, 404);
  c.header('Content-Type', 'application/x-ndjson; charset=utf-8');
  c.header('Content-Disposition', `attachment; filename="nightworkers-run-${id}.jsonl"`);
  return c.body(jsonl, 200);
}
