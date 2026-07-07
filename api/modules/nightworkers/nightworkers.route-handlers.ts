import type { RouteConfig, RouteHandler } from "@hono/zod-openapi";
import type { AppEnv } from "../../lib/types";
import { withOpenApiRouteError } from "./nightworkers.route-utils";
import * as service from "./nightworkers.service";
import {
	applyReviewFinalActionRoute,
	commitRunGitCloseoutRoute,
	createReviewerEvaluationRoute,
	createReviewerReplayEvaluationRoute,
	createReviewPromptSuggestionsRoute,
	createReviewSessionRoute,
	createRunReviewRoute,
	type exportTaskRunJsonlRoute,
	type getBackgroundProcessRoute,
	getLatestTaskReviewSessionRoute,
	type getOntologyRunDebugReportRoute,
	getReviewRecommendationRoute,
	getReviewSessionRoute,
	getRunGitCloseoutRoute,
	type getTaskRunRoute,
	listBackgroundProcessesRoute,
	type listReviewRubricsRoute,
	listTaskRunActivityEventsRoute,
	listTaskRunEventsRoute,
	type listTaskRunsRoute,
	pushRunGitCloseoutRoute,
	runReviewSectionRoute,
	startBackgroundProcessRoute,
	stopBackgroundProcessRoute,
	stopTaskRunRoute,
	updateReviewFindingDispositionRoute,
	updateReviewPromptSuggestionRoute,
	useReviewPromptSuggestionRoute,
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
		const id = c.req.param("id");
		const run = await service.startTaskRun(id);
		return c.json(run, 201);
	},
);

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
	const report = await service.getOntologyRunDebugReport(id);
	if (!report) return routeNotFound(c, "Run not found");
	return c.json(report, 200);
};

export const stopTaskRunHandler = withOpenApiRouteError(
	stopTaskRunRoute,
	async (c) => {
		const id = c.req.param("id");
		const run = await service.stopTaskRun(id);
		return c.json(run, 200);
	},
);

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

export const createRunReviewHandler = withOpenApiRouteError(
	createRunReviewRoute,
	async (c) => {
		const id = c.req.param("id");
		const request = c.req.valid("json");
		const result = await service.reviewTaskRun(id, request);
		return c.json(result, 200);
	},
);

export const listTaskRunsHandler: NightWorkersRouteHandler<
	typeof listTaskRunsRoute
> = async (c) => {
	const id = c.req.param("id");
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
		const id = c.req.param("id");
		const request = c.req.valid("json");
		const result = await service.createReviewerEvaluation(id, request);
		return c.json(result, 200);
	},
);

export const getReviewRecommendationHandler = withOpenApiRouteError(
	getReviewRecommendationRoute,
	async (c) => {
		const result = await service.getOrCreateReviewRecommendation(
			c.req.param("id"),
		);
		return c.json(result, 200);
	},
);

export const createReviewSessionHandler = withOpenApiRouteError(
	createReviewSessionRoute,
	async (c) => {
		const result = await service.startReviewSessionForRun(c.req.param("id"));
		return c.json(result, 201);
	},
);

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

export const runReviewSectionHandler = withOpenApiRouteError(
	runReviewSectionRoute,
	async (c) => {
		const result = await service.runReviewSection(
			c.req.param("id"),
			c.req.param("section") as Parameters<typeof service.runReviewSection>[1],
		);
		return c.json(result, 200);
	},
);

export const updateReviewFindingDispositionHandler = withOpenApiRouteError(
	updateReviewFindingDispositionRoute,
	async (c) => {
		const result = await service.setReviewFindingDisposition(
			c.req.param("id"),
			c.req.param("findingId"),
			c.req.valid("json"),
		);
		return c.json(result, 200);
	},
);

export const createReviewPromptSuggestionsHandler = withOpenApiRouteError(
	createReviewPromptSuggestionsRoute,
	async (c) => {
		const result = await service.createReviewPromptSuggestions(
			c.req.param("id"),
		);
		return c.json(result, 200);
	},
);

export const updateReviewPromptSuggestionHandler = withOpenApiRouteError(
	updateReviewPromptSuggestionRoute,
	async (c) => {
		const result = await service.updateReviewPromptSuggestion(
			c.req.param("id"),
			c.req.param("suggestionId"),
			c.req.valid("json"),
		);
		return c.json(result, 200);
	},
);

export const useReviewPromptSuggestionHandler = withOpenApiRouteError(
	useReviewPromptSuggestionRoute,
	async (c) => {
		const result = await service.useReviewPromptSuggestion(
			c.req.param("id"),
			c.req.param("suggestionId"),
			c.req.valid("json") ?? {},
		);
		return c.json(result, 200);
	},
);

export const applyReviewFinalActionHandler = withOpenApiRouteError(
	applyReviewFinalActionRoute,
	async (c) => {
		const result = await service.applyReviewFinalAction(
			c.req.param("id"),
			c.req.valid("json"),
		);
		return c.json(result, 200);
	},
);

export const createReviewerReplayEvaluationHandler = withOpenApiRouteError(
	createReviewerReplayEvaluationRoute,
	async (c) => {
		const id = c.req.param("id");
		const request = c.req.valid("json");
		const result = await service.createReviewerReplayEvaluation(id, request);
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
