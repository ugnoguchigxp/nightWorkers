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
  safetyPolicy: text('safety_policy', { mode: 'json' }).$type<{
    blockedCommands?: string[];
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
    status: text('status').default('draft').notNull(), // draft | ready | compiling_context | running | verifying | needs_review | completed | blocked | failed | timed_out | cancelled | needs_human
    compiledPrompt: text('compiled_prompt'),
    timeoutSeconds: integer('timeout_seconds').default(3600).notNull(),
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
    status: text('status').default('running').notNull(), // running | completed | failed | cancelled
    startedAt: integer('started_at', { mode: 'timestamp' })
      .$defaultFn(() => new Date())
      .notNull(),
    endedAt: integer('ended_at', { mode: 'timestamp' }),
    logContent: text('log_content'),
    diffPatch: text('diff_patch'),
    testResults: text('test_results', { mode: 'json' }),
    contextEval: text('context_eval', { mode: 'json' }),
  },
  (table) => ({
    taskIdIdx: index('task_runs_task_id_idx').on(table.taskId),
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
    type: text('type').notNull(), // info | warning | error | checkpoint | state_change
    message: text('message').notNull(),
    timestamp: integer('timestamp', { mode: 'timestamp' })
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => ({
    taskRunIdIdx: index('task_events_task_run_id_idx').on(table.taskRunId),
  })
);
