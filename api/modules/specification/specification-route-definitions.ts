import { createRoute, z } from "@hono/zod-openapi";
import { planModeWorkspaceSchema } from "../../../shared/schemas/plan-mode-artifact.schema";
import {
	planModeRoutingSnapshotSchema,
	updatePlanModeRoutingRequestSchema,
} from "../../../shared/schemas/plan-mode-routing.schema";

export const getPlanModeWorkspaceRoute = createRoute({
	method: "get",
	path: "/tasks/:id/plan-mode/workspace",
	request: {
		params: z.object({ id: z.string().uuid() }),
	},
	responses: {
		200: {
			content: { "application/json": { schema: planModeWorkspaceSchema } },
			description: "Plan Mode Workspace read model",
		},
	},
});

export const updatePlanModeRoutingRoute = createRoute({
	method: "patch",
	path: "/tasks/:id/plan-mode/routing",
	request: {
		params: z.object({ id: z.string().uuid() }),
		body: {
			content: {
				"application/json": { schema: updatePlanModeRoutingRequestSchema },
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": { schema: planModeRoutingSnapshotSchema },
			},
			description: "Updated Plan Artifact routing",
		},
	},
});

const featurePlanGenerateRequestSchema = z.object({
	prompt: z.string().optional(),
	questionnaireSessionId: z.string().uuid().nullable().optional(),
	sourceBlueprintMessageId: z.string().uuid().nullable().optional(),
	sourceDataModelMessageId: z.string().uuid().nullable().optional(),
	sourceDedicatedViewMessageIds: z.array(z.string().uuid()).optional(),
	proceedWithUnansweredBlocking: z.boolean().optional(),
});

export const generateFeaturePlanRoute = createRoute({
	method: "post",
	path: "/tasks/:id/plan-mode/feature-plan",
	request: {
		params: z.object({ id: z.string().uuid() }),
		body: {
			content: {
				"application/json": {
					schema: featurePlanGenerateRequestSchema,
				},
			},
		},
	},
	responses: {
		200: {
			content: { "application/json": { schema: z.unknown() } },
			description: "Feature Plan generated from Plan Mode Status",
		},
	},
});
