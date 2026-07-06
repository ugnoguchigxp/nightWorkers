import type { TFunction } from 'i18next';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Play,
  Save,
  Send,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  ReviewKnowledgeCandidate,
  ReviewModeFinding,
  ReviewSectionKind,
  ReviewSessionDetail,
} from '../types';

type ReviewStatusViewerProps = {
  detail: ReviewSessionDetail | null;
  onRunSection?: (section: ReviewSectionKind) => Promise<ReviewSessionDetail>;
  onUpdateFindingDisposition?: (
    reviewSessionId: string,
    findingId: string,
    input: {
      disposition: NonNullable<ReviewModeFinding['disposition']>;
      note?: string;
      evidenceRefs?: unknown[];
    }
  ) => Promise<ReviewSessionDetail>;
  onCreateProposedGoals?: (reviewSessionId: string) => Promise<ReviewSessionDetail>;
  onUpdateProposedGoal?: (
    reviewSessionId: string,
    goalId: string,
    input: { status: 'approved' | 'rejected' | 'deferred'; note?: string }
  ) => Promise<ReviewSessionDetail>;
  onMaterializeProposedGoal?: (
    reviewSessionId: string,
    goalId: string
  ) => Promise<ReviewSessionDetail>;
  onCreateKnowledgeCandidate?: (
    reviewSessionId: string,
    input: {
      findingId: string;
      candidateType?: 'rule' | 'procedure' | 'failure_pattern';
      title?: string;
      body?: string;
      avoid?: string | null;
      prefer?: string | null;
    }
  ) => Promise<ReviewSessionDetail>;
  onUpdateKnowledgeCandidate?: (
    reviewSessionId: string,
    candidateId: string,
    input: {
      candidateType?: 'rule' | 'procedure' | 'failure_pattern';
      title?: string;
      body?: string;
      avoid?: string | null;
      prefer?: string | null;
      status?: 'discarded';
    }
  ) => Promise<ReviewSessionDetail>;
  onSendKnowledgeCandidate?: (
    reviewSessionId: string,
    candidateId: string
  ) => Promise<ReviewSessionDetail>;
  onFinalAction?: (
    reviewSessionId: string,
    input: { action: 'approve' | 'request_changes' | 'needs_human' | 'exit_review'; note?: string }
  ) => Promise<ReviewSessionDetail>;
};

const requirementOrder = ['required', 'recommended', 'optional', 'omitted'] as const;
const findingDispositions: NonNullable<ReviewModeFinding['disposition']>[] = [
  'human_callout',
  'agent_followup',
  'proposed_goal',
  'security_plugin_handoff',
  'knowledge_candidate',
  'accepted_risk',
  'ignored',
];

type CandidateEditState = Pick<
  ReviewKnowledgeCandidate,
  'candidateType' | 'title' | 'body' | 'avoid' | 'prefer'
>;

function candidateEditState(candidate: ReviewKnowledgeCandidate): CandidateEditState {
  return {
    candidateType: candidate.candidateType,
    title: candidate.title,
    body: candidate.body,
    avoid: candidate.avoid,
    prefer: candidate.prefer,
  };
}

function reviewStatusLabel(t: TFunction, key: string, fallback: string) {
  return t(key, { defaultValue: fallback });
}

function reviewStatusValueLabel(t: TFunction, group: string, value: string) {
  return reviewStatusLabel(t, `reviewStatus.${group}.${value}`, value);
}

function reviewStatusSectionReason(t: TFunction, reason: string) {
  switch (reason) {
    case 'No acceptance review signal was detected.':
      return t('reviewStatus.sectionReason.noAcceptanceSignal');
    case 'Check final report claims against run evidence.':
      return t('reviewStatus.sectionReason.checkFinalReport');
    case 'Verification evidence is missing or failed.':
      return t('reviewStatus.sectionReason.verificationMissingOrFailed');
    case 'Verification evidence can be inspected before acceptance.':
      return t('reviewStatus.sectionReason.verificationInspectable');
    case 'Self-review follow-up evidence is present.':
      return t('reviewStatus.sectionReason.selfReviewPresent');
    case 'No unresolved self-review follow-up signal was detected.':
      return t('reviewStatus.sectionReason.noSelfReviewSignal');
    case 'Queue recovery or status mismatch evidence should be checked.':
      return t('reviewStatus.sectionReason.queueRecoveryCheck');
    case 'No queue recovery signal was detected.':
      return t('reviewStatus.sectionReason.noQueueRecoverySignal');
    case 'Sensitive, schema, or public contract paths changed.':
      return t('reviewStatus.sectionReason.sensitivePathsChanged');
    case 'No security-sensitive change was detected.':
      return t('reviewStatus.sectionReason.noSecuritySignal');
    case 'No findings consolidation is needed.':
      return t('reviewStatus.sectionReason.noFindingsNeeded');
    case 'Consolidate section findings and route dispositions.':
      return t('reviewStatus.sectionReason.consolidateFindings');
    case 'Create follow-up Goal candidates only when findings need follow-up work.':
      return t('reviewStatus.sectionReason.createFollowupGoals');
    case 'Create reusable contextStill knowledge candidates only after preview.':
      return t('reviewStatus.sectionReason.createKnowledgeCandidates');
    default:
      return reason;
  }
}

function reviewStatusBlockingReason(t: TFunction, reason: string) {
  switch (reason) {
    case 'Required review sections are not complete.':
      return t('reviewStatus.blockingReason.requiredSectionsIncomplete');
    case 'Unresolved blocking findings remain.':
      return t('reviewStatus.blockingReason.unresolvedBlockingFindings');
    default:
      return reason;
  }
}

export function ReviewStatusViewer({
  detail,
  onRunSection,
  onUpdateFindingDisposition,
  onCreateProposedGoals,
  onUpdateProposedGoal,
  onMaterializeProposedGoal,
  onCreateKnowledgeCandidate,
  onUpdateKnowledgeCandidate,
  onSendKnowledgeCandidate,
  onFinalAction,
}: ReviewStatusViewerProps) {
  const { t } = useTranslation();
  const [busySection, setBusySection] = useState<ReviewSectionKind | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [busyCandidate, setBusyCandidate] = useState<string | null>(null);
  const [busyFinding, setBusyFinding] = useState<string | null>(null);
  const [busyGoal, setBusyGoal] = useState<string | null>(null);
  const [candidateEdits, setCandidateEdits] = useState<Record<string, CandidateEditState>>({});
  const [findingEdits, setFindingEdits] = useState<
    Record<string, { disposition: NonNullable<ReviewModeFinding['disposition']>; note: string }>
  >({});
  const [error, setError] = useState<string | null>(null);
  if (!detail) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-slate-500">
        {t('reviewStatus.unavailable')}
      </div>
    );
  }
  const status = detail.statusArtifact;
  const level = status.recommendation.level;
  const candidateByFindingId = new Map(
    detail.knowledgeCandidates.map((candidate) => [candidate.findingId, candidate])
  );
  const levelClass =
    level === 'required'
      ? 'border-red-500/60 bg-red-950/30 text-red-100'
      : level === 'recommended'
        ? 'border-amber-500/60 bg-amber-950/30 text-amber-100'
        : 'border-cyan-500/60 bg-cyan-950/30 text-cyan-100';
  return (
    <div className="nightworkers-review-status h-full overflow-auto bg-slate-950 p-5 text-slate-100">
      <div className="mx-auto grid max-w-5xl gap-5">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-800 pb-4">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold">
              <ClipboardCheck className="h-4 w-4 text-cyan-200" />
              {t('reviewStatus.title')}
            </div>
            <div className="mt-2 text-xs leading-5 text-slate-400">
              {t('reviewStatus.runRemains')}{' '}
              {detail.session.status === 'approved'
                ? t('reviewStatus.sessionState.approved')
                : t('reviewStatus.sessionState.executionUnchanged')}
              .
            </div>
          </div>
          <span className={`rounded border px-2.5 py-1 text-xs font-medium ${levelClass}`}>
            {reviewStatusValueLabel(t, 'level', level)}
          </span>
        </div>

        <div className="grid gap-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            {t('reviewStatus.reasons')}
          </div>
          <div className="grid gap-2">
            {status.recommendation.reasons.slice(0, 6).map((reason) => (
              <div
                key={`${reason.code}-${reason.label}`}
                className="flex items-start gap-2 rounded border border-slate-800 bg-slate-900/60 px-3 py-2 text-xs"
              >
                {reason.severity === 'blocking' ? (
                  <ShieldAlert className="mt-0.5 h-3.5 w-3.5 text-red-300" />
                ) : (
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 text-amber-300" />
                )}
                <div>
                  <div className="font-medium text-slate-100" title={reason.code}>
                    {reviewStatusValueLabel(t, 'reason', reason.code)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="grid gap-4">
          {requirementOrder.map((requirement) => {
            const sections = status.sections.filter(
              (section) => section.requirement === requirement
            );
            if (sections.length === 0) return null;
            return (
              <div key={requirement} className="grid gap-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  {reviewStatusValueLabel(t, 'requirement', requirement)}
                </div>
                <div className="grid gap-2">
                  {sections.map((section) => {
                    const runnable =
                      section.requirement !== 'omitted' &&
                      section.progress !== 'done' &&
                      Boolean(onRunSection);
                    return (
                      <div
                        key={section.kind}
                        className="grid gap-3 rounded border border-slate-800 bg-slate-900/50 p-3 md:grid-cols-[minmax(0,1fr)_auto]"
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium text-slate-100">
                              {reviewStatusValueLabel(t, 'section', section.kind)}
                            </span>
                            <span className="rounded border border-slate-700 px-2 py-0.5 text-[11px] text-slate-300">
                              {reviewStatusValueLabel(t, 'progress', section.progress)}
                            </span>
                            {section.findingCounts.blocking > 0 ? (
                              <span className="rounded border border-red-700 bg-red-950/40 px-2 py-0.5 text-[11px] text-red-100">
                                {t('reviewStatus.findingCount.blocking', {
                                  count: section.findingCounts.blocking,
                                })}
                              </span>
                            ) : null}
                          </div>
                          <div className="mt-1 text-xs leading-5 text-slate-400">
                            {reviewStatusSectionReason(t, section.reason)}
                          </div>
                        </div>
                        <button
                          type="button"
                          className="inline-flex h-8 items-center justify-center gap-1.5 rounded border border-slate-700 px-2.5 text-xs text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                          disabled={!runnable || busySection === section.kind}
                          onClick={async () => {
                            if (!onRunSection) return;
                            setBusySection(section.kind);
                            setError(null);
                            try {
                              await onRunSection(section.kind);
                            } catch (err) {
                              setError(
                                err instanceof Error
                                  ? err.message
                                  : t('reviewStatus.error.sectionRunFailed')
                              );
                            } finally {
                              setBusySection(null);
                            }
                          }}
                        >
                          <Play className="h-3.5 w-3.5" />
                          {t('reviewStatus.action.run')}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {detail.findings.length > 0 ? (
          <div className="grid gap-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              {t('reviewStatus.findings')}
            </div>
            <div className="grid gap-2">
              {detail.findings.map((finding) => {
                const existingCandidate = candidateByFindingId.get(finding.id);
                const canCreateCandidate =
                  !existingCandidate || existingCandidate.status === 'discarded';
                const findingEdit = findingEdits[finding.id] ?? {
                  disposition: finding.disposition ?? 'human_callout',
                  note: finding.dispositionNote ?? '',
                };
                const setFindingEdit = (
                  patch: Partial<{
                    disposition: NonNullable<ReviewModeFinding['disposition']>;
                    note: string;
                  }>
                ) => {
                  setFindingEdits((prev) => ({
                    ...prev,
                    [finding.id]: { ...findingEdit, ...patch },
                  }));
                };
                return (
                  <div
                    key={finding.id}
                    className="grid gap-3 rounded border border-slate-800 bg-slate-900/50 p-3"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-slate-100">{finding.title}</span>
                        <span className="rounded border border-slate-700 px-2 py-0.5 text-[11px] text-slate-300">
                          {reviewStatusValueLabel(t, 'findingSeverity', finding.severity)}
                        </span>
                        <span className="rounded border border-slate-700 px-2 py-0.5 text-[11px] text-slate-300">
                          {reviewStatusValueLabel(
                            t,
                            'dispositionStatus',
                            finding.dispositionStatus
                          )}
                        </span>
                      </div>
                      {finding.body ? (
                        <div className="mt-1 text-xs leading-5 text-slate-400">{finding.body}</div>
                      ) : null}
                    </div>
                    <div className="grid gap-2 md:grid-cols-[190px_minmax(0,1fr)_auto_auto]">
                      <select
                        className="h-8 rounded border border-slate-700 bg-slate-950 px-2 text-xs text-slate-100"
                        value={findingEdit.disposition}
                        onChange={(event) =>
                          setFindingEdit({
                            disposition: event.target.value as NonNullable<
                              ReviewModeFinding['disposition']
                            >,
                          })
                        }
                      >
                        {findingDispositions.map((disposition) => (
                          <option key={disposition} value={disposition}>
                            {reviewStatusValueLabel(t, 'findingDisposition', disposition)}
                          </option>
                        ))}
                      </select>
                      <input
                        className="h-8 rounded border border-slate-700 bg-slate-950 px-2 text-xs text-slate-100"
                        value={findingEdit.note}
                        placeholder={t('reviewStatus.placeholder.dispositionNote')}
                        onChange={(event) => setFindingEdit({ note: event.target.value })}
                      />
                      <button
                        type="button"
                        className="inline-flex h-8 items-center justify-center gap-1.5 rounded border border-slate-700 px-2.5 text-xs text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={!onUpdateFindingDisposition || busyFinding === finding.id}
                        onClick={async () => {
                          if (!onUpdateFindingDisposition) return;
                          setBusyFinding(finding.id);
                          setError(null);
                          try {
                            await onUpdateFindingDisposition(detail.session.id, finding.id, {
                              disposition: findingEdit.disposition,
                              note: findingEdit.note,
                              evidenceRefs: finding.evidenceRefs,
                            });
                          } catch (err) {
                            setError(
                              err instanceof Error
                                ? err.message
                                : t('reviewStatus.error.findingDispositionFailed')
                            );
                          } finally {
                            setBusyFinding(null);
                          }
                        }}
                      >
                        <Save className="h-3.5 w-3.5" />
                        {t('reviewStatus.action.save')}
                      </button>
                      <button
                        type="button"
                        className="inline-flex h-8 items-center justify-center gap-1.5 rounded border border-slate-700 px-2.5 text-xs text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={
                          !canCreateCandidate ||
                          !onCreateKnowledgeCandidate ||
                          busyCandidate === finding.id
                        }
                        onClick={async () => {
                          if (!onCreateKnowledgeCandidate) return;
                          setBusyCandidate(finding.id);
                          setError(null);
                          try {
                            await onCreateKnowledgeCandidate(detail.session.id, {
                              findingId: finding.id,
                              candidateType: 'rule',
                            });
                          } catch (err) {
                            setError(
                              err instanceof Error
                                ? err.message
                                : t('reviewStatus.error.knowledgeCandidateCreationFailed')
                            );
                          } finally {
                            setBusyCandidate(null);
                          }
                        }}
                      >
                        <ClipboardCheck className="h-3.5 w-3.5" />
                        {t('reviewStatus.action.candidate')}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        {detail.proposedGoals.length > 0 ? (
          <div className="grid gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                {t('reviewStatus.proposedGoals')}
              </div>
              <button
                type="button"
                className="inline-flex h-8 items-center justify-center gap-1.5 rounded border border-slate-700 px-2.5 text-xs text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!onCreateProposedGoals || busyGoal === 'sync'}
                onClick={async () => {
                  if (!onCreateProposedGoals) return;
                  setBusyGoal('sync');
                  setError(null);
                  try {
                    await onCreateProposedGoals(detail.session.id);
                  } catch (err) {
                    setError(
                      err instanceof Error
                        ? err.message
                        : t('reviewStatus.error.proposedGoalSyncFailed')
                    );
                  } finally {
                    setBusyGoal(null);
                  }
                }}
              >
                <ClipboardCheck className="h-3.5 w-3.5" />
                {t('reviewStatus.action.sync')}
              </button>
            </div>
            <div className="grid gap-3">
              {detail.proposedGoals.map((goal) => (
                <div
                  key={goal.id}
                  className="grid gap-3 rounded border border-slate-800 bg-slate-900/60 p-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-slate-100">{goal.title}</span>
                        <span className="rounded border border-slate-700 px-2 py-0.5 text-[11px] text-slate-300">
                          {reviewStatusValueLabel(t, 'proposedGoalStatus', goal.status)}
                        </span>
                      </div>
                      <div className="mt-1 text-xs leading-5 text-slate-400">
                        {goal.expectedOutcome}
                      </div>
                      {goal.materializedTaskId ? (
                        <div className="mt-1 font-mono text-[11px] text-emerald-300">
                          task:{goal.materializedTaskId}
                        </div>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {(['approved', 'rejected', 'deferred'] as const).map((nextStatus) => (
                        <button
                          key={nextStatus}
                          type="button"
                          className="inline-flex h-8 items-center justify-center rounded border border-slate-700 px-2.5 text-xs text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                          disabled={
                            goal.status === 'materialized' ||
                            !onUpdateProposedGoal ||
                            busyGoal === goal.id
                          }
                          onClick={async () => {
                            if (!onUpdateProposedGoal) return;
                            setBusyGoal(goal.id);
                            setError(null);
                            try {
                              await onUpdateProposedGoal(detail.session.id, goal.id, {
                                status: nextStatus,
                              });
                            } catch (err) {
                              setError(
                                err instanceof Error
                                  ? err.message
                                  : t('reviewStatus.error.proposedGoalUpdateFailed')
                              );
                            } finally {
                              setBusyGoal(null);
                            }
                          }}
                        >
                          {reviewStatusValueLabel(t, 'proposedGoalAction', nextStatus)}
                        </button>
                      ))}
                      <button
                        type="button"
                        className="inline-flex h-8 items-center justify-center rounded border border-slate-700 px-2.5 text-xs text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={
                          goal.status !== 'approved' ||
                          !onMaterializeProposedGoal ||
                          busyGoal === goal.id
                        }
                        onClick={async () => {
                          if (!onMaterializeProposedGoal) return;
                          setBusyGoal(goal.id);
                          setError(null);
                          try {
                            await onMaterializeProposedGoal(detail.session.id, goal.id);
                          } catch (err) {
                            setError(
                              err instanceof Error
                                ? err.message
                                : t('reviewStatus.error.taskMaterializationFailed')
                            );
                          } finally {
                            setBusyGoal(null);
                          }
                        }}
                      >
                        {t('reviewStatus.action.task')}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {detail.securityHandoffs.length > 0 ? (
          <div className="grid gap-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              {t('reviewStatus.securityHandoffs')}
            </div>
            <div className="grid gap-2">
              {detail.securityHandoffs.map((handoff) => (
                <div
                  key={handoff.id}
                  className="grid gap-2 rounded border border-slate-800 bg-slate-900/60 p-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <ShieldAlert className="h-3.5 w-3.5 text-amber-300" />
                    <span className="text-sm font-medium text-slate-100">{handoff.title}</span>
                    <span className="rounded border border-slate-700 px-2 py-0.5 text-[11px] text-slate-300">
                      {reviewStatusValueLabel(t, 'securityHandoffStatus', handoff.status)}
                    </span>
                  </div>
                  <div className="text-xs leading-5 text-slate-400">{handoff.summary}</div>
                  {handoff.changedPaths.length > 0 ? (
                    <div className="font-mono text-[11px] text-slate-500">
                      {handoff.changedPaths.join(', ')}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {detail.knowledgeCandidates.length > 0 ? (
          <div className="grid gap-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              {t('reviewStatus.knowledgeCandidates')}
            </div>
            <div className="grid gap-3">
              {detail.knowledgeCandidates.map((candidate) => {
                const edit = candidateEdits[candidate.id] ?? candidateEditState(candidate);
                const isLocked = candidate.status === 'sent' || candidate.status === 'discarded';
                const updateEdit = (patch: Partial<CandidateEditState>) => {
                  setCandidateEdits((prev) => ({
                    ...prev,
                    [candidate.id]: { ...edit, ...patch },
                  }));
                };
                return (
                  <div
                    key={candidate.id}
                    className="grid gap-3 rounded border border-slate-800 bg-slate-900/60 p-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-slate-100">
                          {candidate.title}
                        </span>
                        <span className="rounded border border-slate-700 px-2 py-0.5 text-[11px] text-slate-300">
                          {reviewStatusValueLabel(t, 'knowledgeCandidateStatus', candidate.status)}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="inline-flex h-8 items-center justify-center gap-1.5 rounded border border-slate-700 px-2.5 text-xs text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                          disabled={
                            isLocked ||
                            !onUpdateKnowledgeCandidate ||
                            busyCandidate === candidate.id
                          }
                          onClick={async () => {
                            if (!onUpdateKnowledgeCandidate) return;
                            setBusyCandidate(candidate.id);
                            setError(null);
                            try {
                              await onUpdateKnowledgeCandidate(
                                detail.session.id,
                                candidate.id,
                                edit
                              );
                            } catch (err) {
                              setError(
                                err instanceof Error
                                  ? err.message
                                  : t('reviewStatus.error.candidateSaveFailed')
                              );
                            } finally {
                              setBusyCandidate(null);
                            }
                          }}
                        >
                          <Save className="h-3.5 w-3.5" />
                          {t('reviewStatus.action.save')}
                        </button>
                        <button
                          type="button"
                          className="inline-flex h-8 items-center justify-center gap-1.5 rounded border border-slate-700 px-2.5 text-xs text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                          disabled={
                            isLocked || !onSendKnowledgeCandidate || busyCandidate === candidate.id
                          }
                          onClick={async () => {
                            if (!onSendKnowledgeCandidate) return;
                            setBusyCandidate(candidate.id);
                            setError(null);
                            try {
                              await onSendKnowledgeCandidate(detail.session.id, candidate.id);
                            } catch (err) {
                              setError(
                                err instanceof Error
                                  ? err.message
                                  : t('reviewStatus.error.candidateSendFailed')
                              );
                            } finally {
                              setBusyCandidate(null);
                            }
                          }}
                        >
                          <Send className="h-3.5 w-3.5" />
                          {t('reviewStatus.action.send')}
                        </button>
                        <button
                          type="button"
                          className="inline-flex h-8 items-center justify-center gap-1.5 rounded border border-slate-700 px-2.5 text-xs text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                          disabled={
                            isLocked ||
                            !onUpdateKnowledgeCandidate ||
                            busyCandidate === candidate.id
                          }
                          onClick={async () => {
                            if (!onUpdateKnowledgeCandidate) return;
                            setBusyCandidate(candidate.id);
                            setError(null);
                            try {
                              await onUpdateKnowledgeCandidate(detail.session.id, candidate.id, {
                                status: 'discarded',
                              });
                            } catch (err) {
                              setError(
                                err instanceof Error
                                  ? err.message
                                  : t('reviewStatus.error.candidateDiscardFailed')
                              );
                            } finally {
                              setBusyCandidate(null);
                            }
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          {t('reviewStatus.action.discard')}
                        </button>
                      </div>
                    </div>
                    <div className="grid gap-2 md:grid-cols-[180px_minmax(0,1fr)]">
                      <select
                        className="h-8 rounded border border-slate-700 bg-slate-950 px-2 text-xs text-slate-100 disabled:opacity-60"
                        value={edit.candidateType}
                        disabled={isLocked}
                        onChange={(event) =>
                          updateEdit({
                            candidateType: event.target
                              .value as ReviewKnowledgeCandidate['candidateType'],
                          })
                        }
                      >
                        <option value="rule">
                          {reviewStatusValueLabel(t, 'candidateType', 'rule')}
                        </option>
                        <option value="procedure">
                          {reviewStatusValueLabel(t, 'candidateType', 'procedure')}
                        </option>
                        <option value="failure_pattern">
                          {reviewStatusValueLabel(t, 'candidateType', 'failure_pattern')}
                        </option>
                      </select>
                      <input
                        className="h-8 rounded border border-slate-700 bg-slate-950 px-2 text-xs text-slate-100 disabled:opacity-60"
                        value={edit.title}
                        disabled={isLocked}
                        onChange={(event) => updateEdit({ title: event.target.value })}
                      />
                    </div>
                    <textarea
                      className="min-h-32 resize-y rounded border border-slate-700 bg-slate-950 px-2 py-2 font-mono text-xs leading-5 text-slate-100 disabled:opacity-60"
                      value={edit.body}
                      disabled={isLocked}
                      onChange={(event) => updateEdit({ body: event.target.value })}
                    />
                    <div className="grid gap-2 md:grid-cols-2">
                      <input
                        className="h-8 rounded border border-slate-700 bg-slate-950 px-2 text-xs text-slate-100 disabled:opacity-60"
                        value={edit.avoid ?? ''}
                        placeholder={t('reviewStatus.placeholder.avoid')}
                        disabled={isLocked}
                        onChange={(event) => updateEdit({ avoid: event.target.value || null })}
                      />
                      <input
                        className="h-8 rounded border border-slate-700 bg-slate-950 px-2 text-xs text-slate-100 disabled:opacity-60"
                        value={edit.prefer ?? ''}
                        placeholder={t('reviewStatus.placeholder.prefer')}
                        disabled={isLocked}
                        onChange={(event) => updateEdit({ prefer: event.target.value || null })}
                      />
                    </div>
                    {candidate.sendError ? (
                      <div className="rounded border border-amber-700/60 bg-amber-950/30 px-3 py-2 text-xs text-amber-100">
                        {candidate.sendError}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        <div className="grid gap-3 rounded border border-slate-800 bg-slate-900/60 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <CheckCircle2 className="h-4 w-4 text-emerald-300" />
            {t('reviewStatus.finalAction')}
          </div>
          {status.finalActionGate.blockingReason ? (
            <div className="rounded border border-amber-700/60 bg-amber-950/30 px-3 py-2 text-xs text-amber-100">
              {reviewStatusBlockingReason(t, status.finalActionGate.blockingReason)}
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {(['approve', 'request_changes', 'needs_human', 'exit_review'] as const).map(
              (action) => (
                <button
                  key={action}
                  type="button"
                  className="inline-flex h-8 items-center justify-center rounded border border-slate-700 px-3 text-xs text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={
                    busyAction === action ||
                    (action === 'approve' && !status.finalActionGate.canApprove) ||
                    (action === 'exit_review' && level === 'required') ||
                    !onFinalAction
                  }
                  onClick={async () => {
                    if (!onFinalAction) return;
                    setBusyAction(action);
                    setError(null);
                    try {
                      await onFinalAction(detail.session.id, { action });
                    } catch (err) {
                      setError(
                        err instanceof Error
                          ? err.message
                          : t('reviewStatus.error.finalActionFailed')
                      );
                    } finally {
                      setBusyAction(null);
                    }
                  }}
                >
                  {reviewStatusValueLabel(t, 'finalActionType', action)}
                </button>
              )
            )}
          </div>
          <div className="text-xs text-slate-500">
            {t('reviewStatus.finalCounts', {
              proposedGoalCount: status.proposedGoalCount,
              knowledgeCandidateCount: status.knowledgeCandidateCount,
              securityHandoffCount: status.securityHandoffCount ?? detail.securityHandoffs.length,
            })}
          </div>
          {error ? (
            <div className="rounded border border-red-800 bg-red-950/40 px-3 py-2 text-xs text-red-100">
              {error}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
