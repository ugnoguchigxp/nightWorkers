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

export type PlanModeRegenerationTarget = z.infer<
	typeof planModeRegenerationTargetSchema
>;
export type PlanModeArtifactFocus = z.infer<typeof planModeArtifactFocusSchema>;
