import type {
  AdditionalQuestionnaireDraft,
  DesignQuestionnaire,
  DesignQuestionnaireSession,
  QuestionnaireQuestionSetSource,
} from '../../../shared/schemas/design-questionnaire.schema';
import { AppError, NotFoundError } from '../../lib/errors';
import {
  buildAdditionalDesignQuestionnaireSystemPrompt,
  buildAdditionalDesignQuestionnaireUserPrompt,
} from '../../services/structured-generation/prompts/design-questionnaire';
import { callStructuredJsonLLM } from '../../services/structured-llm';
import {
  getPlanModeTask,
  listPlanModeTaskMessages,
  type PlanModeTaskMessage,
} from '../nightworkers/nightworkers.plan-mode-core.port';
import { assertPlanModeCapabilityEnabled } from '../nightworkers/nightworkers.plan-mode-settings.service';
import { resolvePlanModeProjectStackContext } from '../specification/plan-mode-project-stack-context';
import { assertPlanModeMutable } from '../specification/specification-mutability';
import * as repo from './questionnaire.repository';
import {
  additionalQuestionnaireDraftJsonSchema,
  buildDesignQuestionnaireSessionView,
  parseAdditionalQuestionnaireDraftRaw,
  toKebabId,
  toQuestionnaireDecisionKey,
} from './questionnaire-parser.service';
import {
  buildQuestionnaireDecisionInventory,
  removeDuplicateQuestionnaireQuestions,
} from './questionnaire-validation';

export type GenerateAdditionalQuestionsInput = {
  source: Extract<
    QuestionnaireQuestionSetSource,
    'user_requested' | 'artifact_triggered' | 'pre_feature_plan_gate'
  >;
  reason?: string;
  maxQuestions?: number;
};

export type GenerateAdditionalQuestionsResult = {
  sessionId: string | null;
  createdQuestionSetId: string | null;
  addedCount: number;
  skippedDuplicateCount: number;
  blockingCount: number;
  nonBlockingCount: number;
};

export async function generateAdditionalDesignQuestionnaireQuestions(
  taskId: string,
  input: GenerateAdditionalQuestionsInput
): Promise<{
  session: DesignQuestionnaireSession | null;
  result: GenerateAdditionalQuestionsResult;
}> {
  const task = await getPlanModeTask(taskId);
  if (!task) throw new NotFoundError('Task not found');
  assertPlanModeCapabilityEnabled('questionnaire');
  assertPlanModeMutable(task);

  const existingSession = await resolveLatestMutableQuestionnaireSession(taskId);
  const maxQuestions = Math.max(0, Math.min(input.maxQuestions ?? 5, 5));
  const messages = await listPlanModeTaskMessages(taskId);
  const projectStackContext = await resolvePlanModeProjectStackContext(task.repositoryId);
  const rawOutput = await callStructuredJsonLLM(
    buildAdditionalDesignQuestionnaireSystemPrompt(),
    buildAdditionalDesignQuestionnaireUserPrompt({
      task: task.objective || task.description || task.title,
      source: input.source,
      reason: input.reason || null,
      maxQuestions,
      projectStackContext,
      planModeContext: buildAdditionalQuestionnairePlanModeContext(messages),
      decisionInventory: existingSession
        ? buildQuestionnaireDecisionInventory(existingSession)
        : [],
    }),
    {
      schemaName: 'design_questionnaire_additional',
      schema: additionalQuestionnaireDraftJsonSchema,
      taskId,
      role: 'plan',
    }
  );
  const parsed = parseAdditionalQuestionnaireDraftRaw(rawOutput);
  if (!parsed.ok) {
    throw new AppError(
      502,
      'ADDITIONAL_QUESTIONNAIRE_PARSE_FAILED',
      'Additional questionnaire output could not be parsed.'
    );
  }

  const dedupedDraft = dedupeAdditionalDraftQuestions(parsed.value, maxQuestions);
  const draft = dedupedDraft.draft;
  if (draft.questions.length === 0) {
    return {
      session: existingSession,
      result: {
        ...emptyAdditionalResult(existingSession?.id ?? null),
        skippedDuplicateCount: dedupedDraft.skippedDuplicateCount,
      },
    };
  }

  const session =
    existingSession ?? (await createAdditionalQuestionnaireSession(taskId, task.repositoryId));
  const nextSequence =
    session.questionSets.reduce((max, set) => Math.max(max, set.sequence), 0) + 1;
  const questionnaire = buildAdditionalDesignQuestionnaire({
    taskId,
    repositoryId: task.repositoryId,
    source: input.source,
    reason: input.reason || draft.rationale,
    generatedFromMessageIds: messages.map((message) => message.id).slice(-16),
    draft,
    sequence: nextSequence,
  });
  const deduped = removeDuplicateQuestionnaireQuestions(session, questionnaire);
  if (!deduped.questionnaire) {
    return {
      session: existingSession,
      result: {
        ...emptyAdditionalResult(existingSession?.id ?? null),
        skippedDuplicateCount: dedupedDraft.skippedDuplicateCount + deduped.skippedDuplicateCount,
      },
    };
  }

  const questions = deduped.questionnaire.questionSets.flatMap((set) => set.questions);
  const questionSet = await repo.createDesignQuestionnaireQuestionSet({
    sessionId: session.id,
    sequence: nextSequence,
    questionnaireJson: deduped.questionnaire,
    rawOutput,
    validationStatus: 'valid',
  });
  await repo.updateDesignQuestionnaireSessionStatus(session.id, 'answering');
  const updatedSession = await buildDesignQuestionnaireSessionView(session.id);
  const blockingCount = questions.filter((question) => question.blocking !== false).length;
  return {
    session: updatedSession,
    result: {
      sessionId: session.id,
      createdQuestionSetId: questionSet.id,
      addedCount: questions.length,
      skippedDuplicateCount: dedupedDraft.skippedDuplicateCount + deduped.skippedDuplicateCount,
      blockingCount,
      nonBlockingCount: Math.max(questions.length - blockingCount, 0),
    },
  };
}

function dedupeAdditionalDraftQuestions(draft: AdditionalQuestionnaireDraft, maxQuestions: number) {
  if (maxQuestions <= 0) {
    return {
      draft: { ...draft, questions: [] },
      skippedDuplicateCount: draft.questions.length,
    };
  }
  const seen = new Set<string>();
  const questions: AdditionalQuestionnaireDraft['questions'] = [];
  let skippedDuplicateCount = 0;
  for (let index = 0; index < draft.questions.length; index += 1) {
    const question = draft.questions[index];
    const decisionKey = toQuestionnaireDecisionKey(question.decisionKey, '');
    const textKey = compact(question.text, 200).normalize('NFKC').toLowerCase().replace(/\s+/g, '');
    const optionKey = question.options
      .map((option) => option.normalize('NFKC').toLowerCase().replace(/\s+/g, ''))
      .sort()
      .join('|');
    const duplicateKey = [decisionKey, textKey, optionKey].join('::');
    if (seen.has(duplicateKey) || (decisionKey && seen.has(`decision:${decisionKey}`))) {
      skippedDuplicateCount += 1;
      continue;
    }
    seen.add(duplicateKey);
    if (decisionKey) seen.add(`decision:${decisionKey}`);
    questions.push(question);
    if (questions.length >= maxQuestions) {
      skippedDuplicateCount += Math.max(draft.questions.length - index - 1, 0);
      break;
    }
  }
  return {
    draft: { ...draft, questions },
    skippedDuplicateCount,
  };
}

async function resolveLatestMutableQuestionnaireSession(taskId: string) {
  const sessions = await repo.listDesignQuestionnaireSessionsForTask(taskId);
  const latest = sessions.find((session) => session.status !== 'abandoned');
  return latest ? buildDesignQuestionnaireSessionView(latest.id) : null;
}

async function createAdditionalQuestionnaireSession(taskId: string, repositoryId: string) {
  const session = await repo.createDesignQuestionnaireSession({
    taskId,
    repositoryId,
    sourceBlueprintMessageId: null,
    status: 'draft',
  });
  return buildDesignQuestionnaireSessionView(session.id);
}

function emptyAdditionalResult(sessionId: string | null): GenerateAdditionalQuestionsResult {
  return {
    sessionId,
    createdQuestionSetId: null,
    addedCount: 0,
    skippedDuplicateCount: 0,
    blockingCount: 0,
    nonBlockingCount: 0,
  };
}

function buildAdditionalDesignQuestionnaire(input: {
  taskId: string;
  repositoryId: string;
  source: GenerateAdditionalQuestionsInput['source'];
  reason: string;
  generatedFromMessageIds: string[];
  draft: AdditionalQuestionnaireDraft;
  sequence: number;
}): DesignQuestionnaire {
  const decisionKeys = input.draft.questions.map((question) =>
    toQuestionnaireDecisionKey(question.decisionKey, `additional.${input.sequence}`)
  );
  const questions = input.draft.questions.map((question, index) => {
    const questionId = `additional-${input.sequence}-q${index + 1}`;
    const decisionKey = toQuestionnaireDecisionKey(question.decisionKey, questionId);
    const reason = question.reason.trim() || decisionKey;
    return {
      id: questionId,
      topic: decisionKey,
      question: question.text,
      why: reason,
      answerType:
        question.type === 'checkbox' ? ('multi_choice' as const) : ('single_choice' as const),
      options: buildUniqueOptions(question.options),
      allowsCustomAnswer: false,
      blocks: [reason],
      outputSection: inferOutputSection(decisionKey),
      decisionKey,
      blocking: question.blocking,
      blockingReason: question.blocking ? reason : undefined,
    };
  });
  return {
    version: 1,
    source: {
      taskId: input.taskId,
      repositoryId: input.repositoryId,
      sourceKind: 'plan_mode_intake',
      blueprintMessageId: null,
    },
    title: input.draft.title || '追加で確認したいこと',
    summary: input.draft.rationale || input.reason || 'Plan Mode 中に見つかった追加確認です。',
    questionSets: [
      {
        id: `additional-${input.sequence}`,
        title: input.draft.title || '追加確認',
        category: '追加確認',
        purpose:
          input.reason || input.draft.rationale || '実装判断に影響する未決定事項を確認します。',
        metadata: {
          source: input.source,
          blocking: questions.some((question) => question.blocking !== false),
          reason: input.reason || input.draft.rationale || '',
          generatedFromMessageIds: input.generatedFromMessageIds,
          decisionKeys,
        },
        questions,
      },
    ],
    openQuestions: [],
    dataModelHandoffNotes: [],
  };
}

function buildUniqueOptions(labels: string[]) {
  const usedIds = new Set<string>();
  return labels.map((label, optionIndex) => {
    const baseId = toKebabId(label, `option-${optionIndex + 1}`);
    let id = baseId;
    let suffix = 2;
    while (usedIds.has(id)) {
      id = `${baseId}-${suffix}`;
      suffix += 1;
    }
    usedIds.add(id);
    return {
      id,
      label,
      tradeoff: '選択後に設計判断として整理します。',
    };
  });
}

function inferOutputSection(decisionKey: string) {
  const prefix = decisionKey.split(/[._-]/)[0] || '';
  if (['auth', 'api', 'data', 'ui', 'scope', 'verification'].includes(prefix)) return prefix;
  return 'implementation';
}

function buildAdditionalQuestionnairePlanModeContext(messages: PlanModeTaskMessage[]) {
  const lines: string[] = [];
  for (const message of messages.slice(-20)) {
    const metadata = isRecord(message.metadataJson) ? message.metadataJson : {};
    lines.push(
      [
        `message=${message.id}`,
        `type=${message.messageType || 'message'}`,
        `intent=${String(metadata.intent || 'none')}`,
        `view=${String(metadata.view || 'none')}`,
        `artifactKind=${String(metadata.artifactKind || 'none')}`,
        `title=${String(metadata.title || '').trim() || compact(message.content, 80)}`,
        `content=${compact(message.content, 500)}`,
      ].join('; ')
    );
  }
  return lines.length > 0 ? lines.join('\n') : 'Plan Mode artifact は未生成です。';
}

function compact(value: string | null | undefined, limit: number) {
  const text = String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 1)).trim()}…`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
