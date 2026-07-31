import { z } from "zod";
import { missionPilotControlSummarySchema } from "./mission-pilot.schema";
import { missionPilotPlanProgressSchema } from "./mission-pilot-plan-progress.schema";

const realtimeEnvelopeFields = {
	taskId: z.string().uuid(),
	seq: z.number().int().nonnegative().optional(),
	timestamp: z.string().datetime().optional(),
	replayed: z.boolean().optional(),
};

export const missionPilotRealtimeEventSchema = z
	.object({
		...realtimeEnvelopeFields,
		type: z.literal("mission_pilot.updated"),
		payload: z.union([
			missionPilotControlSummarySchema,
			z
				.object({
					taskId: z.string().uuid(),
					missionPilot: missionPilotControlSummarySchema,
				})
				.strict(),
		]),
	})
	.strict();

export const missionPilotPlanProgressRealtimeEventSchema = z
	.object({
		...realtimeEnvelopeFields,
		type: z.literal("mission_pilot.plan_progress_updated"),
		payload: z
			.object({
				taskId: z.string().uuid(),
				progress: missionPilotPlanProgressSchema,
			})
			.strict(),
	})
	.strict();

export type MissionPilotRealtimeEvent = z.infer<
	typeof missionPilotRealtimeEventSchema
>;

export type MissionPilotRealtimeExtensionHandler = (event: unknown) => boolean;
