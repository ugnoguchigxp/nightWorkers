import { ValidationError } from "../../lib/errors";
import { logEvent } from "../../lib/logger";
import { createOpenApiRouter } from "../../lib/openapi";
import {
	readTestQualitySettingsFile,
	writeTestQualitySettingsFile,
} from "../../services/settings/test-quality-settings";
import { getOntologyRunDebugReportRoute } from "../ontology";
import {
	commitRunGitCloseoutHandler,
	createReviewerEvaluationHandler,
	createReviewerReplayEvaluationHandler,
	createReviewPromptSuggestionsHandler,
	createReviewSessionHandler,
	createRunReviewHandler,
	exportTaskRunJsonlHandler,
	getBackgroundProcessHandler,
	getLatestTaskReviewSessionHandler,
	getOntologyRunDebugReportHandler,
	getReviewRecommendationHandler,
	getReviewSessionHandler,
	getRunGitCloseoutHandler,
	getTaskRunHandler,
	listBackgroundProcessesHandler,
	listReviewRubricsHandler,
	listTaskRunActivityEventsHandler,
	listTaskRunEventsHandler,
	listTaskRunsHandler,
	pushRunGitCloseoutHandler,
	startBackgroundProcessHandler,
	startReviewRunHandler,
	startTaskRunHandler,
	startTestModeRunFromArtifactHandler,
	stopBackgroundProcessHandler,
	stopTaskRunHandler,
	updateReviewFindingDispositionHandler,
	updateReviewPromptSuggestionHandler,
	useReviewPromptSuggestionHandler,
} from "./nightworkers.route-handlers";
import { withOpenApiRouteError } from "./nightworkers.route-utils";
import * as service from "./nightworkers.service";
import {
	archiveWorkbenchSessionRoute,
	queueWorkbenchSessionRoute,
	reopenWorkbenchSessionRoute,
	restoreWorkbenchSessionArchiveRoute,
	runWorkbenchSessionRoute,
} from "./routes/queue-routes";
import {
	createRepositoryRoute,
	deleteRepositoryRoute,
	getRepositoryRoute,
	getRepositoryTestQualitySettingsRoute,
	listProjectFilesRoute,
	listRepositoriesRoute,
	readProjectFileRoute,
	readRepositoryDiffRoute,
	saveRepositoryTestQualitySettingsRoute,
	updateRepositoryRoute,
} from "./routes/repository-routes";
import {
	commitRunGitCloseoutRoute,
	createReviewerEvaluationRoute,
	createReviewerReplayEvaluationRoute,
	createReviewPromptSuggestionsRoute,
	createReviewSessionRoute,
	createRunReviewRoute,
	exportTaskRunJsonlRoute,
	getBackgroundProcessRoute,
	getLatestTaskReviewSessionRoute,
	getReviewRecommendationRoute,
	getReviewSessionRoute,
	getRunGitCloseoutRoute,
	getTaskLlmUsageRoute,
	getTaskRunRoute,
	listBackgroundProcessesRoute,
	listReviewRubricsRoute,
	listTaskActivityEventsRoute,
	listTaskMessagesRoute,
	listTaskRunActivityEventsRoute,
	listTaskRunEventsRoute,
	listTaskRunsRoute,
	pushRunGitCloseoutRoute,
	startBackgroundProcessRoute,
	startReviewRunRoute,
	stopBackgroundProcessRoute,
	stopTaskRunRoute,
	updateReviewFindingDispositionRoute,
	updateReviewPromptSuggestionRoute,
	useReviewPromptSuggestionRoute,
} from "./routes/run-routes";
import {
	appendTaskMessageRoute,
	appendWorkbenchMessageRoute,
	createTaskRoute,
	createWorkbenchSessionRoute,
	deleteTaskRoute,
	getTaskRoute,
	listTasksRoute,
	startTaskRunRoute,
	startTestModeRunFromArtifactRoute,
	updateTaskRoute,
} from "./routes/task-routes";
import { browseFoldersRoute, createFolderRoute } from "./routes/util-routes";

const router = createOpenApiRouter()
	.openapi(listRepositoriesRoute, async (c) => {
		const list = await service.listRepositories();
		return c.json(list, 200);
	})
	.openapi(createRepositoryRoute, async (c) => {
		let data = c.req.valid("json");
		if (!data?.name || !data.localPath) {
			try {
				const rawJson = await c.req.json();
				if (rawJson) {
					data = {
						...data,
						name: data?.name || rawJson.name || "",
						localPath:
							data?.localPath || rawJson.localPath || rawJson.local_path || "",
						branch: data?.branch || rawJson.branch || "main",
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
						safetyPolicy:
							data?.safetyPolicy || rawJson.safetyPolicy || undefined,
					};
				}
			} catch (_e) {}
		}
		if (!data?.name || !data.localPath) {
			throw new ValidationError("Name and local path are required");
		}

		const repo = await service.createRepository(data);
		return c.json(repo, 201);
	})
	.openapi(getRepositoryRoute, async (c) => {
		const id = c.req.param("id");
		const repo = await service.getRepository(id);
		if (!repo) return c.json({ error: "Repository not found" }, 404);
		return c.json(repo, 200);
	})
	.openapi(
		updateRepositoryRoute,
		withOpenApiRouteError(updateRepositoryRoute, async (c) => {
			const repo = await service.updateRepository(
				c.req.param("id"),
				c.req.valid("json"),
			);
			return c.json(repo, 200);
		}),
	)
	.openapi(
		listProjectFilesRoute,
		withOpenApiRouteError(listProjectFilesRoute, async (c) => {
			const entries = await service.listProjectFiles(
				c.req.param("id"),
				c.req.query("path"),
			);
			return c.json(entries, 200);
		}),
	)
	.openapi(
		readProjectFileRoute,
		withOpenApiRouteError(readProjectFileRoute, async (c) => {
			const filePath = c.req.query("path");
			if (!filePath) return c.json({ error: "path is required" }, 400);
			const file = await service.readProjectFile(c.req.param("id"), filePath);
			return c.json(file, 200);
		}),
	)
	.openapi(
		readRepositoryDiffRoute,
		withOpenApiRouteError(readRepositoryDiffRoute, async (c) => {
			const diff = await service.readRepositoryDiff(c.req.param("id"));
			return c.json(diff, 200);
		}),
	)
	.openapi(
		getRepositoryTestQualitySettingsRoute,
		withOpenApiRouteError(getRepositoryTestQualitySettingsRoute, async (c) => {
			const repo = await service.getRepository(c.req.param("id"));
			if (!repo) return c.json({ error: "Repository not found" }, 404);
			const settings = readTestQualitySettingsFile(repo.localPath);
			return c.json(settings, 200);
		}),
	)
	.openapi(
		saveRepositoryTestQualitySettingsRoute,
		withOpenApiRouteError(saveRepositoryTestQualitySettingsRoute, async (c) => {
			const repo = await service.getRepository(c.req.param("id"));
			if (!repo) return c.json({ error: "Repository not found" }, 404);
			const settings = writeTestQualitySettingsFile(
				repo.localPath,
				c.req.valid("json"),
			);
			return c.json(settings, 200);
		}),
	)
	.openapi(deleteRepositoryRoute, async (c) => {
		const id = c.req.param("id");
		const repo = await service.deleteRepository(id);
		if (!repo) return c.json({ error: "Repository not found" }, 404);
		return c.json(repo, 200);
	})
	.openapi(listTasksRoute, async (c) => {
		const list = await service.listTasks();
		return c.json(list, 200);
	})
	.openapi(createTaskRoute, async (c) => {
		let data = c.req.valid("json");
		if (!data?.repositoryId || !data.title) {
			try {
				const rawJson = await c.req.json();
				if (rawJson) {
					data = {
						...data,
						repositoryId:
							data?.repositoryId ||
							rawJson.repositoryId ||
							rawJson.repository_id ||
							"",
						title: data?.title || rawJson.title || "",
						description: data?.description || rawJson.description || "",
						objective: data?.objective || rawJson.objective || "",
						acceptanceCriteria:
							data?.acceptanceCriteria ||
							rawJson.acceptanceCriteria ||
							rawJson.acceptance_criteria ||
							"",
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
						createdBy:
							data?.createdBy ||
							rawJson.createdBy ||
							rawJson.created_by ||
							undefined,
						worktreeId:
							data?.worktreeId ||
							rawJson.worktreeId ||
							rawJson.worktree_id ||
							undefined,
					};
				}
			} catch (_e) {}
		}
		if (!data?.repositoryId || !data.title) {
			throw new ValidationError("Repository ID and title are required");
		}

		const task = await service.createTask(data);
		return c.json(task, 201);
	})
	.openapi(getTaskRoute, async (c) => {
		const id = c.req.param("id");
		const task = await service.getTask(id);
		if (!task) return c.json({ error: "Task not found" }, 404);
		return c.json(task, 200);
	})
	.openapi(deleteTaskRoute, async (c) => {
		const id = c.req.param("id");
		const task = await service.deleteTask(id);
		if (!task) return c.json({ error: "Task not found" }, 404);
		return c.json(task, 200);
	})
	.openapi(updateTaskRoute, async (c) => {
		const id = c.req.param("id");
		const data = c.req.valid("json");
		logEvent({
			channel: "api",
			level: "info",
			message: "task update requested",
			meta: {
				taskId: id,
				requestedStatus: data.status,
				hasPriority: data.priority !== undefined,
			},
		});
		const task = await service.updateTask(id, data);
		if (!task) return c.json({ error: "Task not found" }, 404);
		return c.json(task, 200);
	})
	.openapi(
		appendTaskMessageRoute,
		withOpenApiRouteError(appendTaskMessageRoute, async (c) => {
			const id = c.req.param("id");
			const { prompt } = c.req.valid("json");
			const task = await service.appendTaskMessage(id, prompt);
			return c.json(task, 200);
		}),
	)
	.openapi(createWorkbenchSessionRoute, async (c) => {
		const data = c.req.valid("json");
		const task = await service.createWorkbenchSession(data);
		return c.json(task, 201);
	})
	.openapi(
		appendWorkbenchMessageRoute,
		withOpenApiRouteError(appendWorkbenchMessageRoute, async (c) => {
			const id = c.req.param("id");
			const body = c.req.valid("json");
			const result = await service.appendWorkbenchMessage(id, body);
			return c.json(result, 200);
		}),
	)
	.openapi(
		queueWorkbenchSessionRoute,
		withOpenApiRouteError(queueWorkbenchSessionRoute, async (c) => {
			const task = await service.queueTask(c.req.param("id"));
			return c.json(task, 200);
		}),
	)
	.openapi(
		runWorkbenchSessionRoute,
		withOpenApiRouteError(runWorkbenchSessionRoute, async (c) => {
			const run = await service.startWorkbenchTaskRun(c.req.param("id"));
			return c.json(run, 201);
		}),
	)
	.openapi(
		archiveWorkbenchSessionRoute,
		withOpenApiRouteError(archiveWorkbenchSessionRoute, async (c) => {
			const task = await service.archiveTask(c.req.param("id"));
			return c.json(task, 200);
		}),
	)
	.openapi(
		restoreWorkbenchSessionArchiveRoute,
		withOpenApiRouteError(restoreWorkbenchSessionArchiveRoute, async (c) =>
			c.json(await service.restoreTaskArchive(c.req.param("id")), 200),
		),
	)
	.openapi(
		reopenWorkbenchSessionRoute,
		withOpenApiRouteError(reopenWorkbenchSessionRoute, async (c) =>
			c.json(await service.reopenTask(c.req.param("id")), 200),
		),
	)
	.openapi(
		listTaskMessagesRoute,
		withOpenApiRouteError(listTaskMessagesRoute, async (c) => {
			const id = c.req.param("id");
			const messages = await service.listTaskMessages(id);
			return c.json(messages, 200);
		}),
	)
	.openapi(
		getTaskLlmUsageRoute,
		withOpenApiRouteError(getTaskLlmUsageRoute, async (c) => {
			const id = c.req.param("id");
			const summary = await service.getTaskLlmUsageSummary(id);
			return c.json(summary, 200);
		}),
	)
	.openapi(
		listTaskActivityEventsRoute,
		withOpenApiRouteError(listTaskActivityEventsRoute, async (c) => {
			const id = c.req.param("id");
			const events = await service.listTaskActivityEvents(
				id,
				c.req.valid("query"),
			);
			return c.json(events, 200);
		}),
	)
	.openapi(startTaskRunRoute, startTaskRunHandler)
	.openapi(
		startTestModeRunFromArtifactRoute,
		startTestModeRunFromArtifactHandler,
	)
	.openapi(getTaskRunRoute, getTaskRunHandler)
	.openapi(getOntologyRunDebugReportRoute, getOntologyRunDebugReportHandler)
	.openapi(stopTaskRunRoute, stopTaskRunHandler)
	.openapi(getRunGitCloseoutRoute, getRunGitCloseoutHandler)
	.openapi(commitRunGitCloseoutRoute, commitRunGitCloseoutHandler)
	.openapi(pushRunGitCloseoutRoute, pushRunGitCloseoutHandler)
	.openapi(listTaskRunEventsRoute, listTaskRunEventsHandler)
	.openapi(listTaskRunActivityEventsRoute, listTaskRunActivityEventsHandler)
	.openapi(getReviewRecommendationRoute, getReviewRecommendationHandler)
	.openapi(createReviewSessionRoute, createReviewSessionHandler)
	.openapi(getLatestTaskReviewSessionRoute, getLatestTaskReviewSessionHandler)
	.openapi(getReviewSessionRoute, getReviewSessionHandler)
	.openapi(startReviewRunRoute, startReviewRunHandler)
	.openapi(
		updateReviewFindingDispositionRoute,
		updateReviewFindingDispositionHandler,
	)
	.openapi(
		createReviewPromptSuggestionsRoute,
		createReviewPromptSuggestionsHandler,
	)
	.openapi(
		updateReviewPromptSuggestionRoute,
		updateReviewPromptSuggestionHandler,
	)
	.openapi(useReviewPromptSuggestionRoute, useReviewPromptSuggestionHandler)
	.openapi(startBackgroundProcessRoute, startBackgroundProcessHandler)
	.openapi(listBackgroundProcessesRoute, listBackgroundProcessesHandler)
	.openapi(getBackgroundProcessRoute, getBackgroundProcessHandler)
	.openapi(stopBackgroundProcessRoute, stopBackgroundProcessHandler)
	.openapi(createRunReviewRoute, createRunReviewHandler)
	.openapi(listTaskRunsRoute, listTaskRunsHandler)
	.openapi(listReviewRubricsRoute, listReviewRubricsHandler)
	.openapi(createReviewerEvaluationRoute, createReviewerEvaluationHandler)
	.openapi(
		createReviewerReplayEvaluationRoute,
		createReviewerReplayEvaluationHandler,
	)
	.openapi(exportTaskRunJsonlRoute, exportTaskRunJsonlHandler);

router.openapi(browseFoldersRoute, async (c) => {
	const queryPath = c.req.query("path");
	const result = await service.browseLocalFolders(queryPath);
	return c.json(result, 200);
});

router.openapi(
	createFolderRoute,
	withOpenApiRouteError(createFolderRoute, async (c) => {
		const request = c.req.valid("json");
		const result = await service.createLocalFolder(request);
		return c.json(result, 201);
	}),
);

export const nightworkersRouter = router;
