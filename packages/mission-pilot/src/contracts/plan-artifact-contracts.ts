import { z } from "@hono/zod-openapi";

export const planModeRegenerationTargetSchema = z.enum([
	"feature_plan",
	"blueprint",
	"data_model",
	"user_flow",
	"api_io_contract",
	"activity_flow",
	"sequence_flow",
	"zod_schema_design",
]);

export const planModeArtifactFocusSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("artifact") }),
	z.object({
		kind: z.literal("screen"),
		screenIds: z.array(z.string().min(1)).min(1),
	}),
	z.object({
		kind: z.literal("section"),
		screenIds: z.array(z.string().min(1)).min(1),
		sectionIds: z.array(z.string().min(1)).min(1),
	}),
]);

export const planModeArtifactCorrectionTargetSchema = z
	.object({
		target: planModeRegenerationTargetSchema,
		sourceMessageId: z.string().uuid(),
		focus: planModeArtifactFocusSchema,
		instruction: z.string().min(1),
		preserveUnfocusedContent: z.boolean().default(true),
	})
	.superRefine((value, context) => {
		if (value.focus.kind !== "artifact" && value.target !== "blueprint") {
			context.addIssue({
				code: "custom",
				path: ["focus"],
				message: "screen and section focus are only supported for blueprint",
			});
		}
	});

export const missionPilotArtifactCorrectionStatusSchema = z.enum([
	"pending",
	"dispatching",
	"running",
	"result_received",
	"validating",
	"applied",
	"failed",
	"superseded",
	"cancelled",
]);

export type PlanModeRegenerationTarget = z.infer<
	typeof planModeRegenerationTargetSchema
>;
export type PlanModeArtifactFocus = z.infer<typeof planModeArtifactFocusSchema>;
export type MissionPilotArtifactCorrectionStatus = z.infer<
	typeof missionPilotArtifactCorrectionStatusSchema
>;
