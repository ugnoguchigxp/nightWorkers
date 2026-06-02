import type { ReviewEvidenceRef, ReviewFinding } from '../review-results/types';
import type {
  DeterministicReviewEvaluation,
  ReviewEvidencePack,
  RubricCriterion,
  RubricDefinition,
  RubricEvidenceSelector,
} from './types';

function failMessage(criterion: RubricCriterion): string {
  return `Rubric criterion failed: ${criterion.title}`;
}

function refForSelector(
  selector: RubricEvidenceSelector,
  pack: ReviewEvidencePack
): ReviewEvidenceRef[] {
  switch (selector.kind) {
    case 'diff':
      return [
        {
          kind: 'diff',
          runId: pack.runId,
          bytes: pack.diff.bytes,
          hasChanges: pack.diff.hasChanges,
        },
      ];
    case 'final_report':
      return pack.finalReport ? [{ kind: 'final_report', runId: pack.runId }] : [];
    case 'verification':
      return pack.verification.map((item) => ({
        kind: 'verification',
        eventId: item.eventId,
        passed: item.passed,
        command: item.command,
      }));
    case 'policy':
      return pack.policy.map((item) => ({
        kind: 'policy',
        eventId: item.eventId,
        code: item.code,
        message: item.message,
      }));
    case 'review_result':
      return [];
    case 'run_event_type':
      return pack.selectedEvents
        .filter((event) => event.type === selector.type && event.id)
        .map((event) => ({
          kind: 'run_event',
          eventId: event.id as string,
          seq: event.seq,
          eventType: event.type,
        }));
    case 'tool_failure':
      return pack.selectedEvents
        .filter(
          (event) => event.type === 'tool.call_finished' && event.severity === 'error' && event.id
        )
        .map((event) => ({
          kind: 'run_event',
          eventId: event.id as string,
          seq: event.seq,
          eventType: event.type,
        }));
  }
}

function consecutiveToolFailures(pack: ReviewEvidencePack): number {
  let max = 0;
  let current = 0;
  for (const event of pack.selectedEvents) {
    if (event.type !== 'tool.call_finished') continue;
    if (event.severity === 'error') {
      current += 1;
      max = Math.max(max, current);
    } else {
      current = 0;
    }
  }
  return max;
}

function selectorPasses(selector: RubricEvidenceSelector, pack: ReviewEvidencePack): boolean {
  switch (selector.kind) {
    case 'diff':
      if (selector.required && !pack.diff.hasChanges) return false;
      if (selector.maxBytes !== undefined && pack.diff.bytes > selector.maxBytes) return false;
      return true;
    case 'final_report':
      return selector.required ? Boolean(pack.finalReport?.trim()) : true;
    case 'verification': {
      if (selector.required && pack.verification.length === 0) return false;
      if (selector.passed !== undefined) {
        return pack.verification.some((item) => item.passed === selector.passed);
      }
      return true;
    }
    case 'policy':
      return selector.allowViolations === false ? pack.policy.length === 0 : true;
    case 'review_result':
      return selector.required ? pack.reviewResults.length > 0 : true;
    case 'run_event_type':
      return pack.eventTypes.includes(selector.type);
    case 'tool_failure':
      return consecutiveToolFailures(pack) < (selector.maxConsecutive ?? 3);
  }
}

function shouldFail(
  criterion: RubricCriterion,
  selectorResults: boolean[],
  selectorRefs: ReviewEvidenceRef[]
): boolean {
  const matched = selectorResults.every(Boolean);
  if (criterion.rule?.failWhenMissing) return !matched;
  if (criterion.rule?.failWhenPresent) return selectorRefs.length > 0 && !matched;
  return !matched;
}

export function evaluateDeterministicRubric(
  rubric: RubricDefinition,
  pack: ReviewEvidencePack
): DeterministicReviewEvaluation {
  const findings: ReviewFinding[] = [];
  const evidenceRefs: ReviewEvidenceRef[] = [];
  const criterionResults: DeterministicReviewEvaluation['criterionResults'] = [];
  const degradedReasons = [...pack.diagnostics];

  for (const criterion of rubric.criteria) {
    if (criterion.evaluationMode !== 'deterministic') continue;

    const selectorResults = criterion.evidenceSelectors.map((selector) =>
      selectorPasses(selector, pack)
    );
    const selectorRefs = criterion.evidenceSelectors.flatMap((selector) =>
      refForSelector(selector, pack)
    );
    const failed = shouldFail(criterion, selectorResults, selectorRefs);
    if (!failed) {
      criterionResults.push({
        criterionId: criterion.id,
        passed: true,
        evidenceRefs: selectorRefs,
        message: `${criterion.title}: passed`,
      });
      continue;
    }

    const refs = selectorRefs.length ? selectorRefs : fallbackRefs(criterion, pack);
    evidenceRefs.push(...refs);
    findings.push({
      severity: criterion.severity,
      title: criterion.title,
      body: failMessage(criterion),
      evidenceRefs: refs,
    });
    criterionResults.push({
      criterionId: criterion.id,
      passed: false,
      evidenceRefs: refs,
      message: failMessage(criterion),
    });
  }

  const blocking = findings.some((finding) => finding.severity === 'blocking');
  return {
    verdict: blocking ? 'changes_requested' : 'approved',
    findings,
    degradedReasons,
    evidenceRefs: dedupeRefs(evidenceRefs),
    criterionResults,
  };
}

function fallbackRefs(criterion: RubricCriterion, pack: ReviewEvidencePack): ReviewEvidenceRef[] {
  if (criterion.evidenceSelectors.some((selector) => selector.kind === 'diff')) {
    return [
      { kind: 'diff', runId: pack.runId, bytes: pack.diff.bytes, hasChanges: pack.diff.hasChanges },
    ];
  }
  if (criterion.evidenceSelectors.some((selector) => selector.kind === 'final_report')) {
    return [{ kind: 'final_report', runId: pack.runId }];
  }
  return [];
}

function dedupeRefs(refs: ReviewEvidenceRef[]): ReviewEvidenceRef[] {
  const seen = new Set<string>();
  return refs.filter((ref) => {
    const key = JSON.stringify(ref);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
