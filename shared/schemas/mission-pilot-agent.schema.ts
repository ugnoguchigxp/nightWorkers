import { z } from "@hono/zod-openapi";

export const missionPilotRuntimeKindSchema = z.enum(["legacy", "agent"]);

export const missionPilotRuntimeStateSchema = z.enum([
	"stopped",
	"idle",
	"running",
	"waiting",
	"attention",
	"completed",
]);

export const missionPilotConversationItemKindSchema = z.enum([
	"system_context",
	"user",
	"assistant",
	"tool_call",
	"tool_result",
	"task_event",
	"compaction_summary",
]);

export const missionPilotAgentTurnStatusSchema = z.enum([
	"running",
	"waiting_tool",
	"completed",
	"failed",
	"cancelled",
]);

export const missionPilotToolCallStatusSchema = z.enum([
	"pending",
	"running",
	"succeeded",
	"failed",
	"cancelled",
]);

export const missionPilotTaskEventTypeSchema = z.enum([
	"task.user_message_added",
	"task.state_changed",
	"questionnaire.ready",
	"plan_artifact.ready",
	"plan_artifact.failed",
	"task_run.started",
	"task_run.terminal",
	"task_action.failed",
	"permission.changed",
	"mission_pilot.resume_requested",
	"mission_pilot.retry_timer_elapsed",
	"mission_pilot.stop_requested",
]);

export const missionPilotActionFailureKindSchema = z.enum([
	"transport",
	"timeout",
	"rate_limit",
	"provider_capacity",
	"authentication",
	"invalid_request",
	"schema_validation",
	"domain_precondition",
	"permission",
	"provider_capability",
	"resource_limit",
	"revision_conflict",
	"outcome_unknown",
	"unknown",
]);

export const missionPilotActionFailureSchema = z.object({
	kind: missionPilotActionFailureKindSchema,
	retryable: z.boolean().nullable(),
	providerCode: z.string().nullable(),
	httpStatus: z.number().int().nullable(),
	message: z.string(),
	retryAfterMs: z.number().int().nonnegative().nullable(),
	attempt: z.number().int().positive(),
	actionId: z.string(),
	idempotencyKey: z.string().nullable(),
});

export const missionPilotTaskActionDescriptorSchema = z.object({
	actionId: z.string().min(1),
	title: z.string().min(1),
	description: z.string().min(1),
	inputSchema: z.record(z.string(), z.unknown()),
	availability: z.enum(["available", "unavailable", "confirmation_required"]),
	unavailableReason: z.string().nullable(),
	expectedTaskRevision: z.number().int().nonnegative(),
});

export const missionPilotRunOutcomeSchema = z.object({
	runId: z.string().uuid(),
	executionMode: z.string().nullable(),
	terminalState: z.string(),
	finalReport: z.string().nullable(),
	blocker: z
		.object({
			code: z.string().nullable(),
			message: z.string(),
		})
		.nullable(),
	verificationSummary: z.string().nullable(),
	artifactRefs: z.array(z.object({ kind: z.string(), id: z.string() })),
	completedAt: z.string().datetime().nullable(),
	diagnostic: z.unknown().nullable().optional(),
});

export const missionPilotTaskReadModelSchema = z.object({
	task: z.object({
		id: z.string().uuid(),
		title: z.string(),
		description: z.string().nullable(),
		objective: z.string().nullable(),
		acceptanceCriteria: z.string().nullable(),
		status: z.string(),
		revision: z.number().int().nonnegative(),
	}),
	project: z.object({
		id: z.string().uuid(),
		name: z.string(),
		repositoryState: z.string(),
	}),
	currentView: z.string().nullable(),
	questionnaire: z.unknown().nullable(),
	planArtifacts: z.array(
		z.object({
			id: z.string(),
			kind: z.string(),
			revision: z.number().int().nonnegative(),
			title: z.string().nullable(),
		}),
	),
	queue: z.unknown().nullable(),
	activeRun: z.unknown().nullable(),
	terminalRuns: z.array(missionPilotRunOutcomeSchema),
	availableActions: z.array(missionPilotTaskActionDescriptorSchema),
});

export const missionPilotActionResultSchema = z.discriminatedUnion("ok", [
	z.object({
		ok: z.literal(true),
		actionId: z.string(),
		data: z.unknown(),
	}),
	z.object({
		ok: z.literal(false),
		actionId: z.string(),
		failure: missionPilotActionFailureSchema,
	}),
]);

export type MissionPilotRuntimeKind = z.infer<
	typeof missionPilotRuntimeKindSchema
>;
export type MissionPilotRuntimeState = z.infer<
	typeof missionPilotRuntimeStateSchema
>;
export type MissionPilotConversationItemKind = z.infer<
	typeof missionPilotConversationItemKindSchema
>;
export type MissionPilotAgentTurnStatus = z.infer<
	typeof missionPilotAgentTurnStatusSchema
>;
export type MissionPilotToolCallStatus = z.infer<
	typeof missionPilotToolCallStatusSchema
>;
export type MissionPilotTaskEventType = z.infer<
	typeof missionPilotTaskEventTypeSchema
>;
export type MissionPilotActionFailure = z.infer<
	typeof missionPilotActionFailureSchema
>;
export type MissionPilotTaskActionDescriptor = z.infer<
	typeof missionPilotTaskActionDescriptorSchema
>;
export type MissionPilotRunOutcome = z.infer<
	typeof missionPilotRunOutcomeSchema
>;
export type MissionPilotTaskReadModel = z.infer<
	typeof missionPilotTaskReadModelSchema
>;
export type MissionPilotActionResult = z.infer<
	typeof missionPilotActionResultSchema
>;
