import type { ReviewEvidenceRef, ReviewFinding } from '../../services/review-results/types';
import type { ReviewEvidencePack } from '../../services/review-rubrics/types';
import type {
  ReviewRecommendationLevel,
  ReviewRecommendationReason,
  ReviewSectionKind,
} from './nightworkers.review-mode.model';

const SECURITY_PATH_PATTERN =
  /(^|\/)(auth|oauth|permission|permissions|secret|secrets|security|billing|payment|payments|middleware)(\/|\.|-|$)|\b(policy|token|password|credential|csrf|jwt)\b/i;
const SCHEMA_PATH_PATTERN = /(^|\/)(drizzle|migrations?|schema|db)(\/|\.|-|$)|\.(sql)$/i;
const PUBLIC_CONTRACT_PATTERN =
  /(^|\/)(api\/routes|api\/modules|shared\/schemas|mcp|worker-tools)(\/|$)|\b(openapi|route-definitions|schema)\b/i;
const QUEUE_EVENT_PATTERN = /queue|retry|recovery|lease|requeue/i;
const SELF_REVIEW_EVENT_PATTERN = /self[-_. ]?review|review\.evaluation_finished/i;

function changedFileRefs(pack: ReviewEvidencePack): ReviewEvidenceRef[] {
  return pack.diff.changedFiles.map((path) => ({ kind: 'changed_file' as const, path }));
}

function diffRef(pack: ReviewEvidencePack): ReviewEvidenceRef {
  return {
    kind: 'diff',
    runId: pack.runId,
    bytes: pack.diff.bytes,
    hasChanges: pack.diff.hasChanges,
  };
}

function verificationRefs(pack: ReviewEvidencePack): ReviewEvidenceRef[] {
  return pack.verification.map((verification) => ({
    kind: 'verification' as const,
    eventId: verification.eventId,
    passed: verification.passed,
    command: verification.command,
  }));
}

function isSecuritySensitive(pack: ReviewEvidencePack) {
  return pack.diff.changedFiles.some((file) => SECURITY_PATH_PATTERN.test(file));
}

function isSchemaOrMigration(pack: ReviewEvidencePack) {
  return pack.diff.changedFiles.some((file) => SCHEMA_PATH_PATTERN.test(file));
}

function isPublicContract(pack: ReviewEvidencePack) {
  return pack.diff.changedFiles.some((file) => PUBLIC_CONTRACT_PATTERN.test(file));
}

function hasQueueRecovery(pack: ReviewEvidencePack) {
  return (
    pack.eventTypes.some((type) => QUEUE_EVENT_PATTERN.test(type)) ||
    pack.selectedEvents.some(
      (event) => QUEUE_EVENT_PATTERN.test(event.type) || QUEUE_EVENT_PATTERN.test(event.message)
    )
  );
}

function hasSelfReviewUnresolved(pack: ReviewEvidencePack) {
  return pack.selectedEvents.some(
    (event) =>
      SELF_REVIEW_EVENT_PATTERN.test(event.type) &&
      /warning|follow.?up|unresolved|changes_requested|blocking/i.test(event.message)
  );
}

function includesEvidencePhrase(report: string | undefined, pattern: RegExp) {
  return Boolean(report && pattern.test(report));
}

export function buildRecommendationFromEvidence(input: {
  runId: string;
  taskId: string;
  repositoryId: string;
  pack: ReviewEvidencePack;
  openTodoCount: number;
}): {
  level: ReviewRecommendationLevel;
  defaultAction: 'skip' | 'offer_review' | 'require_review';
  reasons: ReviewRecommendationReason[];
} {
  const { pack } = input;
  const reasons: ReviewRecommendationReason[] = [];
  const addReason = (reason: ReviewRecommendationReason) => reasons.push(reason);

  if (pack.diff.bytes > 20_000) {
    addReason({
      code: 'large_diff',
      severity: 'warning',
      label: 'Large diff should be reviewed before acceptance.',
      evidenceRefs: [diffRef(pack)],
    });
  }
  if (pack.diff.changedFiles.length >= 8) {
    addReason({
      code: 'many_changed_files',
      severity: 'warning',
      label: 'Many changed files increase review risk.',
      evidenceRefs: changedFileRefs(pack),
    });
  }
  if (pack.diff.hasChanges && pack.verification.length === 0) {
    addReason({
      code: 'verification_missing',
      severity: 'blocking',
      label: 'Changed run has no completed verification evidence.',
      evidenceRefs: [diffRef(pack)],
    });
  }
  if (pack.verification.some((verification) => verification.passed === false)) {
    addReason({
      code: 'verification_failed',
      severity: 'blocking',
      label: 'A verification command failed.',
      evidenceRefs: verificationRefs(pack),
    });
  }
  if (pack.diff.hasChanges && !pack.finalReport?.trim()) {
    addReason({
      code: 'acceptance_evidence_missing',
      severity: 'blocking',
      label: 'Final report is missing, so acceptance evidence cannot be checked.',
      evidenceRefs: [{ kind: 'final_report', runId: input.runId }],
    });
  }
  if (input.openTodoCount > 0) {
    addReason({
      code: 'todo_unresolved',
      severity: 'blocking',
      label: 'Run still has unresolved Todo items.',
      evidenceRefs: [],
    });
  }
  if (hasSelfReviewUnresolved(pack)) {
    addReason({
      code: 'self_review_unresolved',
      severity: 'warning',
      label: 'Self-review follow-up evidence is still unresolved.',
      evidenceRefs: [],
    });
  }
  if (hasQueueRecovery(pack)) {
    addReason({
      code: 'queue_recovery_present',
      severity: 'warning',
      label: 'Queue retry or recovery evidence is present.',
      evidenceRefs: [],
    });
  }
  if (pack.outcome?.status && pack.outcome.status !== pack.status) {
    addReason({
      code: 'queue_run_status_mismatch',
      severity: 'blocking',
      label: 'Run row status and outcome evidence disagree.',
      evidenceRefs: [],
    });
  }
  if (isSecuritySensitive(pack)) {
    addReason({
      code: 'security_sensitive_change',
      severity: 'blocking',
      label: 'Security-sensitive paths changed.',
      evidenceRefs: changedFileRefs(pack).filter((ref) =>
        ref.kind === 'changed_file' ? SECURITY_PATH_PATTERN.test(ref.path) : false
      ),
    });
    addReason({
      code: 'security_plugin_missing',
      severity: 'blocking',
      label: 'No external security plugin evidence is linked for the sensitive change.',
      evidenceRefs: [],
    });
  }
  if (isSchemaOrMigration(pack)) {
    addReason({
      code: 'schema_or_migration_change',
      severity: 'blocking',
      label: 'Schema or migration paths changed.',
      evidenceRefs: changedFileRefs(pack).filter((ref) =>
        ref.kind === 'changed_file' ? SCHEMA_PATH_PATTERN.test(ref.path) : false
      ),
    });
  }
  if (isPublicContract(pack)) {
    addReason({
      code: 'public_contract_change',
      severity: 'blocking',
      label: 'Public API, schema, MCP, or worker-tool contract changed.',
      evidenceRefs: changedFileRefs(pack).filter((ref) =>
        ref.kind === 'changed_file' ? PUBLIC_CONTRACT_PATTERN.test(ref.path) : false
      ),
    });
  }
  if (
    pack.finalReport &&
    /pass|passed|成功|通過/i.test(pack.finalReport) &&
    pack.verification.length === 0 &&
    pack.diff.hasChanges
  ) {
    addReason({
      code: 'final_report_evidence_mismatch',
      severity: 'blocking',
      label: 'Final report claims verification success without verification evidence.',
      evidenceRefs: [{ kind: 'final_report', runId: input.runId }],
    });
  }

  if (reasons.length === 0) {
    if (!pack.diff.hasChanges || pack.diff.bytes === 0) {
      addReason({
        code: 'minor_no_review_needed',
        severity: 'info',
        label: 'No risky run evidence was detected.',
        evidenceRefs: [],
      });
      return { level: 'none', defaultAction: 'skip', reasons };
    }
    addReason({
      code: 'minor_no_review_needed',
      severity: 'info',
      label: 'Focused change has verification and no blocking review signal.',
      evidenceRefs: [diffRef(pack), ...verificationRefs(pack)],
    });
    return { level: 'optional', defaultAction: 'offer_review', reasons };
  }

  const level: ReviewRecommendationLevel = reasons.some((reason) => reason.severity === 'blocking')
    ? 'required'
    : 'recommended';
  return {
    level,
    defaultAction: level === 'required' ? 'require_review' : 'offer_review',
    reasons,
  };
}

export function sectionFindings(
  kind: ReviewSectionKind,
  pack: ReviewEvidencePack
): ReviewFinding[] {
  if (kind === 'acceptance_evidence') {
    const findings: ReviewFinding[] = [];
    if (!pack.finalReport?.trim()) {
      findings.push({
        severity: 'blocking',
        title: 'Final report is missing',
        body: 'Review acceptance cannot be completed without a final report or equivalent closeout evidence.',
        evidenceRefs: [{ kind: 'final_report', runId: pack.runId }],
      });
    }
    if (
      pack.finalReport &&
      /pass|passed|成功|通過/i.test(pack.finalReport) &&
      pack.verification.length === 0 &&
      pack.diff.hasChanges
    ) {
      findings.push({
        severity: 'blocking',
        title: 'Final report claims verification without evidence',
        body: 'The final report claims a passing verification state, but no verification.finished evidence is present.',
        evidenceRefs: [{ kind: 'final_report', runId: pack.runId }],
      });
    }
    return findings;
  }
  if (kind === 'verification_evidence') {
    if (pack.diff.hasChanges && pack.verification.length === 0) {
      return [
        {
          severity: 'blocking',
          title: 'Verification evidence is missing',
          body: 'The run changed files but has no completed verification result.',
          evidenceRefs: [diffRef(pack)],
        },
      ];
    }
    return pack.verification
      .filter((verification) => verification.passed === false)
      .map((verification) => ({
        severity: 'blocking' as const,
        title: 'Verification failed',
        body: verification.summary || verification.command || 'A verification result failed.',
        evidenceRefs: [
          {
            kind: 'verification' as const,
            eventId: verification.eventId,
            command: verification.command,
            passed: verification.passed,
          },
        ],
      }));
  }
  if (kind === 'self_review_followups') {
    return hasSelfReviewUnresolved(pack)
      ? [
          {
            severity: 'warning',
            title: 'Self-review follow-up may be unresolved',
            body: 'Self-review event text indicates an unresolved warning or follow-up.',
            evidenceRefs: [],
          },
        ]
      : [];
  }
  if (kind === 'queue_recovery') {
    const findings: ReviewFinding[] = [];
    if (pack.outcome?.status && pack.outcome.status !== pack.status) {
      findings.push({
        severity: 'blocking',
        title: 'Run outcome and persisted status mismatch',
        body: `Run row status is ${pack.status}, while outcome evidence says ${pack.outcome.status}.`,
        evidenceRefs: [],
      });
    }
    if (
      hasQueueRecovery(pack) &&
      !includesEvidencePhrase(pack.finalReport, /queue|retry|recovery|lease|再試行|復旧/i)
    ) {
      findings.push({
        severity: 'warning',
        title: 'Queue recovery is not explained in final report',
        body: 'Queue retry or recovery evidence appears in events, but the final report does not mention it.',
        evidenceRefs: [],
      });
    }
    return findings;
  }
  if (kind === 'security_review') {
    const findings: ReviewFinding[] = [];
    if (isSecuritySensitive(pack)) {
      findings.push({
        severity: 'blocking',
        title: 'Security-sensitive change needs external evidence',
        body: 'Security-sensitive paths changed and no external security plugin evidence is linked.',
        evidenceRefs: changedFileRefs(pack).filter((ref) =>
          ref.kind === 'changed_file' ? SECURITY_PATH_PATTERN.test(ref.path) : false
        ),
      });
    }
    if (isSchemaOrMigration(pack)) {
      findings.push({
        severity: 'blocking',
        title: 'Schema or migration change requires review',
        body: 'Schema or migration paths changed. Migration/apply verification evidence should be checked before acceptance.',
        evidenceRefs: changedFileRefs(pack).filter((ref) =>
          ref.kind === 'changed_file' ? SCHEMA_PATH_PATTERN.test(ref.path) : false
        ),
      });
    }
    if (isPublicContract(pack)) {
      findings.push({
        severity: 'blocking',
        title: 'Public contract change requires review',
        body: 'Public API, schema, MCP, or worker-tool contract paths changed.',
        evidenceRefs: changedFileRefs(pack).filter((ref) =>
          ref.kind === 'changed_file' ? PUBLIC_CONTRACT_PATTERN.test(ref.path) : false
        ),
      });
    }
    return findings;
  }
  return [];
}
