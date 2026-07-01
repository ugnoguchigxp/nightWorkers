import { LoaderCircle } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { generateBlueprintArtifact } from '../blueprint';
import { generateDataModelArtifact } from '../dataModel';
import { MarkdownViewer } from '../nightworkers/components/ArtifactFileViewers';
import type {
  ActivityArtifact,
  DesignQuestionnaireAnswer,
  DesignQuestionnaireSession,
  GeneralSettings,
  PlanModeWorkspace,
  TaskMessage,
} from '../nightworkers/types';
import {
  fetchDesignQuestionnaireSessions,
  startDesignQuestionnaire,
  submitDesignQuestionnaireAnswers,
} from '../questionnaire';
import { fetchGeneralSettings } from '../settings';
import {
  fetchSpecificationWorkspace,
  generateSpecificationArtifact as generateDesignDocArtifact,
  getPlanModeCapabilities,
  type PlanWorkspaceTab,
  selectSpecificationWorkspaceMessages,
} from '../specification';
import {
  ActionButton,
  buildSubmittableQuestionnaireAnswers,
  getAnswerProgress,
  getQuestionCount,
  getUnansweredQuestions,
  QuestionnaireForm,
} from './PlanModeQuestionnaire';
import {
  DedicatedViewPanel,
  type PlanViewDecision,
  PlanWorkspaceStatusView,
  ViewDecisionSummary,
  WorkspaceBlueprintPreview,
  WorkspaceDataModelPanel,
  WorkspaceList,
} from './PlanModeWorkspacePanels';

const additionalPlanViewTabs = [
  'api-io-contract',
  'state-model',
  'activity-flow',
  'sequence-flow',
  'zod-schema-design',
] as const;

const tabToPlanView = {
  'api-io-contract': 'api_io_contract',
  'state-model': 'state_model',
  'activity-flow': 'activity_flow',
  'sequence-flow': 'sequence_flow',
  'zod-schema-design': 'zod_schema_design',
} as const;

const tabLabels: Record<PlanWorkspaceTab, string> = {
  'feature-plan': 'Feature Plan',
  status: 'Status',
  questionnaire: 'Questionnaire',
  blueprint: 'Blueprint',
  'data-model': 'Data Model',
  'api-io-contract': 'API / I/O',
  'state-model': 'State',
  'activity-flow': 'Activity',
  'sequence-flow': 'Sequence',
  'zod-schema-design': 'Zod',
};

export function PlanModeWorkspaceViewer({
  sessionId,
  taskMessages,
  activityArtifacts = [],
  initialTab,
  onQueueSession,
  onAddToQueue,
  isImplementationLocked = false,
}: {
  sessionId: string | null;
  taskMessages: TaskMessage[];
  activityArtifacts?: ActivityArtifact[];
  initialTab?: PlanWorkspaceTab;
  onQueueSession?: () => Promise<void>;
  onAddToQueue?: () => Promise<void>;
  isImplementationLocked?: boolean;
}) {
  const [workspace, setWorkspace] = useState<PlanModeWorkspace | null>(null);
  const [sessions, setSessions] = useState<DesignQuestionnaireSession[]>([]);
  const [activeTab, setActiveTab] = useState<PlanWorkspaceTab>(initialTab || 'status');
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, DesignQuestionnaireAnswer>>({});
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [generalSettings, setGeneralSettings] = useState<GeneralSettings | null>(null);
  const [, setAssemblyReadySessionIds] = useState<Set<string>>(new Set());
  const [generatedMessages, setGeneratedMessages] = useState<TaskMessage[]>([]);
  const workspaceMessages = useMemo(
    () =>
      selectSpecificationWorkspaceMessages({
        taskMessages,
        activityArtifacts,
        generatedMessages,
        workspace,
      }),
    [activityArtifacts, generatedMessages, taskMessages, workspace]
  );
  const {
    blueprintMessages,
    designDocMessages,
    reviewedDesignDocMessages,
    activeBlueprintMessage,
    activeDataModelMessage,
    activeBlueprintSourceMessageId,
  } = workspaceMessages;
  const featurePlanMessage = reviewedDesignDocMessages.at(-1) || designDocMessages.at(-1) || null;
  const viewDecisions = useMemo(() => extractViewDecisions(taskMessages), [taskMessages]);
  const includedViews = useMemo(
    () =>
      new Set(viewDecisions.filter((item) => item.decision === 'include').map((item) => item.view)),
    [viewDecisions]
  );
  const hasFeaturePlan = Boolean(featurePlanMessage || workspace?.featurePlanArtifacts.length);
  const hasQuestionnaire = sessions.length > 0 || Boolean(workspace?.questionnaireSessions.length);
  const hasBlueprint = Boolean(activeBlueprintMessage || workspace?.blueprintArtifacts.length);
  const hasDataModel = Boolean(activeDataModelMessage || workspace?.dataModelArtifacts.length);
  const visibleTabs = useMemo<PlanWorkspaceTab[]>(() => {
    const additionalTabs = additionalPlanViewTabs.filter((tab) => {
      const view = tabToPlanView[tab];
      return (
        workspace?.dedicatedViewArtifacts.some((artifact) => artifact.kind === view) ||
        includedViews.has(view)
      );
    });
    return [
      ...(hasFeaturePlan ? (['feature-plan'] as const) : []),
      'status',
      ...(hasQuestionnaire || includedViews.has('questionnaire')
        ? (['questionnaire'] as const)
        : []),
      ...(hasBlueprint || includedViews.has('blueprint') ? (['blueprint'] as const) : []),
      ...(hasDataModel || includedViews.has('data_model') ? (['data-model'] as const) : []),
      ...additionalTabs,
    ];
  }, [
    hasBlueprint,
    hasDataModel,
    hasFeaturePlan,
    hasQuestionnaire,
    includedViews,
    workspace?.dedicatedViewArtifacts,
  ]);
  const defaultTab: PlanWorkspaceTab = hasFeaturePlan ? 'feature-plan' : 'status';

  const refresh = useCallback(async () => {
    if (!sessionId) return;
    const workspaceRes = await fetchSpecificationWorkspace(sessionId);
    if (workspaceRes.ok) setWorkspace((await workspaceRes.json()) as PlanModeWorkspace);
    const sessionsRes = await fetchDesignQuestionnaireSessions(sessionId);
    if (sessionsRes.ok) {
      const nextSessions = (await sessionsRes.json()) as DesignQuestionnaireSession[];
      setSessions(nextSessions);
      if (nextSessions.length > 0 && blueprintMessages.length === 0 && activeTab === 'blueprint') {
        setActiveTab('questionnaire');
      }
      const selected = nextSessions.find((item) => item.id === activeSessionId) || nextSessions[0];
      if (selected) {
        setActiveSessionId(selected.id);
        setAnswers(
          Object.fromEntries(selected.answers.map((item) => [item.questionId, item.answer]))
        );
      }
    }
  }, [activeSessionId, activeTab, blueprintMessages.length, sessionId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const controller = new AbortController();
    fetchGeneralSettings({ signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) return null;
        return (await res.json()) as GeneralSettings;
      })
      .then((settings) => {
        if (!controller.signal.aborted) setGeneralSettings(settings);
      })
      .catch((error) => {
        if (error?.name !== 'AbortError') console.warn('Failed to load Plan Mode settings', error);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (initialTab) setActiveTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    if (initialTab) return;
    if (!visibleTabs.includes(activeTab)) setActiveTab(defaultTab);
  }, [activeTab, defaultTab, initialTab, visibleTabs]);

  const activeQuestionnaireSession =
    sessions.find((session) => session.id === activeSessionId) || sessions[0] || null;
  const questionGroups =
    activeQuestionnaireSession?.questionSets.flatMap(
      (set) => set.questionnaire?.questionSets || []
    ) || [];
  const answerProgress = getAnswerProgress(questionGroups, answers);
  const unansweredQuestions = getUnansweredQuestions(questionGroups, answers);
  const canGenerateDataModel = Boolean(activeQuestionnaireSession || featurePlanMessage);

  async function runAction(action: string, fn: () => Promise<void>) {
    setBusyAction(action);
    setActionError(null);
    try {
      await fn();
      await refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setActionError(message);
    } finally {
      setBusyAction(null);
    }
  }

  async function runSessionAction(action: string, fn?: () => Promise<void>) {
    if (!fn || isImplementationLocked) return;
    await runAction(action, fn);
  }

  const planModeCapabilities = getPlanModeCapabilities(generalSettings);
  const planModeDisabledReason = 'Plan Mode capability is disabled in Settings.';

  async function startQuestionnaire() {
    if (!sessionId || !activeBlueprintMessage) return;
    if (isImplementationLocked) return;
    await runAction('start', async () => {
      const res = await startDesignQuestionnaire(sessionId, {
        sourceBlueprintMessageId: activeBlueprintMessage.id,
      });
      if (!res.ok) throw new Error(await res.text());
      const created = (await res.json()) as DesignQuestionnaireSession;
      setActiveSessionId(created.id);
      setActiveTab('questionnaire');
    });
  }

  async function submitAnswersForNextStep() {
    if (!sessionId || !activeQuestionnaireSession) return;
    if (unansweredQuestions.length > 0) return;
    if (isImplementationLocked) return;
    await runAction('submit-answers', async () => {
      const answersRes = await submitDesignQuestionnaireAnswers(
        sessionId,
        activeQuestionnaireSession.id,
        { answers: buildSubmittableQuestionnaireAnswers(questionGroups, answers) }
      );
      if (!answersRes.ok) throw new Error(await answersRes.text());
      const updatedSession = (await answersRes.json()) as DesignQuestionnaireSession;
      setSessions((prev) => {
        const exists = prev.some((session) => session.id === updatedSession.id);
        if (!exists) return [updatedSession, ...prev];
        return prev.map((session) => (session.id === updatedSession.id ? updatedSession : session));
      });
      setActiveSessionId(updatedSession.id);
      setAnswers(
        Object.fromEntries(updatedSession.answers.map((item) => [item.questionId, item.answer]))
      );
      if (updatedSession.status === 'review_ready') {
        setAssemblyReadySessionIds((prev) => new Set([...prev, updatedSession.id]));
        setActiveTab('status');
      }
    });
  }

  async function generateSpecificationArtifact(
    action: 'blueprint' | 'data-model' | 'feature-plan',
    nextTab: PlanWorkspaceTab
  ) {
    if (!sessionId || !activeQuestionnaireSession) return;
    if (isImplementationLocked) return;
    await runAction(action, async () => {
      const input = {
        questionnaireSessionId: activeQuestionnaireSession.id,
        sourceBlueprintMessageId: activeBlueprintSourceMessageId || null,
      };
      const res =
        action === 'blueprint'
          ? await generateBlueprintArtifact(sessionId, input)
          : action === 'data-model'
            ? await generateDataModelArtifact(sessionId, input)
            : await generateDesignDocArtifact(sessionId, input);
      if (!res.ok) throw new Error(await res.text());
      const result = (await res.json()) as {
        message?: TaskMessage;
        reviewedMessage?: TaskMessage;
        workspace?: PlanModeWorkspace;
      };
      const generatedMessage = result.reviewedMessage || result.message;
      if (generatedMessage) {
        setGeneratedMessages((prev) => [...prev, generatedMessage]);
      }
      if (result.workspace) setWorkspace(result.workspace);
      setActiveTab(nextTab);
    });
  }

  const activeDedicatedView =
    activeTab in tabToPlanView ? tabToPlanView[activeTab as keyof typeof tabToPlanView] : null;
  const activeDedicatedArtifact = activeDedicatedView
    ? workspace?.dedicatedViewArtifacts.find((artifact) => artifact.kind === activeDedicatedView) ||
      null
    : null;
  const activeDedicatedMessage = activeDedicatedArtifact
    ? workspaceMessages.combinedTaskMessages.find(
        (message) => message.id === activeDedicatedArtifact.sourceMessageId
      ) || null
    : null;

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#1e1e2e] text-slate-100">
      <div className="shrink-0 border-slate-800 border-b px-5 py-3">
        <div className="text-[11px] font-semibold uppercase text-cyan-200">Plan Mode Workspace</div>
        <div className="mt-2 flex flex-wrap gap-1">
          {visibleTabs.map((id) => (
            <button
              key={id}
              type="button"
              className={`rounded border px-2 py-1 text-xs ${
                activeTab === id
                  ? 'border-cyan-400/70 bg-cyan-950/40 text-cyan-100'
                  : 'border-slate-700 bg-slate-950/20 text-slate-300 hover:border-slate-500'
              }`}
              onClick={() => setActiveTab(id)}
            >
              {tabLabels[id]}
            </button>
          ))}
        </div>
      </div>
      <div className="nightworkers-scrollbar min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {activeTab === 'feature-plan' ? (
          <MarkdownViewer content={featurePlanMessage?.content || 'No Feature Plan artifact.'} />
        ) : activeTab === 'blueprint' ? (
          <div className="grid gap-3">
            <WorkspaceBlueprintPreview sessionId={sessionId} message={activeBlueprintMessage} />
          </div>
        ) : activeTab === 'data-model' ? (
          <div className="grid gap-4">
            <WorkspaceList
              items={workspace?.dataModelArtifacts || []}
              empty="No Data Model revisions."
            />
            <WorkspaceDataModelPanel
              message={activeDataModelMessage}
              empty="No Data Model artifact."
            />
          </div>
        ) : activeTab === 'questionnaire' ? (
          <div className="grid gap-4">
            <div className="flex flex-wrap items-center gap-2">
              {activeBlueprintMessage ? (
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded border border-cyan-500/60 bg-cyan-950/30 px-2 py-1 text-xs text-cyan-100 disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={startQuestionnaire}
                  disabled={
                    Boolean(busyAction) ||
                    isImplementationLocked ||
                    !planModeCapabilities.questionnaire
                  }
                >
                  {busyAction === 'start' ? (
                    <LoaderCircle className="h-3 w-3 animate-spin" />
                  ) : null}
                  この画面案から質問を作成
                </button>
              ) : null}
              {!planModeCapabilities.questionnaire ? (
                <span className="text-[11px] text-amber-300">{planModeDisabledReason}</span>
              ) : null}
              {sessions.map((session) => (
                <button
                  key={session.id}
                  type="button"
                  className={`rounded border px-2 py-1 text-xs ${
                    activeQuestionnaireSession?.id === session.id
                      ? 'border-cyan-400/70 bg-cyan-950/40 text-cyan-100'
                      : 'border-slate-700 text-slate-300'
                  }`}
                  onClick={() => {
                    setActiveSessionId(session.id);
                    setAnswers(
                      Object.fromEntries(
                        session.answers.map((item) => [item.questionId, item.answer])
                      )
                    );
                  }}
                >
                  {session.status} {session.answers.length}/{getQuestionCount(session)}
                </button>
              ))}
            </div>
            {activeQuestionnaireSession ? (
              <>
                <QuestionnaireForm
                  questionGroups={questionGroups}
                  answers={answers}
                  onChange={setAnswers}
                  readOnly={isImplementationLocked}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <ActionButton
                    label={
                      unansweredQuestions.length > 0
                        ? `未回答 ${unansweredQuestions.length}件`
                        : '回答を送信して次へ'
                    }
                    icon="send"
                    busy={busyAction === 'submit-answers'}
                    disabled={
                      unansweredQuestions.length > 0 ||
                      isImplementationLocked ||
                      !planModeCapabilities.questionnaire
                    }
                    onClick={submitAnswersForNextStep}
                  />
                  <span
                    className="text-[11px] text-slate-500"
                    aria-live="polite"
                    data-questionnaire-state={
                      answerProgress.unansweredCount > 0 ? 'incomplete' : 'ready'
                    }
                  >
                    {answerProgress.answeredCount}/{answerProgress.totalCount} 回答済み
                  </span>
                  {unansweredQuestions.length > 0 ? (
                    <span className="text-[11px] text-amber-300" aria-live="polite">
                      未回答:{' '}
                      {unansweredQuestions
                        .map((question) => String(question.question || ''))
                        .join(' / ')}
                    </span>
                  ) : null}
                  {!planModeCapabilities.questionnaire ? (
                    <span className="text-[11px] text-amber-300">{planModeDisabledReason}</span>
                  ) : null}
                </div>
              </>
            ) : (
              <p className="text-xs text-slate-500">No questionnaire session.</p>
            )}
          </div>
        ) : activeTab === 'status' ? (
          <PlanWorkspaceStatusView
            workspace={workspace}
            questionnaireSession={activeQuestionnaireSession}
            busyAction={busyAction}
            canGenerateDataModel={canGenerateDataModel}
            hasFeaturePlan={hasFeaturePlan}
            isImplementationLocked={isImplementationLocked}
            planModeSettings={generalSettings?.planMode}
            viewDecisions={viewDecisions}
            onOpenQuestionnaire={() => setActiveTab('questionnaire')}
            onGenerateBlueprint={() => generateSpecificationArtifact('blueprint', 'blueprint')}
            onGenerateDataModel={() => generateSpecificationArtifact('data-model', 'data-model')}
            onGenerateFeaturePlan={() =>
              generateSpecificationArtifact('feature-plan', 'feature-plan')
            }
            onQueueSession={
              onQueueSession ? () => runSessionAction('start-session', onQueueSession) : undefined
            }
            onAddToQueue={
              onAddToQueue ? () => runSessionAction('add-to-queue', onAddToQueue) : undefined
            }
          />
        ) : activeDedicatedView ? (
          <DedicatedViewPanel artifact={activeDedicatedArtifact} message={activeDedicatedMessage} />
        ) : (
          <div className="grid gap-4">
            <ViewDecisionSummary decisions={viewDecisions} />
            <MarkdownViewer content="Select a Plan Mode view." />
          </div>
        )}
        {actionError ? (
          <p
            role="alert"
            className="mt-3 rounded border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-200"
          >
            {actionError}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function extractViewDecisions(messages: TaskMessage[]): PlanViewDecision[] {
  const decisions: PlanViewDecision[] = [];
  const seen = new Set<string>();
  for (const message of messages) {
    const metadata = isRecord(message.metadataJson) ? message.metadataJson : {};
    const candidates = [
      metadata.dedicatedViews,
      metadata.viewDecisions,
      isRecord(metadata.planMode) ? metadata.planMode.dedicatedViews : null,
    ];
    for (const candidate of candidates) {
      if (!Array.isArray(candidate)) continue;
      for (const item of candidate) {
        if (!isRecord(item)) continue;
        const view = typeof item.view === 'string' ? item.view : '';
        const decision =
          item.decision === 'include' || item.decision === 'omit' ? item.decision : null;
        if (!view || !decision) continue;
        const key = `${view}:${decision}`;
        if (seen.has(key)) continue;
        seen.add(key);
        decisions.push({
          view,
          decision,
          reason: typeof item.reason === 'string' ? item.reason : undefined,
        });
      }
    }
  }
  return decisions;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
