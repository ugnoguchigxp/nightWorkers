import { z } from 'zod';
import {
  type DesignDecisionReview,
  type DesignQuestionnaire,
  type DesignQuestionnaireAnswer,
  type DesignQuestionnaireFollowUpDecision,
  designDecisionReviewSchema,
  designQuestionnaireAnswerSchema,
  designQuestionnaireFollowUpDecisionSchema,
  designQuestionnaireSchema,
  type QuestionnaireChoiceForm,
  questionnaireChoiceFormSchema,
} from '../../../shared/schemas/design-questionnaire.schema';
import { NotFoundError } from '../../lib/errors';
import {
  jsonFixWrapper,
  parseRepairedJsonWithSchema,
} from '../../services/supervisor/llm-provider/json';
import * as repo from './nightworkers.repository';

export type DesignQuestionnaireSourceFallback = {
  taskId: string;
  repositoryId: string;
  sourceBlueprintMessageId?: string | null;
  sourceKind: 'blueprint' | 'plan_mode_intake';
};

export function parseDesignQuestionnaireRaw(
  rawOutput: string,
  fallbackSource?: DesignQuestionnaireSourceFallback
): { ok: true; value: DesignQuestionnaire } | { ok: false; error: unknown } {
  const choiceForm = parseRepairedJsonWithSchema(rawOutput, questionnaireChoiceFormSchema);
  if (choiceForm.ok) {
    return {
      ok: true,
      value: adaptQuestionnaireChoiceForm(choiceForm.value, fallbackSource),
    };
  }

  const v1 = parseRepairedJsonWithSchema(rawOutput, designQuestionnaireSchema);
  if (v1.ok) return { ok: true, value: v1.value };

  const jsonFix = jsonFixWrapper(rawOutput);
  if (!jsonFix) return { ok: false, error: choiceForm.error };

  const normalized = normalizeLegacyDesignQuestionnaireOutput(jsonFix.parsedJson, fallbackSource);
  if (!normalized) return { ok: false, error: v1.error };
  try {
    return { ok: true, value: designQuestionnaireSchema.parse(normalized) };
  } catch (error) {
    return { ok: false, error };
  }
}

function adaptQuestionnaireChoiceForm(
  form: QuestionnaireChoiceForm,
  fallbackSource?: DesignQuestionnaireSourceFallback,
  options?: {
    questionSetId?: string;
    questionIdPrefix?: string;
    category?: string;
    purpose?: string;
    summary?: string;
  }
): DesignQuestionnaire {
  if (!fallbackSource?.taskId || !fallbackSource.repositoryId) {
    throw new Error('Questionnaire choice form requires server-side source fallback.');
  }
  const questionSetId = options?.questionSetId || 'choice-form';
  const questionIdPrefix = options?.questionIdPrefix || 'q';
  const category = options?.category || '実装前確認';
  return {
    version: 1,
    source: {
      taskId: fallbackSource.taskId,
      repositoryId: fallbackSource.repositoryId,
      sourceKind: fallbackSource.sourceKind,
      blueprintMessageId: fallbackSource.sourceBlueprintMessageId || null,
    },
    title: form.title,
    summary: options?.summary || '実装前に決めたい項目を選択式で確認します。',
    questionSets: [
      {
        id: questionSetId,
        title: form.title,
        category,
        purpose: options?.purpose || '実装に入る前に、未決定の仕様判断を選択式で確定します。',
        questions: form.questions.map((question, questionIndex) => {
          const questionId =
            questionIdPrefix === 'q'
              ? `q${questionIndex + 1}`
              : `${questionIdPrefix}-q${questionIndex + 1}`;
          return {
            id: questionId,
            topic: `Question ${questionIndex + 1}`,
            question: question.text,
            why: '実装前に仕様判断が必要です。',
            answerType: question.type === 'checkbox' ? 'multi_choice' : 'single_choice',
            options: question.options.map((label, optionIndex) => ({
              id: `${questionId}-o${optionIndex + 1}`,
              label,
              tradeoff: '選択後に設計判断として整理します。',
            })),
            blocks: ['実装前の仕様判断'],
            outputSection: `question-${questionIndex + 1}`,
          };
        }),
      },
    ],
    openQuestions: [],
    dbDesignHandoffNotes: [],
  };
}

function normalizeLegacyDesignQuestionnaireOutput(
  value: unknown,
  fallbackSource?: DesignQuestionnaireSourceFallback
): unknown | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, any>;
  const questions = Array.isArray(raw.questions) ? raw.questions.filter(isRecord) : [];
  if (questions.length === 0) return null;
  const source = isRecord(raw.source) ? raw.source : {};
  const taskId = stringOrNull(source.taskId) || stringOrNull(raw.taskId) || fallbackSource?.taskId;
  const repositoryId =
    stringOrNull(source.repositoryId) ||
    stringOrNull(raw.repositoryId) ||
    fallbackSource?.repositoryId;
  if (!taskId || !repositoryId) return null;

  const grouped = new Map<string, Record<string, any>[]>();
  for (const question of questions) {
    const category = firstNonEmptyString(question.category, question.outputSection, '仕様確認');
    const key = toKebabId(category, `section-${grouped.size + 1}`);
    grouped.set(key, [...(grouped.get(key) || []), question]);
  }

  return {
    version: 1,
    source: {
      taskId,
      repositoryId,
      sourceKind:
        stringOrNull(source.sourceKind) || fallbackSource?.sourceKind || 'plan_mode_intake',
      blueprintMessageId:
        stringOrNull(source.blueprintMessageId) || fallbackSource?.sourceBlueprintMessageId || null,
    },
    title: firstNonEmptyString(raw.title, 'Design Questionnaire'),
    summary: firstNonEmptyString(raw.summary, '実装前に未決定仕様を確認します。'),
    questionSets: [...grouped.entries()].map(([id, group], index) => {
      const category = firstNonEmptyString(
        group[0]?.category,
        group[0]?.outputSection,
        `Section ${index + 1}`
      );
      return {
        id,
        title: category,
        category,
        purpose: `Resolve ${category} decisions before implementation.`,
        questions: group.map((question, questionIndex) =>
          normalizeLegacyQuestion(question, questionIndex)
        ),
      };
    }),
    openQuestions: [],
    dbDesignHandoffNotes: normalizeLegacyDbDesignHandoffNotes(raw.dbDesignHandoffNotes, questions),
  };
}

function normalizeLegacyQuestion(question: Record<string, any>, index: number) {
  const choices = Array.isArray(question.choices) ? question.choices.filter(isRecord) : [];
  const options = choices.map((choice, choiceIndex) => {
    const label = firstNonEmptyString(choice.label, choice.title, `Option ${choiceIndex + 1}`);
    const recommended =
      stringOrNull(question.recommendedAnswer) === label ||
      stringOrNull(question.recommendedAnswerId) === stringOrNull(choice.id) ||
      Boolean(choice.recommended);
    return {
      id: toKebabId(firstNonEmptyString(choice.id, label), `option-${choiceIndex + 1}`),
      label,
      tradeoff: firstNonEmptyString(
        choice.tradeoff,
        choice.description,
        '選択時の影響を確認してください。'
      ),
      ...(recommended ? { recommended: true } : {}),
    };
  });
  const recommendedOption = options.find((option) => option.recommended);
  const answerType = options.length > 0 ? 'single_choice' : 'free_text';
  return {
    id: toKebabId(
      firstNonEmptyString(question.id, question.topic, `question-${index + 1}`),
      `question-${index + 1}`
    ),
    topic: firstNonEmptyString(
      question.topic,
      question.category,
      question.outputSection,
      `Question ${index + 1}`
    ),
    question: firstNonEmptyString(question.question, question.title, `Question ${index + 1}`),
    why: firstNonEmptyString(question.why, question.reason, '実装前に仕様判断が必要です。'),
    answerType,
    ...(recommendedOption ? { recommendedAnswerId: recommendedOption.id } : {}),
    ...(options.length > 0 ? { options } : {}),
    allowsCustomAnswer: true,
    blocks: normalizeStringArray(question.blocks, ['実装方針']),
    outputSection: firstNonEmptyString(question.outputSection, question.category, 'specification'),
  };
}

function normalizeLegacyDbDesignHandoffNotes(value: unknown, questions: Record<string, any>[]) {
  const notes = Array.isArray(value) ? value : [];
  const firstQuestionId = toKebabId(
    firstNonEmptyString(questions[0]?.id, 'question-1'),
    'question-1'
  );
  return notes.map((note, index) => {
    if (isRecord(note)) {
      return {
        id: toKebabId(
          firstNonEmptyString(note.id, note.summary, `db-note-${index + 1}`),
          `db-note-${index + 1}`
        ),
        summary: firstNonEmptyString(note.summary, note.constraint, `DB Design note ${index + 1}`),
        sourceQuestionIds: normalizeStringArray(note.sourceQuestionIds, [firstQuestionId]).map(
          (id, idIndex) => toKebabId(id, `question-${idIndex + 1}`)
        ),
        constraint: firstNonEmptyString(
          note.constraint,
          note.summary,
          `DB Design note ${index + 1}`
        ),
      };
    }
    return {
      id: `db-note-${index + 1}`,
      summary: String(note || `DB Design note ${index + 1}`),
      sourceQuestionIds: [firstQuestionId],
      constraint: String(note || `DB Design note ${index + 1}`),
    };
  });
}

function firstNonEmptyString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function stringOrNull(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeStringArray(value: unknown, fallback: string[]) {
  if (!Array.isArray(value)) return fallback;
  const strings = value.filter(
    (item): item is string => typeof item === 'string' && Boolean(item.trim())
  );
  return strings.length > 0 ? strings : fallback;
}

function toKebabId(value: string, fallback: string) {
  const normalized = value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || fallback;
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function parseDesignDecisionReviewRaw(
  rawOutput: string
): { ok: true; value: DesignDecisionReview } | { ok: false; error: unknown } {
  try {
    return { ok: true, value: designDecisionReviewSchema.parse(JSON.parse(rawOutput)) };
  } catch (error) {
    return { ok: false, error };
  }
}

export function parseDesignQuestionnaireFollowUpDecisionRaw(
  rawOutput: string,
  fallbackSource: DesignQuestionnaireSourceFallback,
  nextSequence: number
):
  | {
      ok: true;
      value: {
        action: DesignQuestionnaireFollowUpDecision['action'];
        rationale: string;
        questionnaire: DesignQuestionnaire | null;
      };
    }
  | { ok: false; error: unknown } {
  const decision = parseRepairedJsonWithSchema(
    rawOutput,
    designQuestionnaireFollowUpDecisionSchema
  );
  if (!decision.ok) return { ok: false, error: decision.error };
  return {
    ok: true,
    value: {
      ...decision.value,
      questionnaire: decision.value.questionnaire
        ? adaptQuestionnaireChoiceForm(decision.value.questionnaire, fallbackSource, {
            questionSetId: `follow-up-${nextSequence}`,
            questionIdPrefix: `follow-up-${nextSequence}`,
            category: '追質問',
            purpose: '回答内容から残った仕様の曖昧さを追加確認します。',
            summary: '回答後に残った未決定事項を選択式で追加確認します。',
          })
        : null,
    },
  };
}

export async function buildDesignQuestionnaireSessionView(sessionId: string) {
  const session = await repo.getDesignQuestionnaireSession(sessionId);
  if (!session) throw new NotFoundError('Questionnaire session not found');
  const [questionSets, answers, reviews] = await Promise.all([
    repo.listDesignQuestionnaireQuestionSets(sessionId),
    repo.listDesignQuestionnaireAnswers(sessionId),
    repo.listDesignQuestionnaireReviews(sessionId),
  ]);
  return {
    id: session.id,
    taskId: session.taskId,
    repositoryId: session.repositoryId,
    sourceBlueprintMessageId: session.sourceBlueprintMessageId,
    status: session.status as any,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    questionSets: questionSets.map((set) => ({
      id: set.id,
      sequence: set.sequence,
      questionnaire: set.questionnaireJson
        ? designQuestionnaireSchema.safeParse(set.questionnaireJson).success
          ? designQuestionnaireSchema.parse(set.questionnaireJson)
          : null
        : null,
      rawOutput: set.rawOutput,
      validationStatus: set.validationStatus as 'valid' | 'invalid',
      createdAt: set.createdAt,
    })),
    answers: answers.map((answer) => ({
      id: answer.id,
      questionId: answer.questionId,
      answer: designQuestionnaireAnswerSchema.parse(answer.answerJson),
      answeredAt: answer.answeredAt,
    })),
    reviews: reviews.map((review) => ({
      id: review.id,
      review: review.reviewJson
        ? designDecisionReviewSchema.safeParse(review.reviewJson).success
          ? designDecisionReviewSchema.parse(review.reviewJson)
          : null
        : null,
      publishedMessageId: review.publishedMessageId,
      status: review.status as 'draft' | 'accepted' | 'needs_edit' | 'left_unadopted',
      createdAt: review.createdAt,
      updatedAt: review.updatedAt,
    })),
  };
}

export function getSessionQuestions(session: any) {
  return session.questionSets.flatMap((set: any) =>
    (set.questionnaire?.questionSets || []).flatMap((questionSet: any) => questionSet.questions)
  );
}

export function getAnswerableSessionQuestions(
  session: any,
  answers: Array<{ questionId: string; answer: DesignQuestionnaireAnswer }>
) {
  const answerByQuestionId = new Map(answers.map((answer) => [answer.questionId, answer.answer]));
  return getSessionQuestions(session).filter((question: any) =>
    isDesignQuestionDependencySatisfied(question, answerByQuestionId)
  );
}

function isDesignQuestionDependencySatisfied(
  question: any,
  answerByQuestionId: Map<string, DesignQuestionnaireAnswer>
) {
  const dependencies = Array.isArray(question.dependsOn) ? question.dependsOn : [];
  return dependencies.every((dependency: any) => {
    const answer = answerByQuestionId.get(String(dependency.questionId));
    if (!answer) return false;
    return evaluateDesignQuestionDependency(answer, dependency);
  });
}

function evaluateDesignQuestionDependency(answer: DesignQuestionnaireAnswer, dependency: any) {
  const expected = dependency.value;
  const values = [
    ...answer.selectedOptionIds,
    ...answer.rankedOptionIds,
    ...(answer.freeText?.trim() ? [answer.freeText.trim()] : []),
  ];
  const hasExpectedString = Array.isArray(expected)
    ? expected.some((value) => values.includes(String(value)))
    : values.includes(String(expected));
  if (typeof expected === 'boolean') {
    if (dependency.operator === 'equals') return answer.booleanValue === expected;
    if (dependency.operator === 'not_equals') return answer.booleanValue !== expected;
    return false;
  }
  if (dependency.operator === 'equals' || dependency.operator === 'includes') {
    return hasExpectedString;
  }
  if (dependency.operator === 'not_equals' || dependency.operator === 'excludes') {
    return !hasExpectedString;
  }
  return false;
}

export function renderDesignDecisionReviewMarkdown(review: DesignDecisionReview) {
  const lines = [`# ${review.title}`, '', review.summary, ''];
  lines.push('## Decisions');
  if (review.decisions.length === 0) lines.push('- No decisions yet.');
  for (const decision of review.decisions) {
    lines.push(`- **${decision.outputSection}**: ${decision.decision}`);
    lines.push(`  - Rationale: ${decision.rationale}`);
    if (decision.tradeoffs.length > 0)
      lines.push(`  - Tradeoffs: ${decision.tradeoffs.join('; ')}`);
    lines.push(`  - Source questions: ${decision.sourceQuestionIds.join(', ')}`);
  }
  lines.push('', '## Deferred');
  if (review.deferredItems.length === 0) lines.push('- None.');
  for (const item of review.deferredItems) {
    lines.push(`- ${item.topic}: ${item.reason}`);
  }
  lines.push('', '## Unresolved');
  if (review.unresolvedQuestions.length === 0) lines.push('- None.');
  for (const item of review.unresolvedQuestions) {
    lines.push(`- ${item.topic}: ${item.reason}`);
  }
  lines.push('', '## DB Design Handoff');
  if (review.dbDesignHandoffNotes.length === 0) lines.push('- None.');
  for (const note of review.dbDesignHandoffNotes) {
    lines.push(`- ${note.summary}: ${note.constraint}`);
  }
  return lines.join('\n');
}

export const questionnaireChoiceFormJsonSchema = z.toJSONSchema(questionnaireChoiceFormSchema);
export const designQuestionnaireFollowUpDecisionJsonSchema = z.toJSONSchema(
  designQuestionnaireFollowUpDecisionSchema
);

export const designDecisionReviewJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'version',
    'sessionId',
    'sourceBlueprintMessageId',
    'title',
    'summary',
    'decisions',
    'deferredItems',
    'unresolvedQuestions',
    'dbDesignHandoffNotes',
  ],
  properties: {
    version: { type: 'integer', const: 1 },
    sessionId: { type: 'string' },
    sourceBlueprintMessageId: { type: ['string', 'null'] },
    title: { type: 'string' },
    summary: { type: 'string' },
    decisions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'id',
          'outputSection',
          'decision',
          'rationale',
          'alternativesConsidered',
          'tradeoffs',
          'sourceQuestionIds',
          'unresolvedQuestionIds',
        ],
        properties: {
          id: { type: 'string' },
          outputSection: { type: 'string' },
          decision: { type: 'string' },
          rationale: { type: 'string' },
          alternativesConsidered: { type: 'array', items: { type: 'string' } },
          tradeoffs: { type: 'array', items: { type: 'string' } },
          sourceQuestionIds: { type: 'array', items: { type: 'string' } },
          unresolvedQuestionIds: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    deferredItems: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'topic', 'reason', 'blocks'],
        properties: {
          id: { type: 'string' },
          topic: { type: 'string' },
          reason: { type: 'string' },
          blocks: { type: 'array', items: { type: 'string' } },
          suggestedOwner: {
            type: 'string',
            enum: ['user', 'designer', 'engineer', 'db-design', 'later'],
          },
        },
      },
    },
    unresolvedQuestions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'topic', 'reason', 'blocks'],
        properties: {
          id: { type: 'string' },
          topic: { type: 'string' },
          reason: { type: 'string' },
          blocks: { type: 'array', items: { type: 'string' } },
          suggestedOwner: {
            type: 'string',
            enum: ['user', 'designer', 'engineer', 'db-design', 'later'],
          },
        },
      },
    },
    dbDesignHandoffNotes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'summary', 'sourceQuestionIds', 'constraint'],
        properties: {
          id: { type: 'string' },
          summary: { type: 'string' },
          sourceQuestionIds: { type: 'array', items: { type: 'string' } },
          constraint: { type: 'string' },
        },
      },
    },
  },
};
