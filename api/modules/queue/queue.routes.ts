import { createOpenApiRouter } from "../../lib/openapi";
import { withOpenApiRouteError } from "../nightworkers/nightworkers.route-utils";
import { runImplementationQueue } from "../nightworkers/nightworkers.run-orchestration.service";
import {
	archiveImplementationQueueEntry,
	createImplementationQueueEntry,
	getTodoWorkflowSettings,
	listImplementationQueueDashboard,
	listImplementationQueueHealth,
	patchImplementationQueueEntry,
	recoverImplementationQueueEntry,
	requeueImplementationQueueEntry,
	updateImplementationQueueSettings,
	updateTodoWorkflowSettings,
} from "./queue-management.service";
import {
	archiveImplementationQueueEntryRoute,
	createImplementationQueueEntryRoute,
	drainImplementationQueueRoute,
	getImplementationQueueSettingsRoute,
	getTodoWorkflowSettingsRoute,
	implementationQueueDashboardRoute,
	implementationQueueHealthRoute,
	patchImplementationQueueEntryRoute,
	patchImplementationQueueSettingsRoute,
	patchTodoWorkflowSettingsRoute,
	recoverImplementationQueueEntryRoute,
	requeueImplementationQueueEntryRoute,
} from "./queue-route-definitions";

export const queueRouter = createOpenApiRouter()
	.openapi(
		implementationQueueDashboardRoute,
		withOpenApiRouteError(implementationQueueDashboardRoute, async (c) => {
			const result = await listImplementationQueueDashboard();
			return c.json(result, 200);
		}),
	)
	.openapi(
		createImplementationQueueEntryRoute,
		withOpenApiRouteError(createImplementationQueueEntryRoute, async (c) => {
			const body = c.req.valid("json");
			const entry = await createImplementationQueueEntry(body.taskId, {
				approveMissionProposal: body.approveMissionProposal,
			});
			return c.json(entry, 201);
		}),
	)
	.openapi(
		implementationQueueHealthRoute,
		withOpenApiRouteError(implementationQueueHealthRoute, async (c) => {
			const result = await listImplementationQueueHealth();
			return c.json(result, 200);
		}),
	)
	.openapi(
		patchImplementationQueueEntryRoute,
		withOpenApiRouteError(patchImplementationQueueEntryRoute, async (c) => {
			const body = c.req.valid("json");
			const entry = await patchImplementationQueueEntry(
				c.req.param("id"),
				body,
			);
			return c.json(entry, 200);
		}),
	)
	.openapi(
		archiveImplementationQueueEntryRoute,
		withOpenApiRouteError(archiveImplementationQueueEntryRoute, async (c) => {
			const entry = await archiveImplementationQueueEntry(c.req.param("id"));
			return c.json(entry, 200);
		}),
	)
	.openapi(
		requeueImplementationQueueEntryRoute,
		withOpenApiRouteError(requeueImplementationQueueEntryRoute, async (c) => {
			const entry = await requeueImplementationQueueEntry(
				c.req.param("id"),
				c.req.valid("json"),
			);
			return c.json(entry, 201);
		}),
	)
	.openapi(
		recoverImplementationQueueEntryRoute,
		withOpenApiRouteError(recoverImplementationQueueEntryRoute, async (c) => {
			const entry = await recoverImplementationQueueEntry(
				c.req.param("id"),
				c.req.valid("json"),
			);
			return c.json(entry, 200);
		}),
	)
	.openapi(
		drainImplementationQueueRoute,
		withOpenApiRouteError(drainImplementationQueueRoute, async (c) => {
			const started = await runImplementationQueue();
			return c.json({ started: started.length }, 200);
		}),
	)
	.openapi(
		getImplementationQueueSettingsRoute,
		withOpenApiRouteError(getImplementationQueueSettingsRoute, async (c) => {
			const result = await listImplementationQueueDashboard();
			return c.json(result.settings, 200);
		}),
	)
	.openapi(
		patchImplementationQueueSettingsRoute,
		withOpenApiRouteError(patchImplementationQueueSettingsRoute, async (c) => {
			const body = c.req.valid("json");
			const settings = await updateImplementationQueueSettings(body);
			return c.json(settings, 200);
		}),
	)
	.openapi(
		getTodoWorkflowSettingsRoute,
		withOpenApiRouteError(getTodoWorkflowSettingsRoute, async (c) => {
			const settings = await getTodoWorkflowSettings();
			return c.json(settings, 200);
		}),
	)
	.openapi(
		patchTodoWorkflowSettingsRoute,
		withOpenApiRouteError(patchTodoWorkflowSettingsRoute, async (c) => {
			const body = c.req.valid("json");
			const settings = await updateTodoWorkflowSettings(body);
			return c.json(settings, 200);
		}),
	);
