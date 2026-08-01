import type { RouteConfig, RouteHandler } from "@hono/zod-openapi";
import { NotFoundError } from "../../lib/errors";
import type { AppEnv } from "../../lib/types";
import { executeCodingAgentCommand } from "../codingAgent";
import {
	getOntologyRunDebugReport,
	type getOntologyRunDebugReportRoute,
} from "../ontology";
import {
	humanTaskOperatorPrincipal,
	humanTaskOperatorQueryContext,
	readTaskOperatorProjection,
} from "../taskOperator";
import { withOpenApiRouteError } from "./nightworkers.route-utils";
import * as service from "./nightworkers.service";
import {
	commitRunGitCloseoutRoute,
	deferRunGitMergeRoute,
	executeRunGitMergeRoute,
	type exportTaskRunJsonlRoute,
	type getBackgroundProcessRoute,
	getLatestTaskReviewSessionRoute,
	getReviewSessionRoute,
	getRunGitCloseoutRoute,
	type getTaskRunRoute,
	listBackgroundProcessesRoute,
	listTaskRunActivityEventsRoute,
	listTaskRunEventsRoute,
	type listTaskRunsRoute,
	overrideRunGitMergeTargetRoute,
	previewRunGitMergeRoute,
	pushRunGitCloseoutRoute,
	resumeTaskRunTodoRoute,
	reworkRunGitMergeRoute,
	startBackgroundProcessRoute,
	stopBackgroundProcessRoute,
	stopTaskRunRoute,
} from "./routes/run-routes";
import { startTaskRunRoute } from "./routes/task-routes";

type NightWorkersRouteHandler<Route extends RouteConfig> = RouteHandler<
	Route,
	AppEnv
>;
type NightWorkersRouteContext<Route extends RouteConfig> = Parameters<
	NightWorkersRouteHandler<Route>
>[0];

function routeNotFound<Route extends RouteConfig>(
	c: NightWorkersRouteContext<Route>,
	message: string,
): never {
	return c.json({ error: message }, 404) as never;
}

export const startTaskRunHandler = withOpenApiRouteError(
	startTaskRunRoute,
	async (c) => {
		return c.json(
			await startHumanTaskImplementation(
				c.req.param("id"),
				c.req.header("Idempotency-Key"),
			),
			201,
		);
	},
);

export async function startHumanTaskImplementation(
	taskId: string,
	idempotencyKey?: string,
) {
	const projection = await readTaskOperatorProjection(
		taskId,
		humanTaskOperatorQueryContext(),
	);
	const envelope = compatibilityCommandEnvelope(idempotencyKey);
	const result = await executeCodingAgentCommand(
		{
			...envelope,
			taskId,
			actionId: "run.implementation.start",
			expectedTaskRevision: projection.task.revision,
			arguments: {},
		},
		humanTaskOperatorPrincipal(),
	);
	const run = await service.getTaskRun(result.data.runId);
	if (!run) throw new NotFoundError("Run not found after start");
	return run;
}

export const getTaskRunHandler: NightWorkersRouteHandler<
	typeof getTaskRunRoute
> = async (c) => {
	const id = c.req.param("id");
	const run = await service.getTaskRun(id);
	if (!run) return routeNotFound(c, "Run not found");
	return c.json(run, 200);
};

export const getOntologyRunDebugReportHandler: NightWorkersRouteHandler<
	typeof getOntologyRunDebugReportRoute
> = async (c) => {
	const id = c.req.param("id");
	const report = await getOntologyRunDebugReport(id);
	if (!report) return routeNotFound(c, "Run not found");
	return c.json(report, 200);
};

export const stopTaskRunHandler = withOpenApiRouteError(
	stopTaskRunRoute,
	async (c) => {
		const id = c.req.param("id");
		const currentRun = await service.getTaskRun(id);
		if (!currentRun) return routeNotFound(c, "Run not found");
		const projection = await readTaskOperatorProjection(
			currentRun.taskId,
			humanTaskOperatorQueryContext(),
		);
		const result = await executeCodingAgentCommand(
			{
				...compatibilityCommandEnvelope(c.req.header("Idempotency-Key")),
				taskId: currentRun.taskId,
				actionId: "run.stop",
				expectedTaskRevision: projection.task.revision,
				arguments: { runId: id },
			},
			humanTaskOperatorPrincipal(),
		);
		const run = await service.getTaskRun(result.data.runId);
		if (!run) return routeNotFound(c, "Run not found after stop");
		return c.json(run, 200);
	},
);

export const resumeTaskRunTodoHandler = withOpenApiRouteError(
	resumeTaskRunTodoRoute,
	async (c) => {
		const input = c.req.valid("json");
		const currentRun = await service.getTaskRun(c.req.param("id"));
		if (!currentRun) return routeNotFound(c, "Run not found");
		const projection = await readTaskOperatorProjection(
			currentRun.taskId,
			humanTaskOperatorQueryContext(),
		);
		const result = await executeCodingAgentCommand(
			{
				...compatibilityCommandEnvelope(c.req.header("Idempotency-Key")),
				taskId: currentRun.taskId,
				actionId: "run.todo.resume",
				expectedTaskRevision: projection.task.revision,
				arguments: {
					runId: c.req.param("id"),
					todoId: c.req.param("todoId"),
					expectedTodoRevision: input.expectedTodoRevision,
					userContext: input.userContext,
				},
			},
			humanTaskOperatorPrincipal(),
		);
		const run = await service.getTaskRun(result.data.runId);
		if (!run) return routeNotFound(c, "Run not found after resume");
		return c.json(run, 200);
	},
);

function compatibilityCommandEnvelope(idempotencyKey?: string) {
	const requestId = crypto.randomUUID();
	return {
		version: 1 as const,
		type: "coding_agent.command.execute" as const,
		requestId,
		idempotencyKey: idempotencyKey || requestId,
	};
}

export const getRunGitCloseoutHandler = withOpenApiRouteError(
	getRunGitCloseoutRoute,
	async (c) => {
		const result = await service.getRunGitCloseout(c.req.param("id"));
		return c.json(result, 200);
	},
);

export const commitRunGitCloseoutHandler = withOpenApiRouteError(
	commitRunGitCloseoutRoute,
	async (c) => {
		const result = await service.commitRunGitCloseout(
			c.req.param("id"),
			c.req.valid("json") ?? {},
		);
		return c.json(result, 200);
	},
);

export const pushRunGitCloseoutHandler = withOpenApiRouteError(
	pushRunGitCloseoutRoute,
	async (c) => {
		const result = await service.pushRunGitCloseout(c.req.param("id"));
		return c.json(result, 200);
	},
);

export const previewRunGitMergeHandler = withOpenApiRouteError(
	previewRunGitMergeRoute,
	async (c) =>
		c.json(
			await service.previewTaskRunMerge({
				runId: c.req.param("id"),
				expectedVersion: c.req.valid("json").expectedVersion,
			}),
			200,
		),
);
export const deferRunGitMergeHandler = withOpenApiRouteError(
	deferRunGitMergeRoute,
	async (c) =>
		c.json(
			await service.deferTaskRunMerge({
				runId: c.req.param("id"),
				expectedVersion: c.req.valid("json").expectedVersion,
			}),
			200,
		),
);
export const reworkRunGitMergeHandler = withOpenApiRouteError(
	reworkRunGitMergeRoute,
	async (c) =>
		c.json(
			await service.requestTaskRunRework({
				runId: c.req.param("id"),
				expectedVersion: c.req.valid("json").expectedVersion,
			}),
			200,
		),
);
export const overrideRunGitMergeTargetHandler = withOpenApiRouteError(
	overrideRunGitMergeTargetRoute,
	async (c) => {
		const input = c.req.valid("json");
		return c.json(
			await service.overrideTaskRunMergeTarget({
				runId: c.req.param("id"),
				targetBranch: input.targetBranch,
				expectedVersion: input.expectedVersion,
			}),
			200,
		);
	},
);
export const executeRunGitMergeHandler = withOpenApiRouteError(
	executeRunGitMergeRoute,
	async (c) =>
		c.json(
			await service.executeTaskRunMerge({
				runId: c.req.param("id"),
				expectedVersion: c.req.valid("json").expectedVersion,
			}),
			200,
		),
);

export const listTaskRunEventsHandler = withOpenApiRouteError(
	listTaskRunEventsRoute,
	async (c) => {
		const id = c.req.param("id");
		const events = await service.listTaskRunEvents(id, c.req.valid("query"));
		return c.json(events, 200);
	},
);

export const listTaskRunActivityEventsHandler = withOpenApiRouteError(
	listTaskRunActivityEventsRoute,
	async (c) => {
		const id = c.req.param("id");
		const events = await service.listTaskRunActivityEvents(
			id,
			c.req.valid("query"),
		);
		return c.json(events, 200);
	},
);

export const startBackgroundProcessHandler = withOpenApiRouteError(
	startBackgroundProcessRoute,
	async (c) => {
		const request = c.req.valid("json");
		const processRecord = await service.startTaskBackgroundProcess(request);
		return c.json(processRecord, 201);
	},
);

export const listBackgroundProcessesHandler = withOpenApiRouteError(
	listBackgroundProcessesRoute,
	async (c) => {
		const processes = await service.listTaskBackgroundProcesses(
			c.req.valid("query"),
		);
		return c.json(processes, 200);
	},
);

export const getBackgroundProcessHandler: NightWorkersRouteHandler<
	typeof getBackgroundProcessRoute
> = async (c) => {
	const processRecord = await service.getTaskBackgroundProcess(
		c.req.param("id"),
	);
	if (!processRecord) return routeNotFound(c, "Background process not found");
	return c.json(processRecord, 200);
};

export const stopBackgroundProcessHandler = withOpenApiRouteError(
	stopBackgroundProcessRoute,
	async (c) => {
		const processRecord = await service.stopTaskBackgroundProcess(
			c.req.param("id"),
		);
		return c.json(processRecord, 200);
	},
);

export const listTaskRunsHandler: NightWorkersRouteHandler<
	typeof listTaskRunsRoute
> = async (c) => {
	const id = c.req.param("id");
	const runs = await service.getTaskRunsForTask(id);
	return c.json(runs, 200);
};

export const getLatestTaskReviewSessionHandler = withOpenApiRouteError(
	getLatestTaskReviewSessionRoute,
	async (c) => {
		const result = await service.getLatestReviewSessionDetailForTask(
			c.req.param("id"),
		);
		return c.json(result, 200);
	},
);

export const getReviewSessionHandler = withOpenApiRouteError(
	getReviewSessionRoute,
	async (c) => {
		const result = await service.getReviewSessionDetail(c.req.param("id"));
		return c.json(result, 200);
	},
);

export const exportTaskRunJsonlHandler: NightWorkersRouteHandler<
	typeof exportTaskRunJsonlRoute
> = async (c) => {
	const id = c.req.param("id");
	const jsonl = await service.exportTaskRunJsonl(id);
	if (!jsonl) return routeNotFound(c, "Run not found");
	c.header("Content-Type", "application/x-ndjson; charset=utf-8");
	c.header(
		"Content-Disposition",
		`attachment; filename="nightworkers-run-${id}.jsonl"`,
	);
	return c.body(jsonl, 200);
};
