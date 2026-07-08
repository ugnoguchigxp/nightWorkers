import crypto from "node:crypto";
import {
	index,
	integer,
	real,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const commonColumns = {
	id: text("id")
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	createdAt: integer("created_at", { mode: "timestamp" })
		.$defaultFn(() => new Date())
		.notNull(),
	updatedAt: integer("updated_at", { mode: "timestamp" })
		.$defaultFn(() => new Date())
		.$onUpdateFn(() => new Date())
		.notNull(),
};

export type TaskStatus =
	| "draft"
	| "ready"
	| "context_compiling"
	| "queued"
	| "running"
	| "finalizing"
	| "verifying"
	| "needs_review"
	| "completed"
	| "blocked"
	| "failed"
	| "timed_out"
	| "cancelled"
	| "needs_human";

export type TaskRunStatus =
	| "ready"
	| "queued"
	| "running"
	| "context_compiling"
	| "finalizing"
	| "verifying"
	| "completed"
	| "failed"
	| "cancelled"
	| "needs_review"
	| "blocked"
	| "timed_out"
	| "needs_human";

export type ImplementationQueueEntryStatus =
	| "queued"
	| "claimed"
	| "processing"
	| "needs_human"
	| "awaiting_commit_decision"
	| "execution_completed"
	| "execution_archived"
	| "failed"
	| "cancelled";

export const users = sqliteTable("users", {
	...commonColumns,
	email: text("email").notNull().unique(),
	passwordHash: text("password_hash"),
	name: text("name").notNull(),
	isActive: integer("is_active", { mode: "boolean" }).default(true).notNull(),
});

export const refreshTokens = sqliteTable(
	"refresh_tokens",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		token: text("token").notNull().unique(),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
		createdAt: integer("created_at", { mode: "timestamp" })
			.$defaultFn(() => new Date())
			.notNull(),
	},
	(table) => ({
		userIdIdx: index("rt_user_id_idx").on(table.userId),
	}),
);

export const userExternalAccounts = sqliteTable(
	"user_external_accounts",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		provider: text("provider").notNull(), // 'google', 'github'
		externalId: text("external_id").notNull(),
		email: text("email"),
		createdAt: integer("created_at", { mode: "timestamp" })
			.$defaultFn(() => new Date())
			.notNull(),
	},
	(table) => ({
		providerExternalIdUniqueIdx: uniqueIndex("uex_provider_ext_uidx").on(
			table.provider,
			table.externalId,
		),
		userIdIdx: index("uex_user_id_idx").on(table.userId),
	}),
);

export const repositories = sqliteTable("repositories", {
	...commonColumns,
	name: text("name").notNull(),
	localPath: text("local_path").notNull(),
	branch: text("branch").default("main").notNull(),
	allowed: integer("allowed", { mode: "boolean" }).default(true).notNull(),
	queueEnabled: integer("queue_enabled", { mode: "boolean" })
		.default(false)
		.notNull(),
	maxConcurrentSessions: integer("max_concurrent_sessions")
		.default(1)
		.notNull(),
	safetyPolicy: text("safety_policy", { mode: "json" }).$type<{
		allowedPaths?: string[];
		externalAllowedPaths?: string[];
		deniedPaths?: string[];
		blockedCommands?: string[];
		maxCommandSeconds?: number;
		requireReadBeforeEdit?: boolean;
		maxTimeSeconds?: number;
	}>(),
	projectMeta: text("project_meta", { mode: "json" }).$type<Record<
		string,
		unknown
	> | null>(),
});

export const tasks = sqliteTable(
	"tasks",
	{
		...commonColumns,
		repositoryId: text("repository_id")
			.notNull()
			.references(() => repositories.id, { onDelete: "cascade" }),
		title: text("title").notNull(),
		description: text("description"),
		objective: text("objective"),
		acceptanceCriteria: text("acceptance_criteria"),
		status: text("status").$type<TaskStatus>().default("draft").notNull(), // draft | ready | context_compiling | queued | running | verifying | needs_review | completed | blocked | failed | timed_out | cancelled | needs_human
		compiledPrompt: text("compiled_prompt"),
		timeoutSeconds: integer("timeout_seconds").default(3600).notNull(),
		priority: integer("priority").default(0).notNull(),
		createdBy: text("created_by"),
	},
	(table) => ({
		repositoryIdIdx: index("tasks_repository_id_idx").on(table.repositoryId),
	}),
);

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

export const artifacts = sqliteTable(
	"artifacts",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		runId: text("run_id")
			.notNull()
			.references(() => taskRuns.id, { onDelete: "cascade" }),
		kind: text("kind").notNull(), // e.g. diff | log | file | patch
		path: text("path").notNull(),
		metadataJson: text("metadata_json", { mode: "json" }),
		createdAt: integer("created_at", { mode: "timestamp" })
			.$defaultFn(() => new Date())
			.notNull(),
	},
	(table) => ({
		runIdIdx: index("artifacts_run_id_idx").on(table.runId),
	}),
);

export const activityArtifacts = sqliteTable(
	"activity_artifacts",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		taskId: text("task_id")
			.notNull()
			.references(() => tasks.id, { onDelete: "cascade" }),
		runId: text("run_id").references(() => taskRuns.id, {
			onDelete: "set null",
		}),
		kind: text("kind").notNull(),
		path: text("path"),
		contentText: text("content_text"),
		metadataJson: text("metadata_json", { mode: "json" }),
		createdAt: integer("created_at", { mode: "timestamp" })
			.$defaultFn(() => new Date())
			.notNull(),
	},
	(table) => ({
		taskIdIdx: index("activity_artifacts_task_id_idx").on(table.taskId),
		runIdIdx: index("activity_artifacts_run_id_idx").on(table.runId),
		kindCreatedAtIdx: index("activity_artifacts_kind_created_at_idx").on(
			table.kind,
			table.createdAt,
		),
	}),
);

export const activityEvents = sqliteTable(
	"activity_events",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		taskId: text("task_id")
			.notNull()
			.references(() => tasks.id, { onDelete: "cascade" }),
		runId: text("run_id").references(() => taskRuns.id, {
			onDelete: "set null",
		}),
		turnId: text("turn_id"),
		parentEventId: text("parent_event_id"),
		seq: integer("seq").notNull(),
		runSeq: integer("run_seq"),
		kind: text("kind").notNull(),
		source: text("source").notNull(),
		status: text("status"),
		text: text("text"),
		payloadJson: text("payload_json", { mode: "json" }),
		artifactId: text("artifact_id").references(() => activityArtifacts.id, {
			onDelete: "set null",
		}),
		clientTempId: text("client_temp_id"),
		externalId: text("external_id"),
		dedupeKey: text("dedupe_key"),
		ingestError: text("ingest_error"),
		visibility: text("visibility").default("visible").notNull(),
		createdAt: integer("created_at", { mode: "timestamp" })
			.$defaultFn(() => new Date())
			.notNull(),
	},
	(table) => ({
		taskSeqUniqueIdx: uniqueIndex("activity_events_task_seq_uidx").on(
			table.taskId,
			table.seq,
		),
		taskCreatedAtIdx: index("activity_events_task_created_at_idx").on(
			table.taskId,
			table.createdAt,
		),
		runSeqIdx: index("activity_events_run_seq_idx").on(
			table.runId,
			table.runSeq,
		),
		turnSeqIdx: index("activity_events_turn_seq_idx").on(
			table.turnId,
			table.seq,
		),
		kindCreatedAtIdx: index("activity_events_kind_created_at_idx").on(
			table.kind,
			table.createdAt,
		),
		artifactIdIdx: index("activity_events_artifact_id_idx").on(
			table.artifactId,
		),
		dedupeKeyUniqueIdx: uniqueIndex("activity_events_dedupe_key_uidx").on(
			table.dedupeKey,
		),
	}),
);

export const backgroundProcesses = sqliteTable(
	"background_processes",
	{
		...commonColumns,
		repositoryId: text("repository_id")
			.notNull()
			.references(() => repositories.id, { onDelete: "cascade" }),
		taskId: text("task_id").references(() => tasks.id, {
			onDelete: "set null",
		}),
		runId: text("run_id").references(() => taskRuns.id, {
			onDelete: "set null",
		}),
		command: text("command").notNull(),
		cwd: text("cwd").notNull(),
		status: text("status").default("running").notNull(),
		pid: integer("pid"),
		exitCode: integer("exit_code"),
		signal: text("signal"),
		startedAt: integer("started_at", { mode: "timestamp" })
			.$defaultFn(() => new Date())
			.notNull(),
		endedAt: integer("ended_at", { mode: "timestamp" }),
		stopReason: text("stop_reason"),
		latestOutput: text("latest_output").default("").notNull(),
		outputArtifactId: text("output_artifact_id").references(
			() => activityArtifacts.id,
			{
				onDelete: "set null",
			},
		),
		metadataJson: text("metadata_json", { mode: "json" }),
	},
	(table) => ({
		repositoryStatusIdx: index("background_processes_repository_status_idx").on(
			table.repositoryId,
			table.status,
		),
		taskStatusIdx: index("background_processes_task_status_idx").on(
			table.taskId,
			table.status,
		),
		runStatusIdx: index("background_processes_run_status_idx").on(
			table.runId,
			table.status,
		),
	}),
);

export const taskMessages = sqliteTable(
	"task_messages",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		taskId: text("task_id")
			.notNull()
			.references(() => tasks.id, { onDelete: "cascade" }),
		runId: text("run_id").references(() => taskRuns.id, {
			onDelete: "set null",
		}),
		role: text("role").notNull(), // user | assistant | system | tool
		content: text("content").notNull(),
		messageType: text("message_type"), // text | chart | browser | playwright | flow | markdown_document
		metadataJson: text("metadata_json", { mode: "json" }),
		createdAt: integer("created_at", { mode: "timestamp" })
			.$defaultFn(() => new Date())
			.notNull(),
	},
	(table) => ({
		taskIdIdx: index("task_messages_task_id_idx").on(table.taskId),
		runIdIdx: index("task_messages_run_id_idx").on(table.runId),
	}),
);

export const conversationContextSnapshots = sqliteTable(
	"conversation_context_snapshots",
	{
		...commonColumns,
		taskId: text("task_id")
			.notNull()
			.references(() => tasks.id, { onDelete: "cascade" }),
		runId: text("run_id").references(() => taskRuns.id, {
			onDelete: "set null",
		}),
		version: integer("version").notNull(),
		sourceMessageId: text("source_message_id"),
		sourceRunId: text("source_run_id"),
		sourceEventCursor: text("source_event_cursor"),
		jobType: text("job_type"),
		latestUserMessageId: text("latest_user_message_id"),
		previousRunId: text("previous_run_id"),
		terminalState: text("terminal_state"),
		tokenEstimate: integer("token_estimate").default(0).notNull(),
		snapshotJson: text("snapshot_json", { mode: "json" }).notNull(),
		stateCardText: text("state_card_text").notNull(),
	},
	(table) => ({
		taskIdIdx: index("conversation_context_snapshots_task_id_idx").on(
			table.taskId,
		),
		runIdIdx: index("conversation_context_snapshots_run_id_idx").on(
			table.runId,
		),
		taskUpdatedAtIdx: index(
			"conversation_context_snapshots_task_updated_idx",
		).on(table.taskId, table.updatedAt),
	}),
);

export const llmUsageRecords = sqliteTable(
	"llm_usage_records",
	{
		...commonColumns,
		taskId: text("task_id")
			.notNull()
			.references(() => tasks.id, { onDelete: "cascade" }),
		runId: text("run_id").references(() => taskRuns.id, {
			onDelete: "set null",
		}),
		callId: text("call_id").notNull(),
		provider: text("provider").notNull(),
		model: text("model"),
		label: text("label").notNull(),
		round: integer("round"),
		usageMode: text("usage_mode").notNull(),
		inputTokens: integer("input_tokens"),
		outputTokens: integer("output_tokens"),
		cachedInputTokens: integer("cached_input_tokens"),
		reasoningOutputTokens: integer("reasoning_output_tokens"),
		totalTokens: integer("total_tokens"),
		systemPromptTokens: integer("system_prompt_tokens"),
		userPromptTokens: integer("user_prompt_tokens"),
		stateCardTokens: integer("state_card_tokens"),
		responseTokensEstimate: integer("response_tokens_estimate"),
		durationMs: integer("duration_ms").notNull(),
		rawUsageJson: text("raw_usage_json", { mode: "json" }),
		metadataJson: text("metadata_json", { mode: "json" }),
	},
	(table) => ({
		taskCreatedIdx: index("llm_usage_records_task_created_idx").on(
			table.taskId,
			table.createdAt,
		),
		runCreatedIdx: index("llm_usage_records_run_created_idx").on(
			table.runId,
			table.createdAt,
		),
		callIdUniqueIdx: uniqueIndex("llm_usage_records_call_id_uidx").on(
			table.callId,
		),
		providerCreatedIdx: index("llm_usage_records_provider_created_idx").on(
			table.provider,
			table.createdAt,
		),
	}),
);

export const llmModelPricing = sqliteTable(
	"llm_model_pricing",
	{
		...commonColumns,
		provider: text("provider").notNull(),
		model: text("model").notNull(),
		currencyCode: text("currency_code").default("USD").notNull(),
		inputPer1m: real("input_per_1m"),
		cachedInputPer1m: real("cached_input_per_1m"),
		outputPer1m: real("output_per_1m"),
		reasoningOutputPer1m: real("reasoning_output_per_1m"),
		sourceUrl: text("source_url"),
		sourceLabel: text("source_label"),
		effectiveFrom: integer("effective_from", { mode: "timestamp" })
			.$defaultFn(() => new Date(0))
			.notNull(),
		fetchedAt: integer("fetched_at", { mode: "timestamp" }),
		manualOverride: integer("manual_override", { mode: "boolean" })
			.default(false)
			.notNull(),
		enabled: integer("enabled", { mode: "boolean" }).default(true).notNull(),
	},
	(table) => ({
		providerModelIdx: index("llm_model_pricing_provider_model_idx").on(
			table.provider,
			table.model,
		),
		enabledIdx: index("llm_model_pricing_enabled_idx").on(table.enabled),
		providerModelCurrencyEffectiveUniqueIdx: uniqueIndex(
			"llm_model_pricing_provider_model_currency_effective_uidx",
		).on(table.provider, table.model, table.currencyCode, table.effectiveFrom),
	}),
);

export const llmUsageSummaryBuckets = sqliteTable(
	"llm_usage_summary_buckets",
	{
		...commonColumns,
		bucketHourUtc: integer("bucket_hour_utc", { mode: "timestamp" }).notNull(),
		repositoryId: text("repository_id").references(() => repositories.id, {
			onDelete: "cascade",
		}),
		repositoryKey: text("repository_key").notNull(),
		provider: text("provider").notNull(),
		model: text("model"),
		modelKey: text("model_key").notNull(),
		pricingCurrencyCode: text("pricing_currency_code"),
		pricingCurrencyKey: text("pricing_currency_key").notNull(),
		pricingStatus: text("pricing_status").notNull(),
		inputTokens: integer("input_tokens").default(0).notNull(),
		outputTokens: integer("output_tokens").default(0).notNull(),
		cachedInputTokens: integer("cached_input_tokens").default(0).notNull(),
		reasoningOutputTokens: integer("reasoning_output_tokens")
			.default(0)
			.notNull(),
		systemPromptTokens: integer("system_prompt_tokens").default(0).notNull(),
		userPromptTokens: integer("user_prompt_tokens").default(0).notNull(),
		stateCardTokens: integer("state_card_tokens").default(0).notNull(),
		totalTokens: integer("total_tokens").default(0).notNull(),
		totalDurationMs: integer("total_duration_ms").default(0).notNull(),
		outputDurationMs: integer("output_duration_ms").default(0).notNull(),
		measuredDurationCallCount: integer("measured_duration_call_count")
			.default(0)
			.notNull(),
		callCount: integer("call_count").default(0).notNull(),
		measuredCallCount: integer("measured_call_count").default(0).notNull(),
		estimatedCallCount: integer("estimated_call_count").default(0).notNull(),
		mixedCallCount: integer("mixed_call_count").default(0).notNull(),
		unavailableCallCount: integer("unavailable_call_count")
			.default(0)
			.notNull(),
		pricedCallCount: integer("priced_call_count").default(0).notNull(),
		unpricedCallCount: integer("unpriced_call_count").default(0).notNull(),
		manualPricedCallCount: integer("manual_priced_call_count")
			.default(0)
			.notNull(),
		estimatedCost: real("estimated_cost").default(0).notNull(),
		inputCost: real("input_cost").default(0).notNull(),
		cachedInputCost: real("cached_input_cost").default(0).notNull(),
		outputCost: real("output_cost").default(0).notNull(),
		reasoningOutputCost: real("reasoning_output_cost").default(0).notNull(),
		pricingUpdatedAt: integer("pricing_updated_at", { mode: "timestamp" }),
	},
	(table) => ({
		bucketUniqueIdx: uniqueIndex("llm_usage_summary_buckets_uidx").on(
			table.bucketHourUtc,
			table.repositoryKey,
			table.provider,
			table.modelKey,
			table.pricingCurrencyKey,
			table.pricingStatus,
		),
		bucketIdx: index("llm_usage_summary_buckets_hour_idx").on(
			table.bucketHourUtc,
		),
		repositoryBucketIdx: index(
			"llm_usage_summary_buckets_repository_hour_idx",
		).on(table.repositoryKey, table.bucketHourUtc),
		modelBucketIdx: index("llm_usage_summary_buckets_model_hour_idx").on(
			table.provider,
			table.modelKey,
			table.bucketHourUtc,
		),
	}),
);

export const llmUsageSummaryWarnings = sqliteTable(
	"llm_usage_summary_warnings",
	{
		...commonColumns,
		bucketHourUtc: integer("bucket_hour_utc", { mode: "timestamp" }).notNull(),
		repositoryId: text("repository_id").references(() => repositories.id, {
			onDelete: "cascade",
		}),
		repositoryKey: text("repository_key").notNull(),
		provider: text("provider").notNull(),
		model: text("model"),
		modelKey: text("model_key").notNull(),
		code: text("code").notNull(),
		detailKey: text("detail_key").notNull(),
		detailJson: text("detail_json", { mode: "json" }).$type<
			Record<string, unknown>
		>(),
		callCount: integer("call_count").default(0).notNull(),
	},
	(table) => ({
		warningUniqueIdx: uniqueIndex("llm_usage_summary_warnings_uidx").on(
			table.bucketHourUtc,
			table.repositoryKey,
			table.provider,
			table.modelKey,
			table.code,
			table.detailKey,
		),
		repositoryBucketIdx: index(
			"llm_usage_summary_warnings_repository_hour_idx",
		).on(table.repositoryKey, table.bucketHourUtc),
		codeIdx: index("llm_usage_summary_warnings_code_idx").on(table.code),
	}),
);

export const llmUsageSummaryTaskBuckets = sqliteTable(
	"llm_usage_summary_task_buckets",
	{
		...commonColumns,
		bucketHourUtc: integer("bucket_hour_utc", { mode: "timestamp" }).notNull(),
		repositoryId: text("repository_id").references(() => repositories.id, {
			onDelete: "cascade",
		}),
		repositoryKey: text("repository_key").notNull(),
		taskId: text("task_id")
			.notNull()
			.references(() => tasks.id, { onDelete: "cascade" }),
		pricingCurrencyCode: text("pricing_currency_code"),
		pricingCurrencyKey: text("pricing_currency_key").notNull(),
		pricingStatus: text("pricing_status").notNull(),
		inputTokens: integer("input_tokens").default(0).notNull(),
		outputTokens: integer("output_tokens").default(0).notNull(),
		cachedInputTokens: integer("cached_input_tokens").default(0).notNull(),
		reasoningOutputTokens: integer("reasoning_output_tokens")
			.default(0)
			.notNull(),
		systemPromptTokens: integer("system_prompt_tokens").default(0).notNull(),
		userPromptTokens: integer("user_prompt_tokens").default(0).notNull(),
		stateCardTokens: integer("state_card_tokens").default(0).notNull(),
		totalTokens: integer("total_tokens").default(0).notNull(),
		totalDurationMs: integer("total_duration_ms").default(0).notNull(),
		outputDurationMs: integer("output_duration_ms").default(0).notNull(),
		measuredDurationCallCount: integer("measured_duration_call_count")
			.default(0)
			.notNull(),
		callCount: integer("call_count").default(0).notNull(),
		pricedCallCount: integer("priced_call_count").default(0).notNull(),
		estimatedCost: real("estimated_cost").default(0).notNull(),
	},
	(table) => ({
		taskBucketUniqueIdx: uniqueIndex("llm_usage_summary_task_buckets_uidx").on(
			table.bucketHourUtc,
			table.repositoryKey,
			table.taskId,
			table.pricingCurrencyKey,
			table.pricingStatus,
		),
		taskRepositoryIdx: index(
			"llm_usage_summary_task_buckets_repository_idx",
		).on(table.repositoryKey, table.taskId),
		taskBucketIdx: index("llm_usage_summary_task_buckets_hour_idx").on(
			table.bucketHourUtc,
		),
	}),
);

export const blueprintDesignSettings = sqliteTable(
	"blueprint_design_settings",
	{
		...commonColumns,
		taskId: text("task_id")
			.notNull()
			.references(() => tasks.id, { onDelete: "cascade" }),
		settingsJson: text("settings_json", { mode: "json" }).notNull(),
	},
	(table) => ({
		taskIdUniqueIdx: uniqueIndex("blueprint_design_settings_task_id_uidx").on(
			table.taskId,
		),
	}),
);

export * from "./mission-planner-schema";
export * from "./project-evaluation-schema";

export const blueprintArtifactAdoptions = sqliteTable(
	"blueprint_artifact_adoptions",
	{
		...commonColumns,
		taskId: text("task_id")
			.notNull()
			.references(() => tasks.id, { onDelete: "cascade" }),
		messageId: text("message_id")
			.notNull()
			.references(() => taskMessages.id, { onDelete: "cascade" }),
		adopted: integer("adopted", { mode: "boolean" }).default(false).notNull(),
	},
	(table) => ({
		taskIdIdx: index("blueprint_artifact_adoptions_task_id_idx").on(
			table.taskId,
		),
		messageUniqueIdx: uniqueIndex(
			"blueprint_artifact_adoptions_message_uidx",
		).on(table.taskId, table.messageId),
	}),
);

export const blueprintDesignTokenAdoptions = sqliteTable(
	"blueprint_design_token_adoptions",
	{
		...commonColumns,
		taskId: text("task_id")
			.notNull()
			.references(() => tasks.id, { onDelete: "cascade" }),
		messageId: text("message_id")
			.notNull()
			.references(() => taskMessages.id, { onDelete: "cascade" }),
		adopted: integer("adopted", { mode: "boolean" }).default(false).notNull(),
	},
	(table) => ({
		taskIdIdx: index("blueprint_design_token_adoptions_task_id_idx").on(
			table.taskId,
		),
		messageUniqueIdx: uniqueIndex(
			"blueprint_design_token_adoptions_message_uidx",
		).on(table.taskId, table.messageId),
	}),
);
