import { z } from "@hono/zod-openapi";

export const REQUIRED_PLAN_MODE_ROUTING_VIEWS = [
	"questionnaire",
	"feature_plan",
] as const;

export const EDITABLE_PLAN_MODE_ROUTING_VIEWS = [
	"blueprint",
	"data_model",
	"user_flow",
	"api_io_contract",
	"activity_flow",
	"sequence_flow",
	"zod_schema_design",
] as const;

export const planModeRoutingViewSchema = z.enum([
	"feature_plan",
	"questionnaire",
	"user_flow",
	"blueprint",
	"data_model",
	"api_io_contract",
	"activity_flow",
	"sequence_flow",
	"zod_schema_design",
]);
export const editablePlanModeRoutingViewSchema = z.enum(
	EDITABLE_PLAN_MODE_ROUTING_VIEWS,
);
export const planModeRoutingDecisionSchema = z.enum(["include", "omit"]);
export const planModeRoutingActorSchema = z.enum(["user", "mission_pilot"]);

export const planModeRoutingEntrySchema = z.object({
	view: planModeRoutingViewSchema,
	decision: planModeRoutingDecisionSchema,
	required: z.boolean(),
	reason: z.string().min(1).optional(),
});

export const planModeRoutingSnapshotSchema = z.object({
	revision: z.number().int().nonnegative(),
	entries: z.array(planModeRoutingEntrySchema),
	editable: z.boolean(),
	lockedReason: z.string().nullable(),
	updatedBy: planModeRoutingActorSchema.nullable(),
	updatedAt: z.union([z.string(), z.date()]).nullable(),
});

export const updatePlanModeRoutingRequestSchema = z.object({
	expectedRevision: z.number().int().nonnegative(),
	changes: z
		.array(
			z.object({
				view: editablePlanModeRoutingViewSchema,
				decision: planModeRoutingDecisionSchema,
				reason: z.string().min(1).max(1_000).optional(),
			}),
		)
		.min(1),
});

export const missionPilotPlanRoutingToolCallSchema = z.object({
	tool: z.literal("edit_plan_artifact_routing"),
	expectedRevision: z.number().int().nonnegative(),
	changes: z
		.array(
			z.object({
				view: editablePlanModeRoutingViewSchema,
				decision: z.literal("include"),
				reason: z.string().min(1).max(1_000),
			}),
		)
		.min(1),
});

export type PlanModeRoutingView = z.infer<typeof planModeRoutingViewSchema>;
export type EditablePlanModeRoutingView = z.infer<
	typeof editablePlanModeRoutingViewSchema
>;
export type PlanModeRoutingDecision = z.infer<
	typeof planModeRoutingDecisionSchema
>;
export type PlanModeRoutingActor = z.infer<typeof planModeRoutingActorSchema>;
export type PlanModeRoutingEntry = z.infer<typeof planModeRoutingEntrySchema>;
export type PlanModeRoutingSnapshot = z.infer<
	typeof planModeRoutingSnapshotSchema
>;
export type UpdatePlanModeRoutingRequest = z.infer<
	typeof updatePlanModeRoutingRequestSchema
>;
export type MissionPilotPlanRoutingToolCall = z.infer<
	typeof missionPilotPlanRoutingToolCallSchema
>;
