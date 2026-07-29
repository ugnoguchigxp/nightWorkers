import { ValidationError } from "../../lib/errors";
import { logEvent } from "../../lib/logger";
import { createOpenApiRouter } from "../../lib/openapi";
import { getOntologyRunDebugReportRoute } from "../ontology";
import {
	executeTaskOperatorCommand,
	humanTaskOperatorCommandContext,
	humanTaskOperatorQueryContext,
	readTaskOperatorProjection,
} from "../taskOperator";
import {
	commitRunGitCloseoutHandler,
	deferRunGitMergeHandler,
	executeRunGitMergeHandler,
	exportTaskRunJsonlHandler,
	getBackgroundProcessHandler,
	getLatestTaskReviewSessionHandler,
	getOntologyRunDebugReportHandler,
	getReviewSessionHandler,
	getRunGitCloseoutHandler,
	getTaskRunHandler,
	listBackgroundProcessesHandler,
	listTaskRunActivityEventsHandler,
	listTaskRunEventsHandler,
	listTaskRunsHandler,
	overrideRunGitMergeTargetHandler,
	previewRunGitMergeHandler,
	pushRunGitCloseoutHandler,
	resumeTaskRunTodoHandler,
	reworkRunGitMergeHandler,
	startBackgroundProcessHandler,
	startTaskRunHandler,
	stopBackgroundProcessHandler,
	stopTaskRunHandler,
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
	listProjectFilesRoute,
	listRepositoriesRoute,
	readProjectFileRoute,
	readRepositoryDiffRoute,
	updateRepositoryRoute,
} from "./routes/repository-routes";
import {
	commitRunGitCloseoutRoute,
	deferRunGitMergeRoute,
	executeRunGitMergeRoute,
	exportTaskRunJsonlRoute,
	getBackgroundProcessRoute,
	getLatestTaskReviewSessionRoute,
	getReviewSessionRoute,
	getRunGitCloseoutRoute,
	getTaskLlmUsageRoute,
	getTaskRunRoute,
	listBackgroundProcessesRoute,
	listTaskActivityEventsRoute,
	listTaskMessagesRoute,
	listTaskRunActivityEventsRoute,
	listTaskRunEventsRoute,
	listTaskRunsRoute,
	overrideRunGitMergeTargetRoute,
	previewRunGitMergeRoute,
	pushRunGitCloseoutRoute,
	resumeTaskRunTodoRoute,
	reworkRunGitMergeRoute,
	startBackgroundProcessRoute,
	stopBackgroundProcessRoute,
	stopTaskRunRoute,
	submitRunReviewRoute,
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
						branch: data?.branch || rawJson.branch || undefined,
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
				c.req.query("runId"),
			);
			return c.json(entries, 200);
		}),
	)
	.openapi(
		readProjectFileRoute,
		withOpenApiRouteError(readProjectFileRoute, async (c) => {
			const filePath = c.req.query("path");
			if (!filePath) return c.json({ error: "path is required" }, 400);
			const file = await service.readProjectFile(
				c.req.param("id"),
				filePath,
				c.req.query("runId"),
			);
			return c.json(file, 200);
		}),
	)
	.openapi(
		readRepositoryDiffRoute,
		withOpenApiRouteError(readRepositoryDiffRoute, async (c) => {
			const diff = await service.readRepositoryDiff(
				c.req.param("id"),
				c.req.query("runId"),
			);
			return c.json(diff, 200);
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
		const projection = await readTaskOperatorProjection(
			id,
			humanTaskOperatorQueryContext(),
		);
		const task = await executeTaskOperatorCommand({
			taskId: id,
			actionId: "task.update",
			expectedTaskRevision: projection.task.revision,
			arguments: { fields: data },
			context: humanTaskOperatorCommandContext({
				idempotencyKey: c.req.header("Idempotency-Key"),
			}),
		});
		if (!task.data) return c.json({ error: "Task not found" }, 404);
		return c.json(task.data, 200);
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
		submitRunReviewRoute,
		withOpenApiRouteError(submitRunReviewRoute, async (c) => {
			const run = await service.getTaskRun(c.req.param("id"));
			if (!run) return c.json({ error: "Run not found" }, 404);
			const projection = await readTaskOperatorProjection(
				run.taskId,
				humanTaskOperatorQueryContext(),
			);
			const input = c.req.valid("json");
			const reviewed = await executeTaskOperatorCommand({
				taskId: run.taskId,
				actionId: "run.review.submit",
				expectedTaskRevision: projection.task.revision,
				arguments: {
					runId: run.id,
					action: input.action,
					...(input.note ? { note: input.note } : {}),
				},
				context: humanTaskOperatorCommandContext({
					idempotencyKey: c.req.header("Idempotency-Key"),
				}),
			});
			return c.json(reviewed.data, 200);
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
			const taskId = c.req.param("id");
			const discardPendingCloseouts =
				c.req.valid("query").discardPendingCloseouts === "true";
			const projection = await readTaskOperatorProjection(
				taskId,
				humanTaskOperatorQueryContext(),
			);
			const task = await executeTaskOperatorCommand({
				taskId,
				actionId: "task.archive",
				expectedTaskRevision: projection.task.revision,
				arguments: { discardPendingCloseouts },
				context: humanTaskOperatorCommandContext({
					idempotencyKey: c.req.header("Idempotency-Key"),
				}),
			});
			return c.json(task.data, 200);
		}),
	)
	.openapi(
		restoreWorkbenchSessionArchiveRoute,
		withOpenApiRouteError(restoreWorkbenchSessionArchiveRoute, async (c) => {
			const taskId = c.req.param("id");
			const projection = await readTaskOperatorProjection(
				taskId,
				humanTaskOperatorQueryContext(),
			);
			const restored = await executeTaskOperatorCommand({
				taskId,
				actionId: "task.archive.restore",
				expectedTaskRevision: projection.task.revision,
				arguments: {},
				context: humanTaskOperatorCommandContext({
					idempotencyKey: c.req.header("Idempotency-Key"),
				}),
			});
			return c.json(restored.data, 200);
		}),
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
			const messages = await service.listTaskMessages(id, c.req.valid("query"));
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
	.openapi(getTaskRunRoute, getTaskRunHandler)
	.openapi(getOntologyRunDebugReportRoute, getOntologyRunDebugReportHandler)
	.openapi(stopTaskRunRoute, stopTaskRunHandler)
	.openapi(resumeTaskRunTodoRoute, resumeTaskRunTodoHandler)
	.openapi(getRunGitCloseoutRoute, getRunGitCloseoutHandler)
	.openapi(commitRunGitCloseoutRoute, commitRunGitCloseoutHandler)
	.openapi(pushRunGitCloseoutRoute, pushRunGitCloseoutHandler)
	.openapi(previewRunGitMergeRoute, previewRunGitMergeHandler)
	.openapi(deferRunGitMergeRoute, deferRunGitMergeHandler)
	.openapi(reworkRunGitMergeRoute, reworkRunGitMergeHandler)
	.openapi(overrideRunGitMergeTargetRoute, overrideRunGitMergeTargetHandler)
	.openapi(executeRunGitMergeRoute, executeRunGitMergeHandler)
	.openapi(listTaskRunEventsRoute, listTaskRunEventsHandler)
	.openapi(listTaskRunActivityEventsRoute, listTaskRunActivityEventsHandler)
	.openapi(getLatestTaskReviewSessionRoute, getLatestTaskReviewSessionHandler)
	.openapi(getReviewSessionRoute, getReviewSessionHandler)
	.openapi(startBackgroundProcessRoute, startBackgroundProcessHandler)
	.openapi(listBackgroundProcessesRoute, listBackgroundProcessesHandler)
	.openapi(getBackgroundProcessRoute, getBackgroundProcessHandler)
	.openapi(stopBackgroundProcessRoute, stopBackgroundProcessHandler)
	.openapi(listTaskRunsRoute, listTaskRunsHandler)
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
