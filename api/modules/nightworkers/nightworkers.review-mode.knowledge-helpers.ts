import { AppError } from '../../lib/errors';
import type * as reviewRepo from './nightworkers.review-mode.repository';

export function defaultCandidateBody(
  finding: NonNullable<Awaited<ReturnType<typeof reviewRepo.getReviewFinding>>>,
  type: string
) {
  if (type === 'procedure') {
    return [
      'Use when:',
      `- ${finding.title}`,
      '',
      'Workflow:',
      '- Confirm the finding still applies using current runtime evidence.',
      '- Route the work to a follow-up task instead of mutating completed execution status.',
      '',
      'Verification:',
      '- Re-run the focused verification that proves the finding is resolved.',
      '',
      'Avoid:',
      '- Do not mark the original run incomplete only to represent review follow-up work.',
    ].join('\n');
  }
  return [
    finding.body || finding.title,
    '',
    'Generalized from Review Mode evidence. Keep the rule reusable and avoid file-specific wording before sending.',
  ].join('\n');
}

export function assertProcedureCandidateBody(candidateType: string, body: string) {
  if (
    candidateType === 'procedure' &&
    !['Use when:', 'Workflow:', 'Verification:', 'Avoid:'].every((heading) =>
      body.includes(heading)
    )
  ) {
    throw new AppError(
      400,
      'PROCEDURE_CANDIDATE_STRUCTURE_REQUIRED',
      'Procedure candidates require Use when / Workflow / Verification / Avoid sections'
    );
  }
}

export function contextStillCandidatePayload(
  candidate: NonNullable<Awaited<ReturnType<typeof reviewRepo.getReviewKnowledgeCandidate>>>
) {
  return {
    items: [
      {
        title: candidate.title,
        body: candidate.body,
        type: candidate.candidateType,
        avoid: candidate.avoid,
        prefer: candidate.prefer,
        source: 'nightworkers_review_mode',
        metadata: {
          reviewSessionId: candidate.reviewSessionId,
          findingId: candidate.findingId,
          reviewKnowledgeCandidateId: candidate.id,
        },
      },
    ],
  };
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function extractContextStillCandidateId(value: unknown): string | null {
  const body = objectRecord(value);
  if (!body) return null;
  for (const key of ['candidateId', 'id', 'contextStillCandidateId']) {
    const candidateId = body[key];
    if (typeof candidateId === 'string' && candidateId.trim()) return candidateId;
  }
  const candidates = body.candidates ?? body.items ?? body.registeredCandidates;
  if (!Array.isArray(candidates)) return null;
  for (const candidate of candidates) {
    const candidateRecord = objectRecord(candidate);
    if (!candidateRecord) continue;
    for (const key of ['candidateId', 'id', 'contextStillCandidateId']) {
      const candidateId = candidateRecord[key];
      if (typeof candidateId === 'string' && candidateId.trim()) return candidateId;
    }
  }
  return null;
}

export function extractContextStillError(value: unknown) {
  const body = objectRecord(value);
  if (!body) return null;
  const error = body.error ?? body.message ?? body.detail;
  return typeof error === 'string' && error.trim() ? error : null;
}
