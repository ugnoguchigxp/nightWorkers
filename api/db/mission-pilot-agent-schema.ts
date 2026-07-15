import {
	index,
	integer,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";
import type {
	MissionPilotActionConfirmationStatus,
	MissionPilotAgentTurnStatus,
	MissionPilotConversationItemKind,
	MissionPilotTaskEventType,
	MissionPilotToolCallStatus,
} from "../../shared/schemas/mission-pilot-agent.schema";
import { missionPilotSessions } from "./mission-pilot-schema";
import { tasks } from "./schema";

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
		status: text("status")
			.$type<MissionPilotAgentTurnStatus>()
			.notNull()
			.default("running"),
		provider: text("provider"),
		model: text("model"),
		providerConversationRef: text("provider_conversation_ref"),
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
		failureJson: text("failure_json", { mode: "json" }).$type<unknown>(),
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

export const missionPilotActionConfirmations = sqliteTable(
	"mission_pilot_action_confirmations",
	{
		id: text("id").primaryKey(),
		sessionId: text("session_id")
			.notNull()
			.references(() => missionPilotSessions.id, { onDelete: "cascade" }),
		taskId: text("task_id")
			.notNull()
			.references(() => tasks.id, { onDelete: "cascade" }),
		requestedToolCallId: text("requested_tool_call_id")
			.notNull()
			.references(() => missionPilotToolCalls.id, { onDelete: "cascade" }),
		consumedByToolCallId: text("consumed_by_tool_call_id").references(
			() => missionPilotToolCalls.id,
			{ onDelete: "set null" },
		),
		actionId: text("action_id").notNull(),
		argumentsJson: text("arguments_json", { mode: "json" })
			.$type<Record<string, unknown>>()
			.notNull(),
		argumentsDigest: text("arguments_digest").notNull(),
		taskRevision: integer("task_revision").notNull(),
		activeKey: text("active_key"),
		status: text("status")
			.$type<MissionPilotActionConfirmationStatus>()
			.notNull()
			.default("pending"),
		version: integer("version").notNull().default(0),
		expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
		createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
		resolvedAt: integer("resolved_at", { mode: "timestamp" }),
		consumedAt: integer("consumed_at", { mode: "timestamp" }),
	},
	(table) => ({
		activeUidx: uniqueIndex(
			"mission_pilot_action_confirmations_active_uidx",
		).on(table.sessionId, table.activeKey),
		pendingIdx: index("mission_pilot_action_confirmations_pending_idx").on(
			table.taskId,
			table.status,
			table.createdAt,
		),
	}),
);
