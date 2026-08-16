import { z } from "@hono/zod-openapi";
import type { missionPilotAuthorizationSchema } from "./mission-pilot.schema";

export const missionPilotAgentEngineModeSchema = z.literal("agent");
export const missionPilotRuntimeStateSchema = z.enum([
	"stopped",
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
	"run_outcome",
	"compaction_summary",
	"runtime_failure",
	"repair_request",
]);
export const MISSION_PILOT_TASK_EVENT_TYPES = [
	"task.user_message_added",
	"task.state_changed",
	"questionnaire.ready",
	"questionnaire.state_changed",
	"questionnaire.submission_failed",
	"questionnaire.follow_up_failed",
	"plan_artifact.ready",
	"plan_artifact.failed",
	"task_run.started",
	"task_run.terminal",
	"task_run.failed",
	"task_queue.failed",
	"git.mutation_failed",
	"task_action.failed",
	"permission.changed",
	"mission_pilot.resume_requested",
	"mission_pilot.retry_timer_elapsed",
] as const;
export const missionPilotTaskEventTypeSchema = z.enum(
	MISSION_PILOT_TASK_EVENT_TYPES,
);
export const missionPilotToolCallStatusSchema = z.enum([
	"pending",
	"running",
	"succeeded",
	"failed",
	"cancelled",
]);
export const missionPilotActionExecutionStatusSchema = z.enum([
	"pending",
	"executing",
	"succeeded",
	"failed",
	"outcome_unknown",
]);
export const missionPilotActionFailureKindSchema = z.enum([
	"transport",
	"timeout",
	"rate_limit",
	"provider_capacity",
	"authentication",
	"permission",
	"invalid_request",
	"invalid_response",
	"schema_invalid",
	"schema_validation",
	"revision_conflict",
	"domain_precondition",
	"outcome_unknown",
	"resource_limit",
	"provider_capability",
	"cancelled",
	"unknown",
]);

export const missionPilotActionFailureSchema = z.object({
	kind: missionPilotActionFailureKindSchema,
	retryable: z.boolean().nullable(),
	providerCode: z.string().nullable(),
	code: z.string().nullable().optional(),
	httpStatus: z.number().int().nullable(),
	message: z.string(),
	retryAfterMs: z.number().int().nonnegative().nullable(),
	attempt: z.number().int().positive(),
	actionId: z.string(),
	idempotencyKey: z.string().nullable(),
	currentTaskRevision: z.number().int().nonnegative().nullable().optional(),
	details: z.record(z.string(), z.unknown()).nullable().optional(),
});
export const missionPilotTaskActionDescriptorSchema = z.object({
	actionId: z.string(),
	title: z.string(),
	description: z.string(),
	inputSchema: z.record(z.string(), z.unknown()),
	availability: z.enum(["available", "unavailable", "confirmation_required"]),
	unavailableReason: z.string().nullable(),
	expectedTaskRevision: z.number().int().nonnegative(),
});
export const missionPilotTaskReadModelSchema = z.object({
	task: z.object({
		id: z.string(),
		title: z.string(),
		description: z.string().nullable(),
		objective: z.string().nullable(),
		acceptanceCriteria: z.string().nullable(),
		status: z.string(),
		revision: z.number().int().nonnegative(),
	}),
	project: z.object({
		id: z.string(),
		name: z.string(),
		repositoryState: z.string(),
	}),
	repository: z.unknown().optional(),
	specification: z.unknown().nullable().optional(),
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
	artifacts: z.array(z.unknown()).optional(),
	queue: z.unknown().nullable(),
	activeRun: z.unknown().nullable(),
	activeRuns: z.array(z.unknown()).optional(),
	terminalRuns: z.array(z.unknown()),
	availableActions: z.array(missionPilotTaskActionDescriptorSchema),
	observedAt: z.string().optional(),
});

export type MissionPilotAgentEngineMode = z.infer<
	typeof missionPilotAgentEngineModeSchema
>;
export type MissionPilotRuntimeState = z.infer<
	typeof missionPilotRuntimeStateSchema
>;
export type MissionPilotConversationItemKind = z.infer<
	typeof missionPilotConversationItemKindSchema
>;
export type MissionPilotTaskEventType = z.infer<
	typeof missionPilotTaskEventTypeSchema
>;
export type MissionPilotToolCallStatus = z.infer<
	typeof missionPilotToolCallStatusSchema
>;
export type MissionPilotActionExecutionStatus = z.infer<
	typeof missionPilotActionExecutionStatusSchema
>;
export type MissionPilotActionFailure = z.infer<
	typeof missionPilotActionFailureSchema
>;
export type MissionPilotTaskActionDescriptor = z.infer<
	typeof missionPilotTaskActionDescriptorSchema
>;
export type MissionPilotTaskReadModel = z.infer<
	typeof missionPilotTaskReadModelSchema
>;
export type MissionPilotAgentAuthorization = z.infer<
	typeof missionPilotAuthorizationSchema
>;
