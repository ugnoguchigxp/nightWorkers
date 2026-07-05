import type {
  DesignQuestionnaire,
  DesignQuestionnaireAnswer,
  QuestionnaireQuestionSetMetadata,
} from '../../../shared/schemas/design-questionnaire.schema';
import { AppError } from '../../lib/errors';
import {
  getAnswerableSessionQuestions,
  getSessionQuestions,
  toQuestionnaireDecisionKey,
} from './questionnaire-parser.service';

type JsonRecord = Record<string, unknown>;
type QuestionLike = {
  id?: unknown;
  answerType?: unknown;
  options?: unknown;
  question?: unknown;
  topic?: unknown;
  outputSection?: unknown;
  decisionKey?: unknown;
  blocking?: unknown;
  blockingReason?: unknown;
  blocks?: unknown;
};
type QuestionnaireSessionLike = {
  questionSets: Array<{ questionnaire: DesignQuestionnaire | null }>;
  answers?: Array<{ questionId: string; answer: DesignQuestionnaireAnswer }>;
};

export type QuestionnaireDecisionInventoryItem = {
  decisionKey: string;
  questionId: string;
  question: string;
  outputSection: string;
  optionSignature: string;
  answered: boolean;
  blocking: boolean;
};

export type UnansweredBlockingQuestion = {
  id: string;
  decisionKey: string;
  question: string;
};

export function validateDesignQuestionnaireAnswerForQuestion(
  answer: DesignQuestionnaireAnswer,
  question: QuestionLike
) {
  if (question.answerType === 'single_choice' && answer.selectedOptionIds.length > 1) {
    throw new AppError(
      422,
      'MULTIPLE_OPTIONS_FOR_SINGLE_CHOICE',
      `Question ${answer.questionId} accepts only one selected option.`
    );
  }

  const optionIds = new Set(
    (Array.isArray(question.options) ? question.options : [])
      .map((option) => (isRecord(option) ? String(option.id || '') : ''))
      .filter(Boolean)
  );
  const submittedOptionIds = [...answer.selectedOptionIds, ...answer.rankedOptionIds];
  const unknownOptionId = submittedOptionIds.find((optionId) => !optionIds.has(optionId));
  if (unknownOptionId) {
    throw new AppError(
      422,
      'UNKNOWN_OPTION',
      `Unknown option id for question ${answer.questionId}: ${unknownOptionId}`
    );
  }
}

export function isDesignQuestionnaireAnswerComplete(
  question: QuestionLike,
  answer: DesignQuestionnaireAnswer | undefined
) {
  if (!answer) return false;
  if (answer.deferred) return true;
  if (question.answerType === 'multi_choice') return true;
  if (question.answerType === 'boolean') return answer.booleanValue !== undefined;
  if (question.answerType === 'free_text') return Boolean(answer.freeText?.trim());
  if (question.answerType === 'ranked') return answer.rankedOptionIds.length > 0;
  return answer.selectedOptionIds.length > 0;
}

export function removeDuplicateFollowUpQuestions(
  session: QuestionnaireSessionLike,
  questionnaire: DesignQuestionnaire
) {
  return removeDuplicateQuestionnaireQuestions(session, questionnaire).questionnaire;
}

export function removeDuplicateQuestionnaireQuestions(
  session: QuestionnaireSessionLike,
  questionnaire: DesignQuestionnaire
) {
  const existingQuestions = toRecordArray(getSessionQuestions(session));
  const answeredQuestionIds = new Set((session.answers || []).map((answer) => answer.questionId));
  const next = structuredClone(questionnaire) as JsonRecord;
  let candidateCount = 0;
  let keptCount = 0;
  next.questionSets = toRecordArray(next.questionSets)
    .map((set) => {
      const questions = toRecordArray(set.questions).filter((question) => {
        candidateCount += 1;
        return !existingQuestions.some((existing) =>
          isDuplicateQuestion(existing, question, {
            existingAnswered: answeredQuestionIds.has(String(existing.id || '')),
          })
        );
      });
      keptCount += questions.length;
      return { ...set, questions };
    })
    .filter((set) => set.questions.length > 0);
  return {
    questionnaire: keptCount > 0 ? (next as DesignQuestionnaire) : null,
    skippedDuplicateCount: Math.max(candidateCount - keptCount, 0),
  };
}

function isDuplicateQuestion(
  existing: QuestionLike,
  candidate: QuestionLike,
  options: { existingAnswered?: boolean } = {}
) {
  const existingKey = getQuestionDecisionKey(existing);
  const candidateKey = getQuestionDecisionKey(candidate);
  if (existingKey && candidateKey && existingKey === candidateKey) return true;

  const existingQuestion = normalizeQuestionText(existing.question || existing.topic || '');
  const candidateQuestion = normalizeQuestionText(candidate.question || candidate.topic || '');
  if (existingQuestion && candidateQuestion && existingQuestion === candidateQuestion) return true;

  const existingOptions = optionSignature(existing);
  const candidateOptions = optionSignature(candidate);
  if (existingOptions && candidateOptions && existingOptions === candidateOptions) return true;
  if (options.existingAnswered && isAnsweredQuestionSemanticDuplicate(existing, candidate)) {
    return true;
  }

  return false;
}

export function buildQuestionnaireDecisionInventory(
  session: QuestionnaireSessionLike
): QuestionnaireDecisionInventoryItem[] {
  const answeredQuestionIds = new Set((session.answers || []).map((answer) => answer.questionId));
  return getSessionQuestionRecords(session).map(({ question, metadata }) => ({
    decisionKey: getQuestionDecisionKey(question),
    questionId: String(question.id || ''),
    question: String(question.question || question.topic || ''),
    outputSection: String(question.outputSection || ''),
    optionSignature: optionSignature(question),
    answered: answeredQuestionIds.has(String(question.id || '')),
    blocking: getQuestionBlocking(question, metadata),
  }));
}

export function listUnansweredBlockingQuestions(
  session: QuestionnaireSessionLike
): UnansweredBlockingQuestion[] {
  const answers = (session.answers || []).map((answer) => ({
    questionId: answer.questionId,
    answer: answer.answer,
  }));
  const answerByQuestionId = new Map(answers.map((answer) => [answer.questionId, answer.answer]));
  const blockingByQuestionId = new Map(
    getSessionQuestionRecords(session).map(({ question, metadata }) => [
      String(question.id || ''),
      getQuestionBlocking(question, metadata),
    ])
  );
  return getAnswerableSessionQuestions(session, answers)
    .filter((question) => {
      const questionId = String(question.id || '');
      return (
        blockingByQuestionId.get(questionId) === true &&
        !isDesignQuestionnaireAnswerComplete(question, answerByQuestionId.get(questionId))
      );
    })
    .map((question) => ({
      id: String(question.id || ''),
      decisionKey: getQuestionDecisionKey(question),
      question: String(question.question || question.topic || ''),
    }));
}

export function getQuestionDecisionKey(question: QuestionLike) {
  if (typeof question.decisionKey === 'string' && question.decisionKey.trim()) {
    return toQuestionnaireDecisionKey(question.decisionKey, 'decision.unknown');
  }
  const outputSection = toQuestionnaireDecisionKey(String(question.outputSection || ''), 'section');
  const topic = toQuestionnaireDecisionKey(String(question.topic || ''), '');
  const questionId = toQuestionnaireDecisionKey(String(question.id || ''), '');
  const questionText = toQuestionnaireDecisionKey(String(question.question || ''), '');
  return ['legacy', outputSection, topic, questionText || questionId || 'question']
    .filter(Boolean)
    .join('.');
}

function getQuestionBlocking(
  question: QuestionLike,
  metadata?: QuestionnaireQuestionSetMetadata | null
) {
  if (typeof question.blocking === 'boolean') return question.blocking;
  if (metadata && typeof metadata.blocking === 'boolean') return metadata.blocking;
  return true;
}

function getSessionQuestionRecords(session: QuestionnaireSessionLike) {
  return session.questionSets.flatMap((set) =>
    (set.questionnaire?.questionSets || []).flatMap((questionSet) => {
      const metadata = questionSet.metadata || null;
      return questionSet.questions.map((question) => ({ question, metadata }));
    })
  );
}

function isAnsweredQuestionSemanticDuplicate(existing: QuestionLike, candidate: QuestionLike) {
  const existingOptions = optionLabelSet(existing);
  const candidateOptions = optionLabelSet(candidate);
  const optionOverlap = intersectionSize(existingOptions, candidateOptions);
  if (optionOverlap >= 2) return true;

  const existingText = questionSearchText(existing);
  const candidateText = questionSearchText(candidate);
  const termOverlap = intersectionSize(
    extractDecisionTerms(existingText),
    extractDecisionTerms(candidateText)
  );
  if (termOverlap >= 2) return true;

  return optionOverlap >= 1 && ngramSimilarity(existingText, candidateText) >= 0.18;
}

function optionSignature(question: QuestionLike) {
  return toRecordArray(question.options)
    .map((option) => normalizeQuestionText(option.label || option.id || ''))
    .filter(Boolean)
    .sort()
    .join('|');
}

function optionLabelSet(question: QuestionLike) {
  return new Set(
    toRecordArray(question.options)
      .map((option) => normalizeQuestionText(option.label || option.id || ''))
      .filter((label) => label && !isNeutralOptionLabel(label))
  );
}

function questionSearchText(question: QuestionLike) {
  return [
    question.question,
    question.topic,
    ...toRecordArray(question.options).map((option) => option.label || option.id || ''),
  ]
    .map((value) => normalizeQuestionText(value))
    .filter(Boolean)
    .join('');
}

function extractDecisionTerms(value: string) {
  const terms = [
    'api',
    'docker',
    'sqlite',
    'postgresql',
    'rag',
    'selfhosted',
    'クラウド',
    'バックアップ',
    'ブランチ',
    'テンプレート',
    'フィルタ',
    'モバイル',
    'ラベル',
    'リアルタイム',
    'ローカル',
    '移行',
    '運用',
    '永続',
    '外部連携',
    '開発',
    '監査ログ',
    '既存',
    '共有',
    '検索',
    '個人',
    '削除',
    '実行',
    '詳細',
    '認証',
    '通知',
    '配置',
    '標準',
    '復旧',
    '複数',
    '保存',
    '優先度',
    'ユーザー',
    'リポジトリ',
  ];
  return new Set(terms.filter((term) => value.includes(term)));
}

function ngramSimilarity(left: string, right: string) {
  const leftNgrams = ngrams(left);
  const rightNgrams = ngrams(right);
  if (leftNgrams.size === 0 || rightNgrams.size === 0) return 0;
  return intersectionSize(leftNgrams, rightNgrams) / Math.min(leftNgrams.size, rightNgrams.size);
}

function ngrams(value: string) {
  const normalized = normalizeQuestionText(value).replace(/未定|今回|機能|質問|どれ|ですか/g, '');
  const grams = new Set<string>();
  for (const size of [2, 3]) {
    for (let index = 0; index <= normalized.length - size; index += 1) {
      grams.add(normalized.slice(index, index + size));
    }
  }
  return grams;
}

function intersectionSize(left: Set<string>, right: Set<string>) {
  let count = 0;
  for (const value of left) {
    if (right.has(value)) count += 1;
  }
  return count;
}

function isNeutralOptionLabel(value: string) {
  return [
    '未定',
    '後続決定',
    'まだ決めない',
    '今回は不要',
    'どれも不要',
    '今回は特に外さない',
  ].includes(value);
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function toRecordArray(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function normalizeQuestionText(value: unknown) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[？?。．.、,\s]/g, '')
    .replace(/ください/g, '')
    .replace(/どれですか/g, '')
    .replace(/選んで/g, '')
    .replace(/含めたい/g, '含める')
    .replace(/含める/g, '含める')
    .trim();
}
