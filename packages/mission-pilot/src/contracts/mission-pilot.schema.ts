import { z } from "@hono/zod-openapi";

const dateLikeSchema = z.union([z.string(), z.date()]);

const missionTaskCandidateSourceRefSchema = z.object({
	source: z.literal("mission_task_candidate"),
	id: z.string().uuid(),
});
const missionTaskProposalSourceRefSchema = z.object({
	source: z.literal("mission_task_proposal"),
	id: z.string().uuid(),
});
const taskSourceRefSchema = z.object({
	source: z.literal("task"),
	id: z.string().uuid(),
});
export const missionPilotSourceRefSchema = z.discriminatedUnion("source", [
	missionTaskCandidateSourceRefSchema,
	missionTaskProposalSourceRefSchema,
	taskSourceRefSchema,
]);
export const missionPilotPushPolicySchema = z.enum([
	"never",
	"allowed",
	"required",
]);
export const missionPilotAuthorizationV2Schema = z.object({
	version: z.literal(2),
	sessionId: z.string().uuid(),
	taskId: z.string().uuid(),
	sourceRef: missionPilotSourceRefSchema,
	grantedByAction: z.literal("mission_pilot_play"),
	grantedAt: z.string().datetime(),
	scopes: z.object({
		plan: z.literal(true),
		queue: z.literal(true),
		implementation: z.literal(true),
		testMutation: z.literal(true),
		review: z.literal(true),
		localCommit: z.literal(true),
		taskComplete: z.literal(true),
		taskArchive: z.literal(true),
		push: z.boolean(),
	}),
	pushPolicy: missionPilotPushPolicySchema,
});
export const missionPilotAuthorizationV3Schema = z.object({
	version: z.literal(3),
	sessionId: z.string().uuid(),
	taskId: z.string().uuid(),
	taskRef: taskSourceRefSchema,
	activationContextRevision: z.number().int().positive(),
	activationContextDigest: z.string().min(1),
	grantedByAction: z.literal("mission_pilot_play"),
	grantedAt: z.string().datetime(),
	scopes: missionPilotAuthorizationV2Schema.shape.scopes,
	pushPolicy: missionPilotPushPolicySchema,
});
const missionPilotDelegatedScopesSchema = z.object({
	plan: z.boolean(),
	queue: z.boolean(),
	implementation: z.boolean(),
	testMutation: z.boolean(),
	review: z.boolean(),
	localCommit: z.boolean(),
	taskComplete: z.boolean(),
	taskArchive: z.boolean(),
	push: z.boolean(),
});
export const missionPilotAuthorizationV4Schema = z.object({
	version: z.literal(4),
	sessionId: z.string().uuid(),
	taskId: z.string().uuid(),
	taskRef: taskSourceRefSchema,
	activationContextRevision: z.number().int().positive(),
	activationContextDigest: z.string().min(1),
	grantedByAction: z.literal("mission_pilot_play"),
	grantedAt: z.string().datetime(),
	subjectUserId: z.string().min(1),
	userAuthorizationRef: z.string().min(1),
	capabilityDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
	scopes: missionPilotDelegatedScopesSchema,
	pushPolicy: missionPilotPushPolicySchema,
});
export const missionPilotAuthorizationSchema = z.discriminatedUnion("version", [
	missionPilotAuthorizationV2Schema,
	missionPilotAuthorizationV3Schema,
	missionPilotAuthorizationV4Schema,
]);
export const missionPilotDesiredStateSchema = z.enum(["stopped", "playing"]);
export const missionPilotActivityStateSchema = z.enum([
	"idle",
	"starting",
	"running",
	"stopping",
	"attention",
]);
export const missionPilotInitialPromptStateSchema = z.enum([
	"pending",
	"dispatching",
	"sent",
	"failed",
]);
export const missionPilotControlSummarySchema = z.object({
	taskId: z.string().uuid(),
	desiredState: missionPilotDesiredStateSchema,
	activityState: missionPilotActivityStateSchema,
	phase: z.string(),
	authorizationVersion: z.number().int().nullable(),
	initialPromptState: missionPilotInitialPromptStateSchema,
	initialPromptMessageId: z.string().uuid().nullable(),
	activeRunId: z.string().uuid().nullable(),
	nextWakeAt: dateLikeSchema.nullable(),
	version: z.number().int().nonnegative(),
	lastErrorCode: z.string().nullable().optional(),
	lastError: z.string().nullable(),
	stoppedAt: dateLikeSchema.nullable().optional(),
	updatedAt: dateLikeSchema,
});
export const missionPilotCommandRequestSchema = z.object({
	expectedVersion: z.number().int().nonnegative(),
});
export const missionPilotCommandResponseSchema = z.object({
	missionPilot: missionPilotControlSummarySchema,
	task: z.unknown().optional(),
	run: z.unknown().nullable().optional(),
	messages: z.array(z.unknown()).optional(),
	stoppedRun: z.unknown().nullable().optional(),
});

export type MissionPilotSourceRef = z.infer<typeof missionPilotSourceRefSchema>;
export type MissionPilotAuthorizationV2 = z.infer<
	typeof missionPilotAuthorizationV2Schema
>;
export type MissionPilotAuthorizationV3 = z.infer<
	typeof missionPilotAuthorizationV3Schema
>;
export type MissionPilotAuthorizationV4 = z.infer<
	typeof missionPilotAuthorizationV4Schema
>;
export type MissionPilotAuthorization = z.infer<
	typeof missionPilotAuthorizationSchema
>;
export type MissionPilotControlSummary = z.infer<
	typeof missionPilotControlSummarySchema
>;
