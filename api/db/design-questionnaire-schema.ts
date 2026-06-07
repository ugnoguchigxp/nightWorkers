import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { commonColumns, repositories, taskMessages, tasks } from './schema';

export const designQuestionnaireSessions = sqliteTable(
  'design_questionnaire_sessions',
  {
    ...commonColumns,
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    repositoryId: text('repository_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    sourceBlueprintMessageId: text('source_blueprint_message_id').references(
      () => taskMessages.id,
      {
        onDelete: 'cascade',
      }
    ),
    status: text('status').default('draft').notNull(),
  },
  (table) => ({
    taskIdx: index('design_questionnaire_sessions_task_idx').on(table.taskId),
    repositoryIdx: index('design_questionnaire_sessions_repository_idx').on(table.repositoryId),
    sourceBlueprintIdx: index('design_questionnaire_sessions_source_blueprint_idx').on(
      table.sourceBlueprintMessageId
    ),
  })
);

export const designQuestionnaireQuestionSets = sqliteTable(
  'design_questionnaire_question_sets',
  {
    ...commonColumns,
    sessionId: text('session_id')
      .notNull()
      .references(() => designQuestionnaireSessions.id, { onDelete: 'cascade' }),
    sequence: integer('sequence').notNull(),
    questionnaireJson: text('questionnaire_json', { mode: 'json' }),
    rawOutput: text('raw_output'),
    validationStatus: text('validation_status').default('valid').notNull(),
  },
  (table) => ({
    sessionIdx: index('design_questionnaire_question_sets_session_idx').on(table.sessionId),
    sessionSequenceUniqueIdx: uniqueIndex('design_questionnaire_question_sets_sequence_uidx').on(
      table.sessionId,
      table.sequence
    ),
  })
);

export const designQuestionnaireAnswers = sqliteTable(
  'design_questionnaire_answers',
  {
    ...commonColumns,
    sessionId: text('session_id')
      .notNull()
      .references(() => designQuestionnaireSessions.id, { onDelete: 'cascade' }),
    questionId: text('question_id').notNull(),
    answerJson: text('answer_json', { mode: 'json' }).notNull(),
    answeredAt: integer('answered_at', { mode: 'timestamp' })
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => ({
    sessionIdx: index('design_questionnaire_answers_session_idx').on(table.sessionId),
    sessionQuestionUniqueIdx: uniqueIndex('design_questionnaire_answers_question_uidx').on(
      table.sessionId,
      table.questionId
    ),
  })
);

export const designQuestionnaireReviews = sqliteTable(
  'design_questionnaire_reviews',
  {
    ...commonColumns,
    sessionId: text('session_id')
      .notNull()
      .references(() => designQuestionnaireSessions.id, { onDelete: 'cascade' }),
    reviewJson: text('review_json', { mode: 'json' }),
    publishedMessageId: text('published_message_id').references(() => taskMessages.id, {
      onDelete: 'set null',
    }),
    status: text('status').default('draft').notNull(),
  },
  (table) => ({
    sessionIdx: index('design_questionnaire_reviews_session_idx').on(table.sessionId),
    publishedMessageIdx: index('design_questionnaire_reviews_published_message_idx').on(
      table.publishedMessageId
    ),
  })
);
