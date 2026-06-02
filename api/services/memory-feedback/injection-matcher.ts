import type { IncludedMemoryRef, LearningCandidate } from './types';

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function normalizeRef(value: unknown): IncludedMemoryRef | null {
  const obj = asObject(value);
  if (!obj) return null;
  const kindValue = obj.kind || obj.type || obj.sourceType;
  const kind =
    kindValue === 'candidate' || kindValue === 'memory' || kindValue === 'procedure'
      ? kindValue
      : 'unknown';
  return {
    kind,
    sourceRunId:
      typeof obj.sourceRunId === 'string'
        ? obj.sourceRunId
        : typeof obj.source_run_id === 'string'
          ? obj.source_run_id
          : undefined,
    candidateId:
      typeof obj.candidateId === 'string'
        ? obj.candidateId
        : typeof obj.candidate_id === 'string'
          ? obj.candidate_id
          : undefined,
    externalId:
      typeof obj.externalId === 'string'
        ? obj.externalId
        : typeof obj.id === 'string'
          ? obj.id
          : undefined,
    title: typeof obj.title === 'string' ? obj.title : undefined,
  };
}

function collectArrays(value: unknown, output: unknown[] = []): unknown[] {
  const obj = asObject(value);
  if (!obj) return output;
  for (const [key, child] of Object.entries(obj)) {
    if (Array.isArray(child) && /source|ref|memory|candidate|knowledge/i.test(key)) {
      output.push(...child);
    } else if (asObject(child)) {
      collectArrays(child, output);
    }
  }
  return output;
}

export function extractIncludedMemoryRefs(sourceMetadata: unknown): IncludedMemoryRef[] {
  const refs = collectArrays(sourceMetadata)
    .map(normalizeRef)
    .filter(Boolean) as IncludedMemoryRef[];
  const seen = new Set<string>();
  return refs.filter((ref) => {
    const key = `${ref.kind}:${ref.candidateId || ''}:${ref.sourceRunId || ''}:${ref.externalId || ''}:${ref.title || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function weakMatchCandidateRefs(input: {
  compiledText: string;
  candidates: LearningCandidate[];
}): IncludedMemoryRef[] {
  const text = input.compiledText.toLowerCase();
  return input.candidates
    .filter(
      (candidate) => candidate.title.length >= 12 && text.includes(candidate.title.toLowerCase())
    )
    .map((candidate) => ({
      kind: 'unknown' as const,
      sourceRunId: candidate.sourceRunId,
      candidateId: candidate.id,
      title: candidate.title,
      confidence: 'low' as const,
    }));
}
