import { reviewerDraftSchema } from '../../../shared/schemas/nightworkers.schema';
import type { ReviewEvidenceRef, ReviewFinding } from '../review-results/types';
import { buildEvidenceRefExistenceSet, redactSecretLikeValues, refKey } from './evidence-pack';
import { digestObject } from './loader';
import type {
  DeterministicReviewEvaluation,
  FirewallResult,
  ReviewEvidencePack,
  ReviewerDraft,
} from './types';

const BYPASS_PHRASES = [
  /ignore (the )?rubric/i,
  /disable (the )?rubric/i,
  /override deterministic/i,
  /bypass (policy|firewall|review)/i,
  /rubric を無視/i,
];

const SECRET_OUTPUT_PATTERNS = [
  /sk-[A-Za-z0-9_-]{12,}/,
  /\b(?:api[_-]?key|secret|token|password)\s*[:=]\s*[^\s"']+/i,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
];

export function applyReviewerFirewall(input: {
  rawOutput: unknown;
  evidencePack: ReviewEvidencePack;
  deterministic: DeterministicReviewEvaluation;
}): FirewallResult {
  const rawText =
    typeof input.rawOutput === 'string' ? input.rawOutput : JSON.stringify(input.rawOutput);
  const outputDigest = digestObject(input.rawOutput);
  const parsedValue = parseRawOutput(input.rawOutput);
  const schemaResult = reviewerDraftSchema.safeParse(parsedValue);
  if (!schemaResult.success) {
    return {
      status: 'failed',
      outputDigest,
      findings: [
        {
          severity: 'blocking',
          title: 'LLM reviewer output schema mismatch',
          body: schemaResult.error.issues.map((issue) => issue.message).join('; '),
        },
      ],
      degradedReasons: ['llm_output_schema_mismatch'],
      errorCode: 'LLM_OUTPUT_SCHEMA_MISMATCH',
    };
  }

  const draft = sanitizeDraft(schemaResult.data as ReviewerDraft);
  if (SECRET_OUTPUT_PATTERNS.some((pattern) => pattern.test(rawText))) {
    return {
      status: 'failed',
      outputDigest,
      draft,
      findings: [
        {
          severity: 'blocking',
          title: 'LLM reviewer output contained secret-like text',
          body: 'Reviewer output was rejected by the firewall.',
        },
      ],
      degradedReasons: ['llm_output_secret_like_text'],
      errorCode: 'LLM_OUTPUT_SECRET_LIKE_TEXT',
    };
  }

  const degradedReasons: string[] = [];
  const firewallFindings: ReviewFinding[] = [];
  if (BYPASS_PHRASES.some((pattern) => pattern.test(rawText))) {
    degradedReasons.push('llm_output_rubric_bypass_phrase');
    firewallFindings.push({
      severity: 'blocking',
      title: 'LLM reviewer attempted to bypass rubric controls',
    });
  }

  const existence = buildEvidenceRefExistenceSet(input.evidencePack);
  const rewriteUnknownRefs = (finding: ReviewFinding): ReviewFinding => {
    const refs = finding.evidenceRefs ?? [];
    const unknownRefs = refs.filter((ref) => !isKnownRef(ref, existence));
    if (unknownRefs.length === 0) return finding;
    degradedReasons.push('llm_output_unknown_evidence_ref');
    return {
      severity: 'warning',
      title: `Unsupported evidence reference: ${finding.title}`,
      body: 'The reviewer referenced evidence that is not present in the evidence pack.',
      evidenceRefs: refs.filter((ref) => isKnownRef(ref, existence)),
    };
  };

  draft.findings = draft.findings.map(rewriteUnknownRefs);
  draft.humanCallouts = draft.humanCallouts.map(rewriteUnknownRefs);

  const hasDeterministicBlocking = input.deterministic.findings.some(
    (finding) => finding.severity === 'blocking'
  );
  if (hasDeterministicBlocking && draft.verdict === 'approved') {
    degradedReasons.push('llm_approved_despite_deterministic_blocking');
    firewallFindings.push({
      severity: 'blocking',
      title: 'LLM reviewer ignored deterministic blocking findings',
      body: 'Final reviewer verdict must remain changes_requested.',
    });
  }

  return {
    status: degradedReasons.length > 0 ? 'degraded' : 'completed',
    outputDigest,
    draft,
    findings: firewallFindings,
    degradedReasons,
  };
}

function parseRawOutput(rawOutput: unknown): unknown {
  if (typeof rawOutput !== 'string') return rawOutput;
  try {
    return JSON.parse(rawOutput);
  } catch {
    return rawOutput;
  }
}

function sanitizeDraft(draft: ReviewerDraft): ReviewerDraft {
  return {
    ...draft,
    summary: redactSecretLikeValues(draft.summary),
    findings: draft.findings.map(sanitizeFinding),
    humanCallouts: draft.humanCallouts.map(sanitizeFinding),
    agentFollowUps: draft.agentFollowUps.map(redactSecretLikeValues),
    suggestedNextTasks: draft.suggestedNextTasks.map(redactSecretLikeValues),
  };
}

function sanitizeFinding(finding: ReviewFinding): ReviewFinding {
  return {
    ...finding,
    title: redactSecretLikeValues(finding.title),
    body: finding.body ? redactSecretLikeValues(finding.body) : undefined,
  };
}

function isKnownRef(ref: ReviewEvidenceRef, existence: Set<string>): boolean {
  return existence.has(refKey(ref));
}
