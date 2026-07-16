import { z } from "@hono/zod-openapi";
import { designQuestionnaireAnswerSchema } from "../../schemas/design-questionnaire.schema";
import { taskSchema } from "../../schemas/nightworkers/repository-task.schema";

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
export const missionPilotAuthorizationSchema = z.discriminatedUnion("version", [
	missionPilotAuthorizationV2Schema,
	missionPilotAuthorizationV3Schema,
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
export const missionPilotQueueHandoffSchema = z.object({
	sessionId: z.string().uuid(),
	taskId: z.string().uuid(),
	admissionKey: z.string().min(1),
	queueEntryId: z.string().uuid(),
	queueEntryStatus: z.literal("queued"),
	queueClaimReady: z.literal(false),
	reviewedContextRevision: z.number().int().positive(),
	reviewedContextDigest: z.string().min(1),
	routingRevision: z.number().int().nonnegative().default(0),
	featurePlanMessageId: z.string().uuid(),
	implementationTodoProjectionVersion: z.literal(1).optional(),
	implementationPlanSourceMessageId: z.string().uuid().optional(),
	implementationPlanDigest: z
		.string()
		.regex(/^sha256:[a-f0-9]{64}$/)
		.optional(),
	verificationDocumentId: z.string().uuid(),
	planReviewId: z.string().uuid(),
	planReviewVerdict: z.literal("pass"),
	queuedAt: dateLikeSchema,
});
export const missionPilotPreQueueDiagnosticCodeSchema = z.enum([
	"MISSION_PILOT_PRE_QUEUE_TASK_TERMINAL",
	"MISSION_PILOT_PRE_QUEUE_UNEXPECTED_RUN",
	"MISSION_PILOT_QUEUE_HANDOFF_STALE_CONTEXT",
	"MISSION_PILOT_QUEUE_HANDOFF_EVIDENCE_MISSING",
	"MISSION_PILOT_QUEUE_HANDOFF_DUPLICATE",
]);
export const missionPilotPreQueueDiagnosticSchema = z.object({
	code: missionPilotPreQueueDiagnosticCodeSchema,
	detectedAt: dateLikeSchema,
	taskStatus: z.string(),
	sessionPhase: z.string(),
	queueEntryIds: z.array(z.string().uuid()),
	runIds: z.array(z.string().uuid()),
	runSourceRefs: z.array(
		z.object({
			runId: z.string().uuid(),
			executionMode: z.string().nullable(),
			executionModeSource: z.string().nullable(),
		}),
	),
	commitRecordIds: z.array(z.string().uuid()),
	diffEventIds: z.array(z.string().uuid()),
	contextRevision: z.number().int().positive(),
	contextDigest: z.string().min(1),
	reviewedContextRevision: z.number().int().positive().nullable(),
	reviewedContextDigest: z.string().min(1).nullable(),
});
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
	queueHandoff: missionPilotQueueHandoffSchema.nullable().default(null),
	preQueueDiagnostic: missionPilotPreQueueDiagnosticSchema
		.nullable()
		.default(null),
	updatedAt: dateLikeSchema,
});
export const missionPilotAnswerEvidenceSchema = z.object({
	source: z.enum(["mission_pilot", "user", "user_confirmed"]),
	reason: z.string().min(1),
	updatedAt: dateLikeSchema,
});
export const missionPilotQuestionnaireDraftStateSchema = z.enum([
	"waiting_user",
	"submitting",
	"submitted",
	"failed",
]);
export const missionPilotQuestionnaireDraftSchema = z.object({
	id: z.string().uuid(),
	taskId: z.string().uuid(),
	questionnaireSessionId: z.string().uuid(),
	answers: z.array(designQuestionnaireAnswerSchema),
	answerEvidence: z.record(z.string(), missionPilotAnswerEvidenceSchema),
	state: missionPilotQuestionnaireDraftStateSchema,
	deadlineAt: dateLikeSchema,
	version: z.number().int().nonnegative(),
	createdAt: dateLikeSchema,
	updatedAt: dateLikeSchema,
});
export const updateMissionPilotQuestionnaireDraftSchema = z.object({
	expectedVersion: z.number().int().nonnegative(),
	answers: z.array(designQuestionnaireAnswerSchema).min(1),
});
export const submitMissionPilotQuestionnaireDraftSchema =
	updateMissionPilotQuestionnaireDraftSchema;
export const taskWithMissionPilotSchema = taskSchema.extend({
	missionPilot: missionPilotControlSummarySchema,
});
export const missionPilotCommandRequestSchema = z.object({
	expectedVersion: z.number().int().nonnegative(),
});
export const missionPilotCommandResponseSchema = z.object({
	missionPilot: missionPilotControlSummarySchema,
	task: taskSchema.optional(),
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
export type MissionPilotAuthorization = z.infer<
	typeof missionPilotAuthorizationSchema
>;
export type MissionPilotControlSummary = z.infer<
	typeof missionPilotControlSummarySchema
>;
export type MissionPilotQueueHandoff = z.infer<
	typeof missionPilotQueueHandoffSchema
>;
export type MissionPilotPreQueueDiagnosticCode = z.infer<
	typeof missionPilotPreQueueDiagnosticCodeSchema
>;
export type MissionPilotPreQueueDiagnostic = z.infer<
	typeof missionPilotPreQueueDiagnosticSchema
>;
export type MissionPilotAnswerEvidence = z.infer<
	typeof missionPilotAnswerEvidenceSchema
>;
export type MissionPilotQuestionnaireDraft = z.infer<
	typeof missionPilotQuestionnaireDraftSchema
>;
