import crypto from 'node:crypto';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

const commonColumns = {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .$defaultFn(() => new Date())
    .notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .$defaultFn(() => new Date())
    .$onUpdateFn(() => new Date())
    .notNull(),
};

export const users = sqliteTable('users', {
  ...commonColumns,
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash'),
  name: text('name').notNull(),
  isActive: integer('is_active', { mode: 'boolean' }).default(true).notNull(),
});

export const refreshTokens = sqliteTable(
  'refresh_tokens',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    token: text('token').notNull().unique(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => ({
    userIdIdx: index('rt_user_id_idx').on(table.userId),
  })
);

export const userExternalAccounts = sqliteTable(
  'user_external_accounts',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(), // 'google', 'github'
    externalId: text('external_id').notNull(),
    email: text('email'),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => ({
    providerExternalIdUniqueIdx: uniqueIndex('uex_provider_ext_uidx').on(
      table.provider,
      table.externalId
    ),
    userIdIdx: index('uex_user_id_idx').on(table.userId),
  })
);

export const threads = sqliteTable(
  'threads',
  {
    ...commonColumns,
    title: text('title').notNull(),
    content: text('content').notNull(),
    authorId: text('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
  },
  (table) => ({
    authorIdIdx: index('threads_author_id_idx').on(table.authorId),
  })
);

export const comments = sqliteTable(
  'comments',
  {
    ...commonColumns,
    threadId: text('thread_id')
      .notNull()
      .references(() => threads.id, { onDelete: 'cascade' }),
    parentId: text('parent_id').references((): any => comments.id, { onDelete: 'cascade' }),
    content: text('content').notNull(),
    authorId: text('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
  },
  (table) => ({
    threadIdIdx: index('comments_thread_id_idx').on(table.threadId),
    authorIdIdx: index('comments_author_id_idx').on(table.authorId),
  })
);

export const repositories = sqliteTable('repositories', {
  ...commonColumns,
  name: text('name').notNull(),
  localPath: text('local_path').notNull(),
  branch: text('branch').default('main').notNull(),
  allowed: integer('allowed', { mode: 'boolean' }).default(true).notNull(),
  queueEnabled: integer('queue_enabled', { mode: 'boolean' }).default(false).notNull(),
  maxConcurrentSessions: integer('max_concurrent_sessions').default(1).notNull(),
  safetyPolicy: text('safety_policy', { mode: 'json' }).$type<{
    allowedPaths?: string[];
    deniedPaths?: string[];
    blockedCommands?: string[];
    maxCommandSeconds?: number;
    requireReadBeforeEdit?: boolean;
    maxTimeSeconds?: number;
  }>(),
});

export const tasks = sqliteTable(
  'tasks',
  {
    ...commonColumns,
    repositoryId: text('repository_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description'),
    objective: text('objective'),
    acceptanceCriteria: text('acceptance_criteria'),
    status: text('status').default('draft').notNull(), // draft | ready | context_compiling | queued | running | verifying | needs_review | completed | blocked | failed | timed_out | cancelled | needs_human
    compiledPrompt: text('compiled_prompt'),
    timeoutSeconds: integer('timeout_seconds').default(3600).notNull(),
    priority: integer('priority').default(0).notNull(),
    createdBy: text('created_by'),
  },
  (table) => ({
    repositoryIdIdx: index('tasks_repository_id_idx').on(table.repositoryId),
  })
);

export const taskRuns = sqliteTable(
  'task_runs',
  {
    ...commonColumns,
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    repositoryId: text('repository_id').references(() => repositories.id, { onDelete: 'cascade' }),
    status: text('status').default('running').notNull(), // running | context_compiling | finalizing | completed | failed | cancelled | needs_review | blocked | timed_out | needs_human
    workerKind: text('worker_kind').default('native-local-worker').notNull(),
    baseRef: text('base_ref'),
    worktreePath: text('worktree_path'),
    timeoutSeconds: integer('timeout_seconds').default(3600).notNull(),
    contextSnapshot: text('context_snapshot', { mode: 'json' }),
    summary: text('summary'),
    finalReport: text('final_report'),
    finalJudgment: text('final_judgment', { mode: 'json' }),
    startedAt: integer('started_at', { mode: 'timestamp' })
      .$defaultFn(() => new Date())
      .notNull(),
    endedAt: integer('ended_at', { mode: 'timestamp' }),
    finishedAt: integer('finished_at', { mode: 'timestamp' }),
    logContent: text('log_content'),
    diffPatch: text('diff_patch'),
    testResults: text('test_results', { mode: 'json' }),
  },
  (table) => ({
    taskIdIdx: index('task_runs_task_id_idx').on(table.taskId),
  })
);

export const implementationQueueEntries = sqliteTable(
  'implementation_queue_entries',
  {
    ...commonColumns,
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    repositoryId: text('repository_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    status: text('status').default('queued').notNull(),
    priority: integer('priority').default(0).notNull(),
    queuePosition: integer('queue_position'),
    processorSlot: integer('processor_slot'),
    activeRunId: text('active_run_id').references(() => taskRuns.id, { onDelete: 'set null' }),
    claimedAt: integer('claimed_at', { mode: 'timestamp' }),
    lastHeartbeatAt: integer('last_heartbeat_at', { mode: 'timestamp' }),
    archivedAt: integer('archived_at', { mode: 'timestamp' }),
    statusReason: text('status_reason'),
  },
  (table) => ({
    taskIdIdx: index('implementation_queue_entries_task_id_idx').on(table.taskId),
    repositoryStatusIdx: index('implementation_queue_entries_repository_status_idx').on(
      table.repositoryId,
      table.status
    ),
    claimOrderIdx: index('implementation_queue_entries_claim_order_idx').on(
      table.status,
      table.priority,
      table.queuePosition,
      table.createdAt
    ),
  })
);

export const implementationQueueSettings = sqliteTable('implementation_queue_settings', {
  id: text('id').primaryKey(),
  processorCount: integer('processor_count').default(1).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .$defaultFn(() => new Date())
    .notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .$defaultFn(() => new Date())
    .$onUpdateFn(() => new Date())
    .notNull(),
});

export const todoWorkflowSettings = sqliteTable('todo_workflow_settings', {
  id: text('id').primaryKey(),
  requirePerTodoReview: integer('require_per_todo_review', { mode: 'boolean' })
    .default(true)
    .notNull(),
  requirePerTodoFix: integer('require_per_todo_fix', { mode: 'boolean' }).default(true).notNull(),
  requireFinalVerification: integer('require_final_verification', { mode: 'boolean' })
    .default(true)
    .notNull(),
  askCommitOnCompletion: integer('ask_commit_on_completion', { mode: 'boolean' })
    .default(true)
    .notNull(),
  hookPolicyJson: text('hook_policy_json', { mode: 'json' }),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .$defaultFn(() => new Date())
    .notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .$defaultFn(() => new Date())
    .$onUpdateFn(() => new Date())
    .notNull(),
});

export const taskRunTodos = sqliteTable(
  'task_run_todos',
  {
    ...commonColumns,
    runId: text('run_id')
      .notNull()
      .references(() => taskRuns.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    taskType: text('task_type').notNull(),
    status: text('status').default('pending').notNull(),
    procedureId: text('procedure_id'),
    procedureSnapshot: text('procedure_snapshot', { mode: 'json' }),
    contextSnapshot: text('context_snapshot', { mode: 'json' }),
    completionGateResult: text('completion_gate_result', { mode: 'json' }),
    dependsOn: text('depends_on', { mode: 'json' }).$type<Array<string | number>>(),
    statusReason: text('status_reason'),
    startedAt: integer('started_at', { mode: 'timestamp' }),
    completedAt: integer('completed_at', { mode: 'timestamp' }),
  },
  (table) => ({
    runIdIdx: index('task_run_todos_run_id_idx').on(table.runId),
    runSeqUniqueIdx: uniqueIndex('task_run_todos_run_seq_uidx').on(table.runId, table.seq),
  })
);

export const taskEvents = sqliteTable(
  'task_events',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    taskRunId: text('task_run_id')
      .notNull()
      .references(() => taskRuns.id, { onDelete: 'cascade' }),
    seq: integer('seq').default(0).notNull(),
    actor: text('actor').default('system').notNull(), // system | supervisor | worker | human
    eventType: text('event_type'), // info | warning | error | checkpoint | state_change | tool_call | tool_result | supervisor_decision | final_report
    type: text('type').notNull(), // info | warning | error | checkpoint | state_change
    message: text('message').notNull(),
    payloadJson: text('payload_json', { mode: 'json' }),
    timestamp: integer('timestamp', { mode: 'timestamp' })
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => ({
    taskRunIdIdx: index('task_events_task_run_id_idx').on(table.taskRunId),
  })
);

export const artifacts = sqliteTable(
  'artifacts',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    runId: text('run_id')
      .notNull()
      .references(() => taskRuns.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(), // e.g. diff | log | file | patch
    path: text('path').notNull(),
    metadataJson: text('metadata_json', { mode: 'json' }),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => ({
    runIdIdx: index('artifacts_run_id_idx').on(table.runId),
  })
);

export const activityArtifacts = sqliteTable(
  'activity_artifacts',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    runId: text('run_id').references(() => taskRuns.id, { onDelete: 'set null' }),
    kind: text('kind').notNull(),
    path: text('path'),
    contentText: text('content_text'),
    metadataJson: text('metadata_json', { mode: 'json' }),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => ({
    taskIdIdx: index('activity_artifacts_task_id_idx').on(table.taskId),
    runIdIdx: index('activity_artifacts_run_id_idx').on(table.runId),
    kindCreatedAtIdx: index('activity_artifacts_kind_created_at_idx').on(
      table.kind,
      table.createdAt
    ),
  })
);

export const activityEvents = sqliteTable(
  'activity_events',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    runId: text('run_id').references(() => taskRuns.id, { onDelete: 'set null' }),
    turnId: text('turn_id'),
    parentEventId: text('parent_event_id'),
    seq: integer('seq').notNull(),
    runSeq: integer('run_seq'),
    kind: text('kind').notNull(),
    source: text('source').notNull(),
    status: text('status'),
    text: text('text'),
    payloadJson: text('payload_json', { mode: 'json' }),
    artifactId: text('artifact_id').references(() => activityArtifacts.id, {
      onDelete: 'set null',
    }),
    clientTempId: text('client_temp_id'),
    externalId: text('external_id'),
    dedupeKey: text('dedupe_key'),
    ingestError: text('ingest_error'),
    visibility: text('visibility').default('visible').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => ({
    taskSeqUniqueIdx: uniqueIndex('activity_events_task_seq_uidx').on(table.taskId, table.seq),
    taskCreatedAtIdx: index('activity_events_task_created_at_idx').on(
      table.taskId,
      table.createdAt
    ),
    runSeqIdx: index('activity_events_run_seq_idx').on(table.runId, table.runSeq),
    turnSeqIdx: index('activity_events_turn_seq_idx').on(table.turnId, table.seq),
    kindCreatedAtIdx: index('activity_events_kind_created_at_idx').on(table.kind, table.createdAt),
    artifactIdIdx: index('activity_events_artifact_id_idx').on(table.artifactId),
    dedupeKeyUniqueIdx: uniqueIndex('activity_events_dedupe_key_uidx').on(table.dedupeKey),
  })
);

export const taskMessages = sqliteTable(
  'task_messages',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    runId: text('run_id').references(() => taskRuns.id, { onDelete: 'set null' }),
    role: text('role').notNull(), // user | assistant | system | tool
    content: text('content').notNull(),
    messageType: text('message_type'), // text | chart | browser | playwright | flow | markdown_document
    metadataJson: text('metadata_json', { mode: 'json' }),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => ({
    taskIdIdx: index('task_messages_task_id_idx').on(table.taskId),
    runIdIdx: index('task_messages_run_id_idx').on(table.runId),
  })
);

export const blueprintDesignSettings = sqliteTable(
  'blueprint_design_settings',
  {
    ...commonColumns,
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    settingsJson: text('settings_json', { mode: 'json' }).notNull(),
  },
  (table) => ({
    taskIdUniqueIdx: uniqueIndex('blueprint_design_settings_task_id_uidx').on(table.taskId),
  })
);

export const blueprintArtifactAdoptions = sqliteTable(
  'blueprint_artifact_adoptions',
  {
    ...commonColumns,
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    messageId: text('message_id')
      .notNull()
      .references(() => taskMessages.id, { onDelete: 'cascade' }),
    adopted: integer('adopted', { mode: 'boolean' }).default(false).notNull(),
  },
  (table) => ({
    taskIdIdx: index('blueprint_artifact_adoptions_task_id_idx').on(table.taskId),
    messageUniqueIdx: uniqueIndex('blueprint_artifact_adoptions_message_uidx').on(
      table.taskId,
      table.messageId
    ),
  })
);

export const blueprintDbDesignAdoptions = sqliteTable(
  'blueprint_db_design_adoptions',
  {
    ...commonColumns,
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    messageId: text('message_id')
      .notNull()
      .references(() => taskMessages.id, { onDelete: 'cascade' }),
    adopted: integer('adopted', { mode: 'boolean' }).default(false).notNull(),
  },
  (table) => ({
    taskIdIdx: index('blueprint_db_design_adoptions_task_id_idx').on(table.taskId),
    messageUniqueIdx: uniqueIndex('blueprint_db_design_adoptions_message_uidx').on(
      table.taskId,
      table.messageId
    ),
  })
);

export const blueprintDesignTokenAdoptions = sqliteTable(
  'blueprint_design_token_adoptions',
  {
    ...commonColumns,
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    messageId: text('message_id')
      .notNull()
      .references(() => taskMessages.id, { onDelete: 'cascade' }),
    adopted: integer('adopted', { mode: 'boolean' }).default(false).notNull(),
  },
  (table) => ({
    taskIdIdx: index('blueprint_design_token_adoptions_task_id_idx').on(table.taskId),
    messageUniqueIdx: uniqueIndex('blueprint_design_token_adoptions_message_uidx').on(
      table.taskId,
      table.messageId
    ),
  })
);
