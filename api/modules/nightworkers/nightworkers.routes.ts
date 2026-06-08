import { ValidationError } from '../../lib/errors';
import { logEvent } from '../../lib/logger';
import { createOpenApiRouter } from '../../lib/openapi';
import {
  acceptDesignQuestionnaireReviewHandler,
  createDesignQuestionnaireHandler,
  createReviewerEvaluationHandler,
  createReviewerReplayEvaluationHandler,
  createRunReviewHandler,
  exportTaskRunJsonlHandler,
  generateDesignQuestionnaireFollowUpHandler,
  generateDesignQuestionnaireReviewHandler,
  generateSpecificationStatusBlueprintHandler,
  generateSpecificationStatusDbDesignHandler,
  generateSpecificationStatusDesignDocumentHandler,
  getBlueprintSpecificationWorkspaceHandler,
  getDesignQuestionnaireHandler,
  getSpecificationWorkspaceHandler,
  getTaskRunHandler,
  leaveDesignQuestionnaireReviewUnadoptedHandler,
  listDesignQuestionnairesHandler,
  listReviewRubricsHandler,
  listTaskRunActivityEventsHandler,
  listTaskRunEventsHandler,
  listTaskRunsHandler,
  saveDesignQuestionnaireAnswersHandler,
  startTaskRunHandler,
  stopTaskRunHandler,
} from './nightworkers.route-handlers';
import { queueRouteError } from './nightworkers.route-utils';
import * as service from './nightworkers.service';
import {
  archiveImplementationQueueEntryRoute,
  archiveWorkbenchSessionRoute,
  createImplementationQueueEntryRoute,
  drainImplementationQueueRoute,
  getImplementationQueueSettingsRoute,
  getTodoWorkflowSettingsRoute,
  implementationQueueDashboardRoute,
  patchImplementationQueueEntryRoute,
  patchImplementationQueueSettingsRoute,
  patchTodoWorkflowSettingsRoute,
  queueWorkbenchSessionRoute,
  requeueImplementationQueueEntryRoute,
  runWorkbenchSessionRoute,
} from './routes/queue-routes';
import {
  createRepositoryRoute,
  deleteRepositoryRoute,
  getRepositoryRoute,
  listProjectFilesRoute,
  listRepositoriesRoute,
  readProjectFileRoute,
  updateRepositoryRoute,
} from './routes/repository-routes';
import {
  createReviewerEvaluationRoute,
  createReviewerReplayEvaluationRoute,
  createRunReviewRoute,
  exportTaskRunJsonlRoute,
  getOverviewDashboardRoute,
  getTaskLlmUsageRoute,
  getTaskRunRoute,
  listReviewRubricsRoute,
  listTaskActivityEventsRoute,
  listTaskMessagesRoute,
  listTaskRunActivityEventsRoute,
  listTaskRunEventsRoute,
  listTaskRunsRoute,
  stopTaskRunRoute,
} from './routes/run-routes';
import {
  acceptDesignQuestionnaireReviewRoute,
  appendTaskMessageRoute,
  appendWorkbenchMessageRoute,
  createDesignQuestionnaireRoute,
  createTaskRoute,
  createWorkbenchSessionRoute,
  deleteTaskRoute,
  generateDesignQuestionnaireFollowUpRoute,
  generateDesignQuestionnaireReviewRoute,
  generateSpecificationStatusBlueprintRoute,
  generateSpecificationStatusDbDesignRoute,
  generateSpecificationStatusDesignDocumentRoute,
  getBlueprintArtifactAdoptionRoute,
  getBlueprintDbDesignAdoptionRoute,
  getBlueprintDesignSettingsRoute,
  getBlueprintDesignTokenAdoptionRoute,
  getBlueprintSpecificationWorkspaceRoute,
  getDesignQuestionnaireRoute,
  getSpecificationWorkspaceRoute,
  getTaskRoute,
  leaveDesignQuestionnaireReviewUnadoptedRoute,
  listDesignQuestionnairesRoute,
  listTasksRoute,
  saveBlueprintArtifactAdoptionRoute,
  saveBlueprintDbDesignAdoptionRoute,
  saveBlueprintDesignSettingsRoute,
  saveBlueprintDesignTokenAdoptionRoute,
  saveDesignQuestionnaireAnswersRoute,
  startTaskRunRoute,
  updateTaskRoute,
} from './routes/task-routes';
import { browseFoldersRoute, createFolderRoute } from './routes/util-routes';

const router = createOpenApiRouter()
  .openapi(getOverviewDashboardRoute, async (c: any) => {
    try {
      const dashboard = await service.getOverviewDashboard(c.req.valid('query'));
      return c.json(dashboard, 200);
    } catch (err: any) {
      if (err?.statusCode === 404) {
        return c.json({ error: 'Repository not found' }, 404);
      }
      return queueRouteError(c, err);
    }
  })
  .openapi(listRepositoriesRoute, async (c: any) => {
    const list = await service.listRepositories();
    return c.json(list, 200);
  })
  .openapi(createRepositoryRoute, async (c: any) => {
    let data = c.req.valid('json');
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
      } catch (_e) {}
    }
    if (!data?.name || !data.localPath) {
      throw new ValidationError('Name and local path are required');
    }

    const repo = await service.createRepository(data);
    return c.json(repo, 201);
  })
  .openapi(getRepositoryRoute, async (c: any) => {
    const id = c.req.param('id');
    const repo = await service.getRepository(id);
    if (!repo) return c.json({ error: 'Repository not found' }, 404);
    return c.json(repo, 200);
  })
  .openapi(updateRepositoryRoute, async (c: any) => {
    try {
      const repo = await service.updateRepository(c.req.param('id'), c.req.valid('json'));
      return c.json(repo, 200);
    } catch (err: any) {
      return queueRouteError(c, err);
    }
  })
  .openapi(listProjectFilesRoute, async (c: any) => {
    try {
      const entries = await service.listProjectFiles(c.req.param('id'), c.req.query('path'));
      return c.json(entries, 200);
    } catch (err: any) {
      return queueRouteError(c, err);
    }
  })
  .openapi(readProjectFileRoute, async (c: any) => {
    try {
      const filePath = c.req.query('path');
      if (!filePath) return c.json({ error: 'path is required' }, 400);
      const file = await service.readProjectFile(c.req.param('id'), filePath);
      return c.json(file, 200);
    } catch (err: any) {
      return queueRouteError(c, err);
    }
  })
  .openapi(deleteRepositoryRoute, async (c: any) => {
    const id = c.req.param('id');
    const repo = await service.deleteRepository(id);
    if (!repo) return c.json({ error: 'Repository not found' }, 404);
    return c.json(repo, 200);
  })
  .openapi(listTasksRoute, async (c: any) => {
    const list = await service.listTasks();
    return c.json(list, 200);
  })
  .openapi(createTaskRoute, async (c: any) => {
    let data = c.req.valid('json');
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
      } catch (_e) {}
    }
    if (!data?.repositoryId || !data.title) {
      throw new ValidationError('Repository ID and title are required');
    }

    const task = await service.createTask(data);
    return c.json(task, 201);
  })
  .openapi(getTaskRoute, async (c: any) => {
    const id = c.req.param('id');
    const task = await service.getTask(id);
    if (!task) return c.json({ error: 'Task not found' }, 404);
    return c.json(task, 200);
  })
  .openapi(deleteTaskRoute, async (c: any) => {
    const id = c.req.param('id');
    const task = await service.deleteTask(id);
    if (!task) return c.json({ error: 'Task not found' }, 404);
    return c.json(task, 200);
  })
  .openapi(updateTaskRoute, async (c: any) => {
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
  .openapi(getBlueprintDesignSettingsRoute, async (c: any) => {
    try {
      const settings = await service.getBlueprintDesignSettings(c.req.param('id'));
      return c.json(settings, 200);
    } catch (err: any) {
      return queueRouteError(c, err);
    }
  })
  .openapi(saveBlueprintDesignSettingsRoute, async (c: any) => {
    try {
      const settings = await service.saveBlueprintDesignSettings(
        c.req.param('id'),
        c.req.valid('json')
      );
      return c.json(settings, 200);
    } catch (err: any) {
      return queueRouteError(c, err);
    }
  })
  .openapi(getBlueprintArtifactAdoptionRoute, async (c: any) => {
    try {
      const adoption = await service.getBlueprintArtifactAdoption(
        c.req.param('id'),
        c.req.valid('query').messageId
      );
      return c.json(adoption, 200);
    } catch (err: any) {
      return queueRouteError(c, err);
    }
  })
  .openapi(saveBlueprintArtifactAdoptionRoute, async (c: any) => {
    try {
      const body = c.req.valid('json');
      const adoption = await service.saveBlueprintArtifactAdoption(
        c.req.param('id'),
        body.messageId,
        body.adopted
      );
      return c.json(adoption, 200);
    } catch (err: any) {
      return queueRouteError(c, err);
    }
  })
  .openapi(getBlueprintDbDesignAdoptionRoute, async (c: any) => {
    try {
      const adoption = await service.getBlueprintDbDesignAdoption(
        c.req.param('id'),
        c.req.valid('query').messageId
      );
      return c.json(adoption, 200);
    } catch (err: any) {
      return queueRouteError(c, err);
    }
  })
  .openapi(saveBlueprintDbDesignAdoptionRoute, async (c: any) => {
    try {
      const body = c.req.valid('json');
      const adoption = await service.saveBlueprintDbDesignAdoption(
        c.req.param('id'),
        body.messageId,
        body.adopted
      );
      return c.json(adoption, 200);
    } catch (err: any) {
      return queueRouteError(c, err);
    }
  })
  .openapi(getBlueprintDesignTokenAdoptionRoute, async (c: any) => {
    try {
      const adoption = await service.getBlueprintDesignTokenAdoption(
        c.req.param('id'),
        c.req.valid('query').messageId
      );
      return c.json(adoption, 200);
    } catch (err: any) {
      return queueRouteError(c, err);
    }
  })
  .openapi(saveBlueprintDesignTokenAdoptionRoute, async (c: any) => {
    try {
      const body = c.req.valid('json');
      const adoption = await service.saveBlueprintDesignTokenAdoption(
        c.req.param('id'),
        body.messageId,
        body.adopted
      );
      return c.json(adoption, 200);
    } catch (err: any) {
      return queueRouteError(c, err);
    }
  })
  .openapi(appendTaskMessageRoute, async (c: any) => {
    const id = c.req.param('id');
    const { prompt } = c.req.valid('json');
    try {
      const task = await service.appendTaskMessage(id, prompt);
      return c.json(task, 200);
    } catch (err: any) {
      return queueRouteError(c, err);
    }
  })
  .openapi(createWorkbenchSessionRoute, async (c: any) => {
    const data = c.req.valid('json');
    const task = await service.createWorkbenchSession(data);
    return c.json(task, 201);
  })
  .openapi(appendWorkbenchMessageRoute, async (c: any) => {
    const id = c.req.param('id');
    const body = c.req.valid('json');
    try {
      const result = await service.appendWorkbenchMessage(id, body);
      return c.json(result, 200);
    } catch (err: any) {
      return queueRouteError(c, err);
    }
  })

  .openapi(implementationQueueDashboardRoute, async (c: any) => {
    try {
      const result = await service.listImplementationQueueDashboard();
      return c.json(result, 200);
    } catch (err: any) {
      return queueRouteError(c, err);
    }
  })
  .openapi(createImplementationQueueEntryRoute, async (c: any) => {
    try {
      const body = c.req.valid('json');
      const entry = await service.createImplementationQueueEntry(body.taskId);
      return c.json(entry, 201);
    } catch (err: any) {
      return queueRouteError(c, err);
    }
  })
  .openapi(patchImplementationQueueEntryRoute, async (c: any) => {
    try {
      const body = c.req.valid('json');
      const entry = await service.patchImplementationQueueEntry(c.req.param('id'), body);
      return c.json(entry, 200);
    } catch (err: any) {
      return queueRouteError(c, err);
    }
  })
  .openapi(archiveImplementationQueueEntryRoute, async (c: any) => {
    try {
      const entry = await service.archiveImplementationQueueEntry(c.req.param('id'));
      return c.json(entry, 200);
    } catch (err: any) {
      return queueRouteError(c, err);
    }
  })
  .openapi(requeueImplementationQueueEntryRoute, async (c: any) => {
    try {
      const entry = await service.requeueImplementationQueueEntry(
        c.req.param('id'),
        c.req.valid('json')
      );
      return c.json(entry, 201);
    } catch (err: any) {
      return queueRouteError(c, err);
    }
  })
  .openapi(drainImplementationQueueRoute, async (c: any) => {
    try {
      const started = await service.runImplementationQueue();
      return c.json({ started: started.length }, 200);
    } catch (err: any) {
      return queueRouteError(c, err);
    }
  })
  .openapi(getImplementationQueueSettingsRoute, async (c: any) => {
    try {
      const result = await service.listImplementationQueueDashboard();
      return c.json(result.settings, 200);
    } catch (err: any) {
      return queueRouteError(c, err);
    }
  })
  .openapi(patchImplementationQueueSettingsRoute, async (c: any) => {
    try {
      const body = c.req.valid('json');
      const settings = await service.updateImplementationQueueSettings(body);
      return c.json(settings, 200);
    } catch (err: any) {
      return queueRouteError(c, err);
    }
  })
  .openapi(getTodoWorkflowSettingsRoute, async (c: any) => {
    try {
      const settings = await service.getTodoWorkflowSettings();
      return c.json(settings, 200);
    } catch (err: any) {
      return queueRouteError(c, err);
    }
  })
  .openapi(patchTodoWorkflowSettingsRoute, async (c: any) => {
    try {
      const body = c.req.valid('json');
      const settings = await service.updateTodoWorkflowSettings(body);
      return c.json(settings, 200);
    } catch (err: any) {
      return queueRouteError(c, err);
    }
  })
  .openapi(queueWorkbenchSessionRoute, async (c: any) => {
    try {
      const task = await service.queueTask(c.req.param('id'));
      return c.json(task, 200);
    } catch (err: any) {
      return queueRouteError(c, err);
    }
  })
  .openapi(runWorkbenchSessionRoute, async (c: any) => {
    try {
      const run = await service.startWorkbenchTaskRun(c.req.param('id'));
      return c.json(run, 201);
    } catch (err: any) {
      return queueRouteError(c, err);
    }
  })
  .openapi(archiveWorkbenchSessionRoute, async (c: any) => {
    try {
      const task = await service.archiveTask(c.req.param('id'));
      return c.json(task, 200);
    } catch (err: any) {
      return queueRouteError(c, err);
    }
  })
  .openapi(listTaskMessagesRoute, async (c: any) => {
    const id = c.req.param('id');
    try {
      const messages = await service.listTaskMessages(id);
      return c.json(messages, 200);
    } catch (err: any) {
      return queueRouteError(c, err);
    }
  })
  .openapi(getTaskLlmUsageRoute, async (c: any) => {
    const id = c.req.param('id');
    try {
      const summary = await service.getTaskLlmUsageSummary(id);
      return c.json(summary, 200);
    } catch (err: any) {
      return queueRouteError(c, err);
    }
  })
  .openapi(listTaskActivityEventsRoute, async (c: any) => {
    const id = c.req.param('id');
    try {
      const events = await service.listTaskActivityEvents(id, c.req.valid('query'));
      return c.json(events, 200);
    } catch (err: any) {
      return queueRouteError(c, err);
    }
  })
  .openapi(createDesignQuestionnaireRoute, createDesignQuestionnaireHandler)
  .openapi(listDesignQuestionnairesRoute, listDesignQuestionnairesHandler)
  .openapi(getDesignQuestionnaireRoute, getDesignQuestionnaireHandler)
  .openapi(saveDesignQuestionnaireAnswersRoute, saveDesignQuestionnaireAnswersHandler)
  .openapi(generateDesignQuestionnaireFollowUpRoute, generateDesignQuestionnaireFollowUpHandler)
  .openapi(generateDesignQuestionnaireReviewRoute, generateDesignQuestionnaireReviewHandler)
  .openapi(acceptDesignQuestionnaireReviewRoute, acceptDesignQuestionnaireReviewHandler)
  .openapi(
    leaveDesignQuestionnaireReviewUnadoptedRoute,
    leaveDesignQuestionnaireReviewUnadoptedHandler
  )
  .openapi(getBlueprintSpecificationWorkspaceRoute, getBlueprintSpecificationWorkspaceHandler)
  .openapi(getSpecificationWorkspaceRoute, getSpecificationWorkspaceHandler)
  .openapi(generateSpecificationStatusBlueprintRoute, generateSpecificationStatusBlueprintHandler)
  .openapi(generateSpecificationStatusDbDesignRoute, generateSpecificationStatusDbDesignHandler)
  .openapi(
    generateSpecificationStatusDesignDocumentRoute,
    generateSpecificationStatusDesignDocumentHandler
  )
  .openapi(startTaskRunRoute, startTaskRunHandler)
  .openapi(getTaskRunRoute, getTaskRunHandler)
  .openapi(stopTaskRunRoute, stopTaskRunHandler)
  .openapi(listTaskRunEventsRoute, listTaskRunEventsHandler)
  .openapi(listTaskRunActivityEventsRoute, listTaskRunActivityEventsHandler)
  .openapi(createRunReviewRoute, createRunReviewHandler)
  .openapi(listTaskRunsRoute, listTaskRunsHandler)
  .openapi(listReviewRubricsRoute, listReviewRubricsHandler)
  .openapi(createReviewerEvaluationRoute, createReviewerEvaluationHandler)
  .openapi(createReviewerReplayEvaluationRoute, createReviewerReplayEvaluationHandler)
  .openapi(exportTaskRunJsonlRoute, exportTaskRunJsonlHandler);

router.openapi(browseFoldersRoute, async (c) => {
  const queryPath = c.req.query('path');
  const result = await service.browseLocalFolders(queryPath);
  return c.json(result, 200);
});

router.openapi(createFolderRoute, async (c) => {
  const request = c.req.valid('json');
  try {
    const result = await service.createLocalFolder(request);
    return c.json(result, 201);
  } catch (err: any) {
    return queueRouteError(c, err);
  }
});

export const nightworkersRouter = router;
