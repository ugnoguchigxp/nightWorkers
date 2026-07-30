import { z } from "@hono/zod-openapi";

export const REQUIRED_PLAN_MODE_ROUTING_VIEWS = [
	"feature_plan",
	"questionnaire",
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
export const planModeRoutingActorSchema = z.enum([
	"user",
	"delegated_user",
	"questionnaire_recommender",
]);

export const planModeRoutingEntrySchema = z
	.object({
		view: planModeRoutingViewSchema,
		decision: planModeRoutingDecisionSchema,
		required: z.boolean(),
		capabilityEnabled: z.boolean(),
		reason: z.string().min(1),
	})
	.strict();

export const planModeRoutingSnapshotSchema = z
	.object({
		revision: z.number().int().nonnegative(),
		entries: z.array(planModeRoutingEntrySchema).length(9),
		editable: z.boolean(),
		lockedReason: z.string().nullable(),
		updatedBy: planModeRoutingActorSchema.nullable(),
		updatedAt: z.union([z.string(), z.date()]).nullable(),
	})
	.strict()
	.superRefine((snapshot, context) => {
		const byView = new Map(
			snapshot.entries.map((entry) => [entry.view, entry]),
		);
		if (byView.size !== snapshot.entries.length) {
			context.addIssue({
				code: "custom",
				path: ["entries"],
				message: "Plan Artifact routing entries must be unique by view.",
			});
		}
		for (const requiredView of REQUIRED_PLAN_MODE_ROUTING_VIEWS) {
			const entry = byView.get(requiredView);
			if (
				entry?.decision !== "include" ||
				!entry.required ||
				!entry.capabilityEnabled
			) {
				context.addIssue({
					code: "custom",
					path: ["entries"],
					message: `${requiredView} must remain required and enabled.`,
				});
			}
		}
	});

const updatePlanModeRoutingChangesSchema = z
	.array(
		z
			.object({
				view: editablePlanModeRoutingViewSchema,
				decision: planModeRoutingDecisionSchema,
				reason: z.string().min(1).max(1_000).optional(),
			})
			.strict(),
	)
	.min(1)
	.superRefine((changes, context) => {
		const seen = new Set<string>();
		for (const [index, change] of changes.entries()) {
			if (!seen.has(change.view)) {
				seen.add(change.view);
				continue;
			}
			context.addIssue({
				code: "custom",
				path: [index, "view"],
				message: "同じ Artifact を1回の変更で重複指定できません。",
			});
		}
	});

export const updatePlanModeRoutingRequestSchema = z
	.object({
		expectedRevision: z.number().int().nonnegative(),
		idempotencyKey: z.string().uuid(),
		changes: updatePlanModeRoutingChangesSchema,
	})
	.strict();

export const planModeRoutingChangedRealtimePayloadSchema = z
	.object({
		taskId: z.string().uuid(),
		revision: z.number().int().nonnegative(),
		updatedBy: planModeRoutingActorSchema,
	})
	.strict();

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
export type PlanModeRoutingChangedRealtimePayload = z.infer<
	typeof planModeRoutingChangedRealtimePayloadSchema
>;
