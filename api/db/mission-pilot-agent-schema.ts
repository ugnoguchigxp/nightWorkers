import {
	index,
	integer,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";
import type {
	MissionPilotActionExecutionStatus,
	MissionPilotActionFailure,
	MissionPilotAgentEngineMode,
	MissionPilotConversationItemKind,
	MissionPilotRepairRequest,
	MissionPilotRuntimeState,
	MissionPilotTaskEventType,
	MissionPilotToolCallStatus,
} from "../../shared/modules/missionPilot";
import { missionPilotSessions } from "./mission-pilot-schema";
import { tasks } from "./schema";

export const missionPilotAgentSessions = sqliteTable(
	"mission_pilot_agent_sessions",
	{
		sessionId: text("session_id")
			.primaryKey()
			.references(() => missionPilotSessions.id, { onDelete: "cascade" }),
		engineMode: text("engine_mode")
			.$type<MissionPilotAgentEngineMode>()
			.notNull()
			.default("agent"),
		runtimeState: text("runtime_state")
			.$type<MissionPilotRuntimeState>()
			.notNull()
			.default("stopped"),
		systemContextVersion: integer("system_context_version")
			.notNull()
			.default(1),
		conversationRevision: integer("conversation_revision").notNull().default(0),
		compactionRevision: integer("compaction_revision"),
		nextConversationSequence: integer("next_conversation_sequence")
			.notNull()
			.default(1),
		lastConsumedEventSequence: integer("last_consumed_event_sequence"),
		nextTurnIndex: integer("next_turn_index").notNull().default(1),
		nextEventSequence: integer("next_event_sequence").notNull().default(1),
		currentTurnId: text("current_turn_id"),
		providerEndpointId: text("provider_endpoint_id"),
		model: text("model"),
		thinkingDepth: text("thinking_depth"),
		contextRevision: integer("context_revision").notNull().default(1),
		contextDigest: text("context_digest").notNull().default(""),
		leaseOwner: text("lease_owner"),
		leaseExpiresAt: integer("lease_expires_at", { mode: "timestamp" }),
		lastFailureJson: text("last_failure_json", {
			mode: "json",
		}).$type<MissionPilotActionFailure | null>(),
		createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
		updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
	},
	(table) => ({
		runtimeLeaseIdx: index("mission_pilot_agent_sessions_runtime_lease_idx").on(
			table.runtimeState,
			table.leaseExpiresAt,
		),
	}),
);

export const missionPilotAgentTurns = sqliteTable(
	"mission_pilot_agent_turns",
	{
		id: text("id").primaryKey(),
		sessionId: text("session_id")
			.notNull()
			.references(() => missionPilotSessions.id, { onDelete: "cascade" }),
		turnIndex: integer("turn_index").notNull(),
		triggerEventFrom: integer("trigger_event_from"),
		triggerEventTo: integer("trigger_event_to"),
		status: text("status").notNull().default("running"),
		provider: text("provider"),
		model: text("model"),
		startedAt: integer("started_at", { mode: "timestamp" }).notNull(),
		finishedAt: integer("finished_at", { mode: "timestamp" }),
		errorJson: text("error_json", { mode: "json" }).$type<unknown>(),
	},
	(table) => ({
		turnUidx: uniqueIndex("mission_pilot_agent_turns_turn_uidx").on(
			table.sessionId,
			table.turnIndex,
		),
		statusIdx: index("mission_pilot_agent_turns_status_idx").on(
			table.sessionId,
			table.status,
		),
	}),
);

export const missionPilotToolCalls = sqliteTable(
	"mission_pilot_tool_calls",
	{
		id: text("id").primaryKey(),
		sessionId: text("session_id")
			.notNull()
			.references(() => missionPilotSessions.id, { onDelete: "cascade" }),
		turnId: text("turn_id")
			.notNull()
			.references(() => missionPilotAgentTurns.id, { onDelete: "cascade" }),
		providerCallId: text("provider_call_id").notNull(),
		actionId: text("action_id").notNull(),
		argumentsJson: text("arguments_json", { mode: "json" })
			.$type<Record<string, unknown>>()
			.notNull(),
		status: text("status")
			.$type<MissionPilotToolCallStatus>()
			.notNull()
			.default("pending"),
		idempotencyKey: text("idempotency_key").notNull(),
		expectedTaskRevision: integer("expected_task_revision"),
		resultJson: text("result_json", { mode: "json" }).$type<unknown>(),
		failureJson: text("failure_json", {
			mode: "json",
		}).$type<MissionPilotActionFailure>(),
		startedAt: integer("started_at", { mode: "timestamp" }),
		finishedAt: integer("finished_at", { mode: "timestamp" }),
		createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
		updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
	},
	(table) => ({
		providerCallUidx: uniqueIndex(
			"mission_pilot_tool_calls_provider_call_uidx",
		).on(table.sessionId, table.providerCallId),
		idempotencyUidx: uniqueIndex(
			"mission_pilot_tool_calls_idempotency_uidx",
		).on(table.sessionId, table.idempotencyKey),
		statusIdx: index("mission_pilot_tool_calls_status_idx").on(
			table.sessionId,
			table.status,
		),
	}),
);

export const missionPilotActionExecutions = sqliteTable(
	"mission_pilot_action_executions",
	{
		id: text("id").primaryKey(),
		sessionId: text("session_id")
			.notNull()
			.references(() => missionPilotSessions.id, { onDelete: "cascade" }),
		taskId: text("task_id")
			.notNull()
			.references(() => tasks.id, { onDelete: "cascade" }),
		toolCallId: text("tool_call_id")
			.notNull()
			.references(() => missionPilotToolCalls.id, { onDelete: "cascade" }),
		actionId: text("action_id").notNull(),
		idempotencyKey: text("idempotency_key").notNull(),
		argumentsDigest: text("arguments_digest").notNull(),
		expectedTaskRevision: integer("expected_task_revision"),
		status: text("status")
			.$type<MissionPilotActionExecutionStatus>()
			.notNull()
			.default("pending"),
		resultJson: text("result_json", { mode: "json" }).$type<unknown>(),
		failureJson: text("failure_json", {
			mode: "json",
		}).$type<MissionPilotActionFailure>(),
		sourceResourceType: text("source_resource_type"),
		sourceResourceId: text("source_resource_id"),
		createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
		startedAt: integer("started_at", { mode: "timestamp" }),
		finishedAt: integer("finished_at", { mode: "timestamp" }),
		updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
	},
	(table) => ({
		idempotencyUidx: uniqueIndex(
			"mission_pilot_action_executions_idempotency_uidx",
		).on(table.sessionId, table.idempotencyKey),
		toolCallUidx: uniqueIndex(
			"mission_pilot_action_executions_tool_call_uidx",
		).on(table.toolCallId),
		statusIdx: index("mission_pilot_action_executions_status_idx").on(
			table.sessionId,
			table.status,
		),
	}),
);

export const missionPilotConversationItems = sqliteTable(
	"mission_pilot_conversation_items",
	{
		id: text("id").primaryKey(),
		sessionId: text("session_id")
			.notNull()
			.references(() => missionPilotSessions.id, { onDelete: "cascade" }),
		sequence: integer("sequence").notNull(),
		kind: text("kind").$type<MissionPilotConversationItemKind>().notNull(),
		turnId: text("turn_id").references(() => missionPilotAgentTurns.id, {
			onDelete: "set null",
		}),
		toolCallId: text("tool_call_id").references(
			() => missionPilotToolCalls.id,
			{ onDelete: "set null" },
		),
		bodyJson: text("body_json", { mode: "json" }).$type<unknown>().notNull(),
		sourceKind: text("source_kind"),
		sourceId: text("source_id"),
		createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
	},
	(table) => ({
		sequenceUidx: uniqueIndex(
			"mission_pilot_conversation_items_sequence_uidx",
		).on(table.sessionId, table.sequence),
		kindIdx: index("mission_pilot_conversation_items_kind_idx").on(
			table.sessionId,
			table.kind,
			table.sequence,
		),
	}),
);

export const missionPilotTaskEventInbox = sqliteTable(
	"mission_pilot_task_event_inbox",
	{
		id: text("id").primaryKey(),
		sessionId: text("session_id")
			.notNull()
			.references(() => missionPilotSessions.id, { onDelete: "cascade" }),
		taskId: text("task_id")
			.notNull()
			.references(() => tasks.id, { onDelete: "cascade" }),
		sequence: integer("sequence").notNull(),
		eventType: text("event_type").$type<MissionPilotTaskEventType>().notNull(),
		sourceEventId: text("source_event_id").notNull(),
		taskRevision: integer("task_revision").notNull(),
		payloadJson: text("payload_json", { mode: "json" })
			.$type<unknown>()
			.notNull(),
		availableAt: integer("available_at", { mode: "timestamp" }).notNull(),
		consumedAt: integer("consumed_at", { mode: "timestamp" }),
		createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
	},
	(table) => ({
		sequenceUidx: uniqueIndex(
			"mission_pilot_task_event_inbox_sequence_uidx",
		).on(table.sessionId, table.sequence),
		sourceUidx: uniqueIndex("mission_pilot_task_event_inbox_source_uidx").on(
			table.sessionId,
			table.sourceEventId,
		),
		availableIdx: index("mission_pilot_task_event_inbox_available_idx").on(
			table.sessionId,
			table.consumedAt,
			table.availableAt,
		),
	}),
);

export const missionPilotRepairRequests = sqliteTable(
	"mission_pilot_repair_requests",
	{
		id: text("id").primaryKey(),
		sessionId: text("session_id")
			.notNull()
			.references(() => missionPilotSessions.id, { onDelete: "cascade" }),
		sourceRunId: text("source_run_id"),
		requestJson: text("request_json", { mode: "json" })
			.$type<MissionPilotRepairRequest>()
			.notNull(),
		sourceRevision: integer("source_revision").notNull(),
		sourceDigest: text("source_digest").notNull(),
		status: text("status").notNull().default("requested"),
		createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
		updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
	},
	(table) => ({
		sessionIdx: index("mission_pilot_repair_requests_session_idx").on(
			table.sessionId,
			table.createdAt,
		),
	}),
);
