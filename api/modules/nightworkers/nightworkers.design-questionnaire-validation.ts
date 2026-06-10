import type { DesignQuestionnaireAnswer } from '../../../shared/schemas/design-questionnaire.schema';
import { AppError } from '../../lib/errors';
import { getSessionQuestions } from './nightworkers.design-questionnaire-parser.service';

type JsonRecord = Record<string, unknown>;
type QuestionLike = {
  answerType?: unknown;
  options?: unknown;
  question?: unknown;
  topic?: unknown;
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

export function removeDuplicateFollowUpQuestions(session: unknown, questionnaire: JsonRecord) {
  const existingQuestions = toRecordArray(getSessionQuestions(session));
  const next = structuredClone(questionnaire) as JsonRecord;
  let keptCount = 0;
  next.questionSets = toRecordArray(next.questionSets)
    .map((set) => {
      const questions = toRecordArray(set.questions).filter(
        (question) => !existingQuestions.some((existing) => isDuplicateQuestion(existing, question))
      );
      keptCount += questions.length;
      return { ...set, questions };
    })
    .filter((set) => set.questions.length > 0);
  return keptCount > 0 ? next : null;
}

function isDuplicateQuestion(existing: QuestionLike, candidate: QuestionLike) {
  const existingQuestion = normalizeQuestionText(existing.question || existing.topic || '');
  const candidateQuestion = normalizeQuestionText(candidate.question || candidate.topic || '');
  if (existingQuestion && candidateQuestion && existingQuestion === candidateQuestion) return true;

  const existingOptions = optionSignature(existing);
  const candidateOptions = optionSignature(candidate);
  if (existingOptions && candidateOptions && existingOptions === candidateOptions) return true;

  return false;
}

function optionSignature(question: QuestionLike) {
  return toRecordArray(question.options)
    .map((option) => normalizeQuestionText(option.label || option.id || ''))
    .filter(Boolean)
    .sort()
    .join('|');
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
