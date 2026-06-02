import { digestObject } from './loader';
import type {
  LlmReviewerResult,
  ReviewEvidencePack,
  ReviewerDraft,
  RubricDefinition,
} from './types';

type CallLlmReviewerInput = {
  rubric: RubricDefinition;
  evidencePack: ReviewEvidencePack;
  mockDraft?: ReviewerDraft | string | Record<string, unknown>;
};

export async function callLlmReviewer(input: CallLlmReviewerInput): Promise<LlmReviewerResult> {
  const prompt = buildReviewerPrompt(input.rubric, input.evidencePack);
  const promptDigest = digestObject(prompt);
  const evidencePackDigest = digestObject(input.evidencePack);

  if (input.mockDraft) {
    return {
      status: 'completed',
      draft: typeof input.mockDraft === 'string' ? undefined : (input.mockDraft as ReviewerDraft),
      rawOutput: input.mockDraft,
      provider: 'mock',
      model: 'mock-reviewer',
      promptDigest,
      evidencePackDigest,
      outputDigest: digestObject(input.mockDraft),
      degradedReasons: [],
    };
  }

  return {
    status: 'degraded',
    provider: process.env.ACTIVE_LLM_PROVIDER || 'disabled',
    model: process.env.OPENAI_MODEL || process.env.CODEX_MODEL || undefined,
    promptDigest,
    evidencePackDigest,
    degradedReasons: ['llm_reviewer_provider_not_configured'],
    errorCode: 'LLM_REVIEWER_PROVIDER_NOT_CONFIGURED',
  };
}

export function buildReviewerPrompt(
  rubric: RubricDefinition,
  evidencePack: ReviewEvidencePack
): string {
  const maxChars = rubric.llm?.maxEvidenceChars ?? 12_000;
  const evidenceJson = JSON.stringify(evidencePack, null, 2).slice(0, maxChars);
  const hints = rubric.llm?.promptHints?.join('\n') || '追加指示なし';
  return [
    'あなたは NightWorkers の agent reviewer です。',
    '最終 outcome は変更せず、rubric と evidence に基づく findings / humanCallouts / follow-ups だけを返してください。',
    'ReviewResult は直接返さず、ReviewerDraft JSON だけを返してください。',
    `Rubric: ${rubric.title} (${rubric.id})`,
    `Hints:\n${hints}`,
    `EvidencePack:\n${evidenceJson}`,
  ].join('\n\n');
}
