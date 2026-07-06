import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { commonColumns, repositories, taskMessages, taskRuns, tasks } from './schema';

export const reviewRecommendations = sqliteTable(
  'review_recommendations',
  {
    ...commonColumns,
    runId: text('run_id')
      .notNull()
      .references(() => taskRuns.id, { onDelete: 'cascade' }),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    repositoryId: text('repository_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    level: text('level').notNull(),
    defaultAction: text('default_action').notNull(),
    reasonsJson: text('reasons_json', { mode: 'json' }).$type<unknown[]>().notNull(),
  },
  (table) => ({
    runIdIdx: uniqueIndex('review_recommendations_run_uidx').on(table.runId),
    taskIdx: index('review_recommendations_task_idx').on(table.taskId),
    repositoryLevelIdx: index('review_recommendations_repository_level_idx').on(
      table.repositoryId,
      table.level
    ),
  })
);

export const reviewSessions = sqliteTable(
  'review_sessions',
  {
    ...commonColumns,
    runId: text('run_id')
      .notNull()
      .references(() => taskRuns.id, { onDelete: 'cascade' }),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    repositoryId: text('repository_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    status: text('status').default('not_started').notNull(),
    recommendationId: text('recommendation_id').references(() => reviewRecommendations.id, {
      onDelete: 'set null',
    }),
    startedAt: integer('started_at', { mode: 'timestamp' }),
    completedAt: integer('completed_at', { mode: 'timestamp' }),
    finalAction: text('final_action'),
    finalNote: text('final_note'),
  },
  (table) => ({
    runIdIdx: uniqueIndex('review_sessions_run_uidx').on(table.runId),
    taskStatusIdx: index('review_sessions_task_status_idx').on(table.taskId, table.status),
  })
);

export const reviewArtifacts = sqliteTable(
  'review_artifacts',
  {
    ...commonColumns,
    reviewSessionId: text('review_session_id')
      .notNull()
      .references(() => reviewSessions.id, { onDelete: 'cascade' }),
    runId: text('run_id')
      .notNull()
      .references(() => taskRuns.id, { onDelete: 'cascade' }),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    status: text('status').default('not_started').notNull(),
    artifactJson: text('artifact_json', { mode: 'json' }),
    sourceEvidenceRefsJson: text('source_evidence_refs_json', { mode: 'json' })
      .$type<unknown[]>()
      .notNull(),
  },
  (table) => ({
    sessionKindIdx: uniqueIndex('review_artifacts_session_kind_uidx').on(
      table.reviewSessionId,
      table.kind
    ),
    runKindIdx: index('review_artifacts_run_kind_idx').on(table.runId, table.kind),
  })
);

export const reviewFindings = sqliteTable(
  'review_findings',
  {
    ...commonColumns,
    reviewSessionId: text('review_session_id')
      .notNull()
      .references(() => reviewSessions.id, { onDelete: 'cascade' }),
    runId: text('run_id')
      .notNull()
      .references(() => taskRuns.id, { onDelete: 'cascade' }),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    severity: text('severity').notNull(),
    title: text('title').notNull(),
    body: text('body'),
    disposition: text('disposition'),
    dispositionStatus: text('disposition_status').default('unresolved').notNull(),
    dispositionNote: text('disposition_note'),
    evidenceRefsJson: text('evidence_refs_json', { mode: 'json' }).$type<unknown[]>().notNull(),
    sourceSection: text('source_section'),
    createdGoalId: text('created_goal_id'),
    createdTaskProposalId: text('created_task_proposal_id'),
    contextStillCandidateId: text('context_still_candidate_id'),
  },
  (table) => ({
    sessionStatusIdx: index('review_findings_session_status_idx').on(
      table.reviewSessionId,
      table.dispositionStatus
    ),
    runSeverityIdx: index('review_findings_run_severity_idx').on(table.runId, table.severity),
  })
);

export const reviewKnowledgeCandidates = sqliteTable(
  'review_knowledge_candidates',
  {
    ...commonColumns,
    reviewSessionId: text('review_session_id')
      .notNull()
      .references(() => reviewSessions.id, { onDelete: 'cascade' }),
    findingId: text('finding_id')
      .notNull()
      .references(() => reviewFindings.id, { onDelete: 'cascade' }),
    candidateType: text('candidate_type').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    avoid: text('avoid'),
    prefer: text('prefer'),
    status: text('status').default('draft').notNull(),
    contextStillCandidateId: text('context_still_candidate_id'),
    sendError: text('send_error'),
  },
  (table) => ({
    sessionStatusIdx: index('review_knowledge_candidates_session_status_idx').on(
      table.reviewSessionId,
      table.status
    ),
    findingIdx: index('review_knowledge_candidates_finding_idx').on(table.findingId),
  })
);

export const reviewProposedGoals = sqliteTable(
  'review_proposed_goals',
  {
    ...commonColumns,
    reviewSessionId: text('review_session_id')
      .notNull()
      .references(() => reviewSessions.id, { onDelete: 'cascade' }),
    findingId: text('finding_id')
      .notNull()
      .references(() => reviewFindings.id, { onDelete: 'cascade' }),
    runId: text('run_id')
      .notNull()
      .references(() => taskRuns.id, { onDelete: 'cascade' }),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    repositoryId: text('repository_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    expectedOutcome: text('expected_outcome').notNull(),
    acceptanceCriteria: text('acceptance_criteria').notNull(),
    verificationGate: text('verification_gate').notNull(),
    evidenceRefsJson: text('evidence_refs_json', { mode: 'json' }).$type<unknown[]>().notNull(),
    status: text('status').default('draft').notNull(),
    decisionNote: text('decision_note'),
    materializedTaskId: text('materialized_task_id').references(() => tasks.id, {
      onDelete: 'set null',
    }),
    materializationTarget: text('materialization_target'),
    materializationError: text('materialization_error'),
  },
  (table) => ({
    sessionStatusIdx: index('review_proposed_goals_session_status_idx').on(
      table.reviewSessionId,
      table.status
    ),
    findingIdx: uniqueIndex('review_proposed_goals_finding_uidx').on(table.findingId),
  })
);

export const reviewPromptSuggestions = sqliteTable(
  'review_prompt_suggestions',
  {
    ...commonColumns,
    reviewSessionId: text('review_session_id')
      .notNull()
      .references(() => reviewSessions.id, { onDelete: 'cascade' }),
    findingId: text('finding_id')
      .notNull()
      .references(() => reviewFindings.id, { onDelete: 'cascade' }),
    runId: text('run_id')
      .notNull()
      .references(() => taskRuns.id, { onDelete: 'cascade' }),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    repositoryId: text('repository_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    prompt: text('prompt').notNull(),
    expectedOutcome: text('expected_outcome').notNull(),
    acceptanceCriteria: text('acceptance_criteria').notNull(),
    verificationHint: text('verification_hint').notNull(),
    evidenceRefsJson: text('evidence_refs_json', { mode: 'json' }).$type<unknown[]>().notNull(),
    status: text('status').default('draft').notNull(),
    useCount: integer('use_count').default(0).notNull(),
    lastUsedAt: integer('last_used_at', { mode: 'timestamp' }),
    dismissedAt: integer('dismissed_at', { mode: 'timestamp' }),
    createdMessageId: text('created_message_id').references(() => taskMessages.id, {
      onDelete: 'set null',
    }),
  },
  (table) => ({
    sessionStatusIdx: index('review_prompt_suggestions_session_status_idx').on(
      table.reviewSessionId,
      table.status
    ),
    findingIdx: uniqueIndex('review_prompt_suggestions_finding_uidx').on(table.findingId),
  })
);

export const reviewSecurityHandoffs = sqliteTable(
  'review_security_handoffs',
  {
    ...commonColumns,
    reviewSessionId: text('review_session_id')
      .notNull()
      .references(() => reviewSessions.id, { onDelete: 'cascade' }),
    findingId: text('finding_id')
      .notNull()
      .references(() => reviewFindings.id, { onDelete: 'cascade' }),
    runId: text('run_id')
      .notNull()
      .references(() => taskRuns.id, { onDelete: 'cascade' }),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    repositoryId: text('repository_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    summary: text('summary').notNull(),
    requestedIntegration: text('requested_integration'),
    status: text('status').default('needs_configuration').notNull(),
    changedPathsJson: text('changed_paths_json', { mode: 'json' }).$type<string[]>().notNull(),
    evidenceRefsJson: text('evidence_refs_json', { mode: 'json' }).$type<unknown[]>().notNull(),
    handoffArtifactJson: text('handoff_artifact_json', { mode: 'json' }),
  },
  (table) => ({
    sessionStatusIdx: index('review_security_handoffs_session_status_idx').on(
      table.reviewSessionId,
      table.status
    ),
    findingIdx: uniqueIndex('review_security_handoffs_finding_uidx').on(table.findingId),
  })
);
