import crypto from "node:crypto";
import {
	index,
	integer,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";
import type {
	ImplementationQueueEntryStatus,
	TaskRunStatus,
} from "./schema-base";
import { commonColumns, repositories, tasks } from "./schema-base";

export const taskRuns = sqliteTable(
	"task_runs",
	{
		...commonColumns,
		taskId: text("task_id")
			.notNull()
			.references(() => tasks.id, { onDelete: "cascade" }),
		repositoryId: text("repository_id").references(() => repositories.id, {
			onDelete: "cascade",
		}),
		status: text("status").$type<TaskRunStatus>().default("running").notNull(), // running | context_compiling | finalizing | completed | failed | cancelled | needs_review | blocked | timed_out | needs_human
		workerKind: text("worker_kind").default("native-local-worker").notNull(),
		baseRef: text("base_ref"),
		worktreePath: text("worktree_path"),
		timeoutSeconds: integer("timeout_seconds").default(3600).notNull(),
		contextSnapshot: text("context_snapshot", { mode: "json" }),
		summary: text("summary"),
		finalReport: text("final_report"),
		finalJudgment: text("final_judgment", { mode: "json" }),
		startedAt: integer("started_at", { mode: "timestamp" })
			.$defaultFn(() => new Date())
			.notNull(),
		endedAt: integer("ended_at", { mode: "timestamp" }),
		finishedAt: integer("finished_at", { mode: "timestamp" }),
		logContent: text("log_content"),
		diffPatch: text("diff_patch"),
		testResults: text("test_results", { mode: "json" }),
	},
	(table) => ({
		taskIdIdx: index("task_runs_task_id_idx").on(table.taskId),
	}),
);

export const implementationQueueEntries = sqliteTable(
	"implementation_queue_entries",
	{
		...commonColumns,
		taskId: text("task_id")
			.notNull()
			.references(() => tasks.id, { onDelete: "cascade" }),
		repositoryId: text("repository_id")
			.notNull()
			.references(() => repositories.id, { onDelete: "cascade" }),
		status: text("status")
			.$type<ImplementationQueueEntryStatus>()
			.default("queued")
			.notNull(),
		priority: integer("priority").default(0).notNull(),
		queuePosition: integer("queue_position"),
		processorSlot: integer("processor_slot"),
		activeRunId: text("active_run_id").references(() => taskRuns.id, {
			onDelete: "set null",
		}),
		claimedAt: integer("claimed_at", { mode: "timestamp" }),
		lastHeartbeatAt: integer("last_heartbeat_at", { mode: "timestamp" }),
		archivedAt: integer("archived_at", { mode: "timestamp" }),
		statusReason: text("status_reason"),
		leaseOwnerId: text("lease_owner_id"),
		leaseAcquiredAt: integer("lease_acquired_at", { mode: "timestamp" }),
		leaseExpiresAt: integer("lease_expires_at", { mode: "timestamp" }),
		leaseVersion: integer("lease_version").default(0).notNull(),
		attemptCount: integer("attempt_count").default(0).notNull(),
		recoveredAt: integer("recovered_at", { mode: "timestamp" }),
		recoveryReason: text("recovery_reason"),
		lastFailureKind: text("last_failure_kind"),
		executionType: text("execution_type").default("normal").notNull(),
		executionLockKey: text("execution_lock_key"),
		sequenceGroupId: text("sequence_group_id"),
		sequenceOrder: integer("sequence_order"),
		sequenceDependsOnEntryId: text("sequence_depends_on_entry_id"),
		schedulingReason: text("scheduling_reason"),
		missionPilotAdmissionKey: text("mission_pilot_admission_key"),
		claimReady: integer("claim_ready", { mode: "boolean" })
			.default(true)
			.notNull(),
	},
	(table) => ({
		taskIdIdx: index("implementation_queue_entries_task_id_idx").on(
			table.taskId,
		),
		repositoryStatusIdx: index(
			"implementation_queue_entries_repository_status_idx",
		).on(table.repositoryId, table.status),
		claimOrderIdx: index("implementation_queue_entries_claim_order_idx").on(
			table.status,
			table.priority,
			table.queuePosition,
			table.createdAt,
		),
		leaseExpiryIdx: index("implementation_queue_entries_lease_expiry_idx").on(
			table.status,
			table.leaseExpiresAt,
		),
		activeRunIdx: index("implementation_queue_entries_active_run_idx").on(
			table.activeRunId,
		),
		leaseOwnerIdx: index("implementation_queue_entries_lease_owner_idx").on(
			table.leaseOwnerId,
			table.leaseExpiresAt,
		),
		schedulingIdx: index("implementation_queue_entries_scheduling_idx").on(
			table.repositoryId,
			table.executionLockKey,
			table.executionType,
			table.status,
		),
		sequenceIdx: index("implementation_queue_entries_sequence_idx").on(
			table.sequenceGroupId,
			table.sequenceOrder,
		),
		missionPilotAdmissionUidx: uniqueIndex(
			"implementation_queue_entries_mission_pilot_admission_uidx",
		).on(table.missionPilotAdmissionKey),
	}),
);

export const taskRunCommitRecords = sqliteTable(
	"task_run_commit_records",
	{
		...commonColumns,
		runId: text("run_id")
			.notNull()
			.unique()
			.references(() => taskRuns.id, { onDelete: "cascade" }),
		repositoryId: text("repository_id")
			.notNull()
			.references(() => repositories.id, { onDelete: "cascade" }),
		status: text("status").default("pending").notNull(),
		baselineHead: text("baseline_head"),
		baselineStatusJson: text("baseline_status_json", { mode: "json" }),
		preExistingDirtyPathsJson: text("pre_existing_dirty_paths_json", {
			mode: "json",
		}).$type<string[]>(),
		ownedCandidatePathsJson: text("owned_candidate_paths_json", {
			mode: "json",
		}).$type<string[]>(),
		stageableOwnedPathsJson: text("stageable_owned_paths_json", {
			mode: "json",
		}).$type<string[]>(),
		excludedPathsJson: text("excluded_paths_json", { mode: "json" }).$type<
			Array<{ path: string; reason: string }>
		>(),
		verificationStatus: text("verification_status")
			.default("not_run")
			.notNull(),
		verificationEvidenceJson: text("verification_evidence_json", {
			mode: "json",
		}),
		commitSha: text("commit_sha"),
		commitMessage: text("commit_message"),
		pushStatus: text("push_status"),
		pushedAt: integer("pushed_at", { mode: "timestamp" }),
		pushRemote: text("push_remote"),
		pushBranch: text("push_branch"),
		statusReason: text("status_reason"),
	},
	(table) => ({
		runIdIdx: uniqueIndex("task_run_commit_records_run_id_uidx").on(
			table.runId,
		),
		repositoryStatusIdx: index(
			"task_run_commit_records_repository_status_idx",
		).on(table.repositoryId, table.status),
	}),
);

export const implementationQueueSettings = sqliteTable(
	"implementation_queue_settings",
	{
		id: text("id").primaryKey(),
		processorCount: integer("processor_count").default(1).notNull(),
		createdAt: integer("created_at", { mode: "timestamp" })
			.$defaultFn(() => new Date())
			.notNull(),
		updatedAt: integer("updated_at", { mode: "timestamp" })
			.$defaultFn(() => new Date())
			.$onUpdateFn(() => new Date())
			.notNull(),
	},
);

export const todoWorkflowSettings = sqliteTable("todo_workflow_settings", {
	id: text("id").primaryKey(),
	requirePerTodoReview: integer("require_per_todo_review", { mode: "boolean" })
		.default(true)
		.notNull(),
	requirePerTodoFix: integer("require_per_todo_fix", { mode: "boolean" })
		.default(true)
		.notNull(),
	requireFinalVerification: integer("require_final_verification", {
		mode: "boolean",
	})
		.default(true)
		.notNull(),
	requireRegisterCandidatePrompt: integer("require_register_candidate_prompt", {
		mode: "boolean",
	})
		.default(true)
		.notNull(),
	askCommitOnCompletion: integer("ask_commit_on_completion", {
		mode: "boolean",
	})
		.default(true)
		.notNull(),
	hookPolicyJson: text("hook_policy_json", { mode: "json" }),
	createdAt: integer("created_at", { mode: "timestamp" })
		.$defaultFn(() => new Date())
		.notNull(),
	updatedAt: integer("updated_at", { mode: "timestamp" })
		.$defaultFn(() => new Date())
		.$onUpdateFn(() => new Date())
		.notNull(),
});

export const taskRunTodos = sqliteTable(
	"task_run_todos",
	{
		...commonColumns,
		runId: text("run_id")
			.notNull()
			.references(() => taskRuns.id, { onDelete: "cascade" }),
		seq: integer("seq").notNull(),
		title: text("title").notNull(),
		description: text("description"),
		taskType: text("task_type").notNull(),
		status: text("status").default("pending").notNull(),
		procedureId: text("procedure_id"),
		procedureSnapshot: text("procedure_snapshot", { mode: "json" }),
		contextSnapshot: text("context_snapshot", { mode: "json" }),
		completionGateResult: text("completion_gate_result", { mode: "json" }),
		evidenceRequirementsJson: text("evidence_requirements_json", {
			mode: "json",
		}),
		evidenceRefsJson: text("evidence_refs_json", { mode: "json" }).$type<
			string[]
		>(),
		dependsOn: text("depends_on", { mode: "json" }).$type<
			Array<string | number>
		>(),
		statusReason: text("status_reason"),
		startedAt: integer("started_at", { mode: "timestamp" }),
		completedAt: integer("completed_at", { mode: "timestamp" }),
	},
	(table) => ({
		runIdIdx: index("task_run_todos_run_id_idx").on(table.runId),
		runSeqUniqueIdx: uniqueIndex("task_run_todos_run_seq_uidx").on(
			table.runId,
			table.seq,
		),
	}),
);

export const taskEvents = sqliteTable(
	"task_events",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		taskRunId: text("task_run_id")
			.notNull()
			.references(() => taskRuns.id, { onDelete: "cascade" }),
		seq: integer("seq").default(0).notNull(),
		actor: text("actor").default("system").notNull(), // system | supervisor | worker | human
		eventType: text("event_type"), // info | warning | error | checkpoint | state_change | tool_call | tool_result | supervisor_decision | final_report
		type: text("type").notNull(), // info | warning | error | checkpoint | state_change
		message: text("message").notNull(),
		payloadJson: text("payload_json", { mode: "json" }),
		timestamp: integer("timestamp", { mode: "timestamp" })
			.$defaultFn(() => new Date())
			.notNull(),
	},
	(table) => ({
		taskRunIdIdx: index("task_events_task_run_id_idx").on(table.taskRunId),
		taskRunSeqUniqueIdx: uniqueIndex("task_events_task_run_seq_uidx").on(
			table.taskRunId,
			table.seq,
		),
	}),
);

export const taskRunControlStates = sqliteTable("task_run_control_states", {
	runId: text("run_id")
		.primaryKey()
		.references(() => taskRuns.id, { onDelete: "cascade" }),
	version: integer("version").default(1).notNull(),
	phase: text("phase").default("active").notNull(),
	progressRevision: integer("progress_revision").default(0).notNull(),
	workspaceRevision: integer("workspace_revision").default(0).notNull(),
	workflowRevision: integer("workflow_revision").default(0).notNull(),
	todoRevision: integer("todo_revision").default(0).notNull(),
	evidenceRevision: integer("evidence_revision").default(0).notNull(),
	contextEpoch: integer("context_epoch").default(0).notNull(),
	lastMutationSequence: integer("last_mutation_sequence"),
	lastEvidenceSequence: integer("last_evidence_sequence"),
	consecutiveNoProgressTurns: integer("consecutive_no_progress_turns")
		.default(0)
		.notNull(),
	terminalReason: text("terminal_reason"),
	stateVersion: integer("state_version").default(0).notNull(),
	createdAt: integer("created_at", { mode: "timestamp" })
		.$defaultFn(() => new Date())
		.notNull(),
	updatedAt: integer("updated_at", { mode: "timestamp" })
		.$defaultFn(() => new Date())
		.$onUpdateFn(() => new Date())
		.notNull(),
});

export const taskRunActionRecords = sqliteTable(
	"task_run_action_records",
	{
		...commonColumns,
		runId: text("run_id")
			.notNull()
			.references(() => taskRuns.id, { onDelete: "cascade" }),
		sequence: integer("sequence").notNull(),
		toolName: text("tool_name").notNull(),
		normalizedArgsDigest: text("normalized_args_digest").notNull(),
		actionKey: text("action_key").notNull(),
		progressRevision: integer("progress_revision").notNull(),
		dedupeRevision: integer("dedupe_revision").notNull(),
		executionStatus: text("execution_status").default("pending").notNull(),
		transportStatus: text("transport_status"),
		domainOutcome: text("domain_outcome"),
		effect: text("effect").notNull(),
		resultDigest: text("result_digest"),
		evidenceRefsJson: text("evidence_refs_json", { mode: "json" }).$type<
			string[]
		>(),
		artifactRefsJson: text("artifact_refs_json", { mode: "json" }).$type<
			string[]
		>(),
		modelViewJson: text("model_view_json", { mode: "json" }),
		repeatCount: integer("repeat_count").default(0).notNull(),
	},
	(table) => ({
		runSequenceUniqueIdx: uniqueIndex(
			"task_run_action_records_run_sequence_uidx",
		).on(table.runId, table.sequence),
		runActionRevisionUniqueIdx: uniqueIndex(
			"task_run_action_records_run_action_revision_uidx",
		).on(table.runId, table.actionKey, table.dedupeRevision),
		runCreatedIdx: index("task_run_action_records_run_created_idx").on(
			table.runId,
			table.createdAt,
		),
	}),
);

export const nativeApiTurns = sqliteTable(
	"native_api_turns",
	{
		...commonColumns,
		runId: text("run_id")
			.notNull()
			.references(() => taskRuns.id, { onDelete: "cascade" }),
		taskId: text("task_id")
			.notNull()
			.references(() => tasks.id, { onDelete: "cascade" }),
		turnIndex: integer("turn_index").notNull(),
		status: text("status").default("running").notNull(),
		provider: text("provider"),
		model: text("model"),
		executionMode: text("execution_mode"),
		historyJson: text("history_json", { mode: "json" }),
		providerDebugJson: text("provider_debug_json", { mode: "json" }),
		errorJson: text("error_json", { mode: "json" }),
		startedAt: integer("started_at", { mode: "timestamp" })
			.$defaultFn(() => new Date())
			.notNull(),
		finishedAt: integer("finished_at", { mode: "timestamp" }),
	},
	(table) => ({
		runTurnUniqueIdx: uniqueIndex("native_api_turns_run_turn_uidx").on(
			table.runId,
			table.turnIndex,
		),
		runStatusIdx: index("native_api_turns_run_status_idx").on(
			table.runId,
			table.status,
		),
		resumeIdx: index("native_api_turns_resume_idx").on(
			table.taskId,
			table.status,
			table.provider,
			table.model,
			table.executionMode,
			table.finishedAt,
		),
	}),
);

export const nativeApiToolCalls = sqliteTable(
	"native_api_tool_calls",
	{
		...commonColumns,
		runId: text("run_id")
			.notNull()
			.references(() => taskRuns.id, { onDelete: "cascade" }),
		taskId: text("task_id")
			.notNull()
			.references(() => tasks.id, { onDelete: "cascade" }),
		turnId: text("turn_id")
			.notNull()
			.references(() => nativeApiTurns.id, { onDelete: "cascade" }),
		toolCallId: text("tool_call_id").notNull(),
		toolName: text("tool_name").notNull(),
		status: text("status").default("pending").notNull(),
		argumentsJson: text("arguments_json", { mode: "json" }),
		resultJson: text("result_json", { mode: "json" }),
		errorJson: text("error_json", { mode: "json" }),
		modelVisibleOutput: text("model_visible_output"),
		todoSeq: integer("todo_seq"),
		source: text("source").default("provider_native").notNull(),
		startedAt: integer("started_at", { mode: "timestamp" }),
		finishedAt: integer("finished_at", { mode: "timestamp" }),
	},
	(table) => ({
		runToolCallUniqueIdx: uniqueIndex("native_api_tool_calls_run_call_uidx").on(
			table.runId,
			table.toolCallId,
		),
		runStatusIdx: index("native_api_tool_calls_run_status_idx").on(
			table.runId,
			table.status,
		),
		turnIdx: index("native_api_tool_calls_turn_idx").on(table.turnId),
	}),
);

export const runtimeSessionStates = sqliteTable(
	"runtime_session_states",
	{
		...commonColumns,
		taskId: text("task_id")
			.notNull()
			.references(() => tasks.id, { onDelete: "cascade" }),
		repositoryId: text("repository_id").references(() => repositories.id, {
			onDelete: "cascade",
		}),
		runId: text("run_id").references(() => taskRuns.id, {
			onDelete: "set null",
		}),
		runtimeLane: text("runtime_lane").notNull(),
		provider: text("provider").notNull(),
		providerSessionId: text("provider_session_id"),
		executionMode: text("execution_mode"),
		model: text("model"),
		status: text("status").notNull(),
		lastSeenAt: integer("last_seen_at", { mode: "timestamp" }).notNull(),
		metadataJson: text("metadata_json", { mode: "json" }),
	},
	(table) => ({
		lookupIdx: index("runtime_session_states_lookup_idx").on(
			table.taskId,
			table.repositoryId,
			table.runtimeLane,
			table.provider,
			table.executionMode,
			table.status,
			table.lastSeenAt,
		),
		runIdx: index("runtime_session_states_run_idx").on(table.runId),
	}),
);
