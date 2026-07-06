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

function finalReportRef(pack: ReviewEvidencePack): ReviewEvidenceRef {
  return {
    kind: 'final_report',
    runId: pack.runId,
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

function finalReportClaimsVerificationSuccess(finalReport: string | undefined) {
  return Boolean(
    finalReport &&
      /pass(?:ed|es)?|success(?:ful|fully)?|green|verified|検証.*(成功|通過|完了)|テスト.*(成功|通過|完了)/i.test(
        finalReport
      )
  );
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
  if (input.openTodoCount > 0) {
    addReason({
      code: 'todo_unresolved',
      severity: 'blocking',
      label: 'Run still has unresolved Todo items.',
      evidenceRefs: [],
    });
  }
  if (pack.diff.hasChanges && !pack.finalReport?.trim()) {
    addReason({
      code: 'acceptance_evidence_missing',
      severity: 'blocking',
      label: 'Final report is missing, so the completion claim cannot be checked.',
      evidenceRefs: [diffRef(pack)],
    });
  }
  if (pack.diff.hasChanges && pack.verification.length === 0) {
    addReason({
      code: 'verification_missing',
      severity: 'blocking',
      label: 'Changed run has no saved verification record.',
      evidenceRefs: [diffRef(pack)],
    });
  }
  if (pack.verification.some((verification) => verification.passed === false)) {
    addReason({
      code: 'verification_failed',
      severity: 'blocking',
      label: 'A saved verification record failed.',
      evidenceRefs: pack.verification
        .filter((verification) => verification.passed === false)
        .map((verification) => ({
          kind: 'verification' as const,
          eventId: verification.eventId,
          passed: verification.passed,
          command: verification.command,
        })),
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
    pack.diff.hasChanges &&
    finalReportClaimsVerificationSuccess(pack.finalReport) &&
    !pack.verification.some((verification) => verification.passed === true)
  ) {
    addReason({
      code: 'final_report_evidence_mismatch',
      severity: 'blocking',
      label: 'Final report claims verification success without a matching verification record.',
      evidenceRefs: [finalReportRef(pack), ...verificationRefs(pack)],
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
      label: 'Focused change has no blocking review signal.',
      evidenceRefs: [diffRef(pack)],
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
        body: 'Run record check cannot confirm the completion claim because no final report or equivalent closeout record is saved.',
        evidenceRefs: [diffRef(pack)],
      });
    }
    if (
      pack.diff.hasChanges &&
      finalReportClaimsVerificationSuccess(pack.finalReport) &&
      !pack.verification.some((verification) => verification.passed === true)
    ) {
      findings.push({
        severity: 'blocking',
        title: 'Final report has no matching verification record',
        body: 'The final report claims successful verification, but no saved passing verification record is linked to the run.',
        evidenceRefs: [finalReportRef(pack), ...verificationRefs(pack)],
      });
    }
    return findings;
  }
  if (kind === 'verification_evidence') {
    const findings: ReviewFinding[] = [];
    if (pack.diff.hasChanges && pack.verification.length === 0) {
      findings.push({
        severity: 'blocking',
        title: 'Saved verification record is missing',
        body: 'The completed run changed files, but no saved verification.finished record is available for review.',
        evidenceRefs: [diffRef(pack)],
      });
    }
    for (const verification of pack.verification.filter((item) => item.passed === false)) {
      findings.push({
        severity: 'blocking',
        title: 'Saved verification record failed',
        body: verification.summary || 'A saved verification record for this run failed.',
        evidenceRefs: [
          {
            kind: 'verification',
            eventId: verification.eventId,
            passed: verification.passed,
            command: verification.command,
          },
        ],
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
