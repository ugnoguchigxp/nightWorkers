import { AppError, ValidationError } from '../../lib/errors';
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
  getBackgroundProcessHandler,
  getBlueprintSpecificationWorkspaceHandler,
  getDesignQuestionnaireHandler,
  getSpecificationWorkspaceHandler,
  getTaskRunHandler,
  leaveDesignQuestionnaireReviewUnadoptedHandler,
  listBackgroundProcessesHandler,
  listDesignQuestionnairesHandler,
  listReviewRubricsHandler,
  listTaskRunActivityEventsHandler,
  listTaskRunEventsHandler,
  listTaskRunsHandler,
  saveDesignQuestionnaireAnswersHandler,
  startBackgroundProcessHandler,
  startTaskRunHandler,
  stopBackgroundProcessHandler,
  stopTaskRunHandler,
} from './nightworkers.route-handlers';
import { routeErrorResponse, withOpenApiRouteError } from './nightworkers.route-utils';
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
  getBackgroundProcessRoute,
  getOverviewDashboardRoute,
  getTaskLlmUsageRoute,
  getTaskRunRoute,
  listBackgroundProcessesRoute,
  listReviewRubricsRoute,
  listTaskActivityEventsRoute,
  listTaskMessagesRoute,
  listTaskRunActivityEventsRoute,
  listTaskRunEventsRoute,
  listTaskRunsRoute,
  startBackgroundProcessRoute,
  stopBackgroundProcessRoute,
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
  .openapi(getOverviewDashboardRoute, async (c) => {
    try {
      const dashboard = await service.getOverviewDashboard(c.req.valid('query'));
      return c.json(dashboard, 200);
    } catch (err) {
      if (err instanceof AppError && err.statusCode === 404) {
        return c.json({ error: 'Repository not found' }, 404);
      }
      return routeErrorResponse(c, err);
    }
  })
  .openapi(listRepositoriesRoute, async (c) => {
    const list = await service.listRepositories();
    return c.json(list, 200);
  })
  .openapi(createRepositoryRoute, async (c) => {
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
  .openapi(getRepositoryRoute, async (c) => {
    const id = c.req.param('id');
    const repo = await service.getRepository(id);
    if (!repo) return c.json({ error: 'Repository not found' }, 404);
    return c.json(repo, 200);
  })
  .openapi(
    updateRepositoryRoute,
    withOpenApiRouteError(updateRepositoryRoute, async (c) => {
      const repo = await service.updateRepository(c.req.param('id'), c.req.valid('json'));
      return c.json(repo, 200);
    })
  )
  .openapi(
    listProjectFilesRoute,
    withOpenApiRouteError(listProjectFilesRoute, async (c) => {
      const entries = await service.listProjectFiles(c.req.param('id'), c.req.query('path'));
      return c.json(entries, 200);
    })
  )
  .openapi(
    readProjectFileRoute,
    withOpenApiRouteError(readProjectFileRoute, async (c) => {
      const filePath = c.req.query('path');
      if (!filePath) return c.json({ error: 'path is required' }, 400);
      const file = await service.readProjectFile(c.req.param('id'), filePath);
      return c.json(file, 200);
    })
  )
  .openapi(deleteRepositoryRoute, async (c) => {
    const id = c.req.param('id');
    const repo = await service.deleteRepository(id);
    if (!repo) return c.json({ error: 'Repository not found' }, 404);
    return c.json(repo, 200);
  })
  .openapi(listTasksRoute, async (c) => {
    const list = await service.listTasks();
    return c.json(list, 200);
  })
  .openapi(createTaskRoute, async (c) => {
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
  .openapi(
    getBlueprintDesignSettingsRoute,
    withOpenApiRouteError(getBlueprintDesignSettingsRoute, async (c) => {
      const settings = await service.getBlueprintDesignSettings(c.req.param('id'));
      return c.json(settings, 200);
    })
  )
  .openapi(
    saveBlueprintDesignSettingsRoute,
    withOpenApiRouteError(saveBlueprintDesignSettingsRoute, async (c) => {
      const settings = await service.saveBlueprintDesignSettings(
        c.req.param('id'),
        c.req.valid('json')
      );
      return c.json(settings, 200);
    })
  )
  .openapi(
    getBlueprintArtifactAdoptionRoute,
    withOpenApiRouteError(getBlueprintArtifactAdoptionRoute, async (c) => {
      const adoption = await service.getBlueprintArtifactAdoption(
        c.req.param('id'),
        c.req.valid('query').messageId
      );
      return c.json(adoption, 200);
    })
  )
  .openapi(
    saveBlueprintArtifactAdoptionRoute,
    withOpenApiRouteError(saveBlueprintArtifactAdoptionRoute, async (c) => {
      const body = c.req.valid('json');
      const adoption = await service.saveBlueprintArtifactAdoption(
        c.req.param('id'),
        body.messageId,
        body.adopted
      );
      return c.json(adoption, 200);
    })
  )
  .openapi(
    getBlueprintDbDesignAdoptionRoute,
    withOpenApiRouteError(getBlueprintDbDesignAdoptionRoute, async (c) => {
      const adoption = await service.getBlueprintDbDesignAdoption(
        c.req.param('id'),
        c.req.valid('query').messageId
      );
      return c.json(adoption, 200);
    })
  )
  .openapi(
    saveBlueprintDbDesignAdoptionRoute,
    withOpenApiRouteError(saveBlueprintDbDesignAdoptionRoute, async (c) => {
      const body = c.req.valid('json');
      const adoption = await service.saveBlueprintDbDesignAdoption(
        c.req.param('id'),
        body.messageId,
        body.adopted
      );
      return c.json(adoption, 200);
    })
  )
  .openapi(
    getBlueprintDesignTokenAdoptionRoute,
    withOpenApiRouteError(getBlueprintDesignTokenAdoptionRoute, async (c) => {
      const adoption = await service.getBlueprintDesignTokenAdoption(
        c.req.param('id'),
        c.req.valid('query').messageId
      );
      return c.json(adoption, 200);
    })
  )
  .openapi(
    saveBlueprintDesignTokenAdoptionRoute,
    withOpenApiRouteError(saveBlueprintDesignTokenAdoptionRoute, async (c) => {
      const body = c.req.valid('json');
      const adoption = await service.saveBlueprintDesignTokenAdoption(
        c.req.param('id'),
        body.messageId,
        body.adopted
      );
      return c.json(adoption, 200);
    })
  )
  .openapi(
    appendTaskMessageRoute,
    withOpenApiRouteError(appendTaskMessageRoute, async (c) => {
      const id = c.req.param('id');
      const { prompt } = c.req.valid('json');
      const task = await service.appendTaskMessage(id, prompt);
      return c.json(task, 200);
    })
  )
  .openapi(createWorkbenchSessionRoute, async (c) => {
    const data = c.req.valid('json');
    const task = await service.createWorkbenchSession(data);
    return c.json(task, 201);
  })
  .openapi(
    appendWorkbenchMessageRoute,
    withOpenApiRouteError(appendWorkbenchMessageRoute, async (c) => {
      const id = c.req.param('id');
      const body = c.req.valid('json');
      const result = await service.appendWorkbenchMessage(id, body);
      return c.json(result, 200);
    })
  )

  .openapi(
    implementationQueueDashboardRoute,
    withOpenApiRouteError(implementationQueueDashboardRoute, async (c) => {
      const result = await service.listImplementationQueueDashboard();
      return c.json(result, 200);
    })
  )
  .openapi(
    createImplementationQueueEntryRoute,
    withOpenApiRouteError(createImplementationQueueEntryRoute, async (c) => {
      const body = c.req.valid('json');
      const entry = await service.createImplementationQueueEntry(body.taskId);
      return c.json(entry, 201);
    })
  )
  .openapi(
    patchImplementationQueueEntryRoute,
    withOpenApiRouteError(patchImplementationQueueEntryRoute, async (c) => {
      const body = c.req.valid('json');
      const entry = await service.patchImplementationQueueEntry(c.req.param('id'), body);
      return c.json(entry, 200);
    })
  )
  .openapi(
    archiveImplementationQueueEntryRoute,
    withOpenApiRouteError(archiveImplementationQueueEntryRoute, async (c) => {
      const entry = await service.archiveImplementationQueueEntry(c.req.param('id'));
      return c.json(entry, 200);
    })
  )
  .openapi(
    requeueImplementationQueueEntryRoute,
    withOpenApiRouteError(requeueImplementationQueueEntryRoute, async (c) => {
      const entry = await service.requeueImplementationQueueEntry(
        c.req.param('id'),
        c.req.valid('json')
      );
      return c.json(entry, 201);
    })
  )
  .openapi(
    drainImplementationQueueRoute,
    withOpenApiRouteError(drainImplementationQueueRoute, async (c) => {
      const started = await service.runImplementationQueue();
      return c.json({ started: started.length }, 200);
    })
  )
  .openapi(
    getImplementationQueueSettingsRoute,
    withOpenApiRouteError(getImplementationQueueSettingsRoute, async (c) => {
      const result = await service.listImplementationQueueDashboard();
      return c.json(result.settings, 200);
    })
  )
  .openapi(
    patchImplementationQueueSettingsRoute,
    withOpenApiRouteError(patchImplementationQueueSettingsRoute, async (c) => {
      const body = c.req.valid('json');
      const settings = await service.updateImplementationQueueSettings(body);
      return c.json(settings, 200);
    })
  )
  .openapi(
    getTodoWorkflowSettingsRoute,
    withOpenApiRouteError(getTodoWorkflowSettingsRoute, async (c) => {
      const settings = await service.getTodoWorkflowSettings();
      return c.json(settings, 200);
    })
  )
  .openapi(
    patchTodoWorkflowSettingsRoute,
    withOpenApiRouteError(patchTodoWorkflowSettingsRoute, async (c) => {
      const body = c.req.valid('json');
      const settings = await service.updateTodoWorkflowSettings(body);
      return c.json(settings, 200);
    })
  )
  .openapi(
    queueWorkbenchSessionRoute,
    withOpenApiRouteError(queueWorkbenchSessionRoute, async (c) => {
      const task = await service.queueTask(c.req.param('id'));
      return c.json(task, 200);
    })
  )
  .openapi(
    runWorkbenchSessionRoute,
    withOpenApiRouteError(runWorkbenchSessionRoute, async (c) => {
      const run = await service.startWorkbenchTaskRun(c.req.param('id'));
      return c.json(run, 201);
    })
  )
  .openapi(
    archiveWorkbenchSessionRoute,
    withOpenApiRouteError(archiveWorkbenchSessionRoute, async (c) => {
      const task = await service.archiveTask(c.req.param('id'));
      return c.json(task, 200);
    })
  )
  .openapi(
    listTaskMessagesRoute,
    withOpenApiRouteError(listTaskMessagesRoute, async (c) => {
      const id = c.req.param('id');
      const messages = await service.listTaskMessages(id);
      return c.json(messages, 200);
    })
  )
  .openapi(
    getTaskLlmUsageRoute,
    withOpenApiRouteError(getTaskLlmUsageRoute, async (c) => {
      const id = c.req.param('id');
      const summary = await service.getTaskLlmUsageSummary(id);
      return c.json(summary, 200);
    })
  )
  .openapi(
    listTaskActivityEventsRoute,
    withOpenApiRouteError(listTaskActivityEventsRoute, async (c) => {
      const id = c.req.param('id');
      const events = await service.listTaskActivityEvents(id, c.req.valid('query'));
      return c.json(events, 200);
    })
  )
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
  .openapi(startBackgroundProcessRoute, startBackgroundProcessHandler)
  .openapi(listBackgroundProcessesRoute, listBackgroundProcessesHandler)
  .openapi(getBackgroundProcessRoute, getBackgroundProcessHandler)
  .openapi(stopBackgroundProcessRoute, stopBackgroundProcessHandler)
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

router.openapi(
  createFolderRoute,
  withOpenApiRouteError(createFolderRoute, async (c) => {
    const request = c.req.valid('json');
    const result = await service.createLocalFolder(request);
    return c.json(result, 201);
  })
);

export const nightworkersRouter = router;
