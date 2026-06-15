import { LoaderCircle } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toDeepRecord } from '../../../../shared/json-record';
import {
  fetchDesignQuestionnaireSessions,
  fetchSpecificationWorkspace,
  generateSpecificationWorkspaceArtifact,
  startDesignQuestionnaire,
  submitDesignQuestionnaireAnswers,
} from '../nightWorkersCommands';
import type {
  ActivityArtifact,
  BlueprintSpecificationWorkspace,
  DesignQuestionnaireAnswer,
  DesignQuestionnaireSession,
  TaskMessage,
} from '../types';
import {
  isDbDesignBlueprintMessage,
  isNormalBlueprintMessage,
  isReviewedSpecificationMessage,
  mergeWorkspaceTaskMessages,
} from '../workbenchSelectors';
import { MarkdownViewer } from './ArtifactFileViewers';
import {
  ActionButton,
  buildSubmittableQuestionnaireAnswers,
  getAnswerProgress,
  getQuestionCount,
  getUnansweredQuestions,
  QuestionnaireForm,
} from './ArtifactQuestionnaire';
import {
  SpecificationStatusView,
  WorkspaceBlueprintPreview,
  WorkspaceDbDesignPanel,
  WorkspaceList,
} from './ArtifactWorkspacePanels';

type WorkspaceTab = 'blueprints' | 'db-design' | 'questionnaire' | 'status' | 'specification';

export function BlueprintSpecificationWorkspaceViewer({
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
  initialTab?: WorkspaceTab;
  onQueueSession?: () => Promise<void>;
  onAddToQueue?: () => Promise<void>;
  isImplementationLocked?: boolean;
}) {
  const [workspace, setWorkspace] = useState<BlueprintSpecificationWorkspace | null>(null);
  const [sessions, setSessions] = useState<DesignQuestionnaireSession[]>([]);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>(initialTab || 'blueprints');
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, DesignQuestionnaireAnswer>>({});
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [assemblyReadySessionIds, setAssemblyReadySessionIds] = useState<Set<string>>(new Set());
  const [generatedMessages, setGeneratedMessages] = useState<TaskMessage[]>([]);
  const combinedTaskMessages = useMemo(
    () => mergeWorkspaceTaskMessages({ taskMessages, activityArtifacts, generatedMessages }),
    [activityArtifacts, generatedMessages, taskMessages]
  );
  const blueprintMessages = useMemo(
    () => combinedTaskMessages.filter(isNormalBlueprintMessage),
    [combinedTaskMessages]
  );
  const dbDesignMessages = useMemo(
    () => combinedTaskMessages.filter(isDbDesignBlueprintMessage),
    [combinedTaskMessages]
  );
  const designDocMessages = useMemo(
    () =>
      combinedTaskMessages.filter(
        (message) =>
          message.messageType === 'markdown_document' &&
          String(toDeepRecord(message.metadataJson).intent) === 'draft_spec'
      ),
    [combinedTaskMessages]
  );
  const reviewedDesignDocMessages = useMemo(
    () => designDocMessages.filter(isReviewedSpecificationMessage),
    [designDocMessages]
  );
  const activeBlueprintMessage = blueprintMessages.at(-1) || null;
  const activeDbDesignMessage = dbDesignMessages.at(-1) || null;
  const latestWorkspaceBlueprintMessageId =
    workspace?.blueprintArtifacts.at(-1)?.sourceMessageId || null;
  const activeBlueprintSourceMessageId = activeBlueprintMessage?.id?.startsWith('artifact-')
    ? latestWorkspaceBlueprintMessageId
    : activeBlueprintMessage?.id || latestWorkspaceBlueprintMessageId;

  const refresh = useCallback(async () => {
    if (!sessionId) return;
    const workspaceRes = await fetchSpecificationWorkspace(sessionId);
    if (workspaceRes.ok)
      setWorkspace((await workspaceRes.json()) as BlueprintSpecificationWorkspace);
    const sessionsRes = await fetchDesignQuestionnaireSessions(sessionId);
    if (sessionsRes.ok) {
      const nextSessions = (await sessionsRes.json()) as DesignQuestionnaireSession[];
      setSessions(nextSessions);
      if (nextSessions.length > 0 && blueprintMessages.length === 0 && activeTab === 'blueprints') {
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
    if (initialTab) setActiveTab(initialTab);
  }, [initialTab]);

  const activeQuestionnaireSession =
    sessions.find((session) => session.id === activeSessionId) || sessions[0] || null;
  const questionGroups =
    activeQuestionnaireSession?.questionSets.flatMap(
      (set) => set.questionnaire?.questionSets || []
    ) || [];
  const answerProgress = getAnswerProgress(questionGroups, answers);
  const unansweredQuestions = getUnansweredQuestions(questionGroups, answers);
  const isDesignAssemblyReady = Boolean(
    activeQuestionnaireSession &&
      (activeQuestionnaireSession.status === 'review_ready' ||
        activeQuestionnaireSession.status === 'accepted' ||
        assemblyReadySessionIds.has(activeQuestionnaireSession.id))
  );

  async function runAction(action: string, fn: () => Promise<void>) {
    setBusyAction(action);
    try {
      await fn();
      await refresh();
    } finally {
      setBusyAction(null);
    }
  }

  async function runSessionAction(action: string, fn?: () => Promise<void>) {
    if (!fn || isImplementationLocked) return;
    await runAction(action, fn);
  }

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
    action: 'blueprint' | 'db-design' | 'design-doc',
    nextTab: WorkspaceTab
  ) {
    if (!sessionId || !activeQuestionnaireSession) return;
    if (isImplementationLocked) return;
    await runAction(action, async () => {
      const res = await generateSpecificationWorkspaceArtifact(sessionId, action, {
        questionnaireSessionId: activeQuestionnaireSession.id,
        sourceBlueprintMessageId: activeBlueprintSourceMessageId || null,
      });
      if (!res.ok) throw new Error(await res.text());
      const result = (await res.json()) as {
        message?: TaskMessage;
        reviewedMessage?: TaskMessage;
        workspace?: BlueprintSpecificationWorkspace;
      };
      const generatedMessage = result.reviewedMessage || result.message;
      if (generatedMessage) {
        setGeneratedMessages((prev) => [...prev, generatedMessage]);
      }
      if (result.workspace) setWorkspace(result.workspace);
      setActiveTab(nextTab);
    });
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#1e1e2e] text-slate-100">
      <div className="shrink-0 border-slate-800 border-b px-5 py-3">
        <div className="text-[11px] font-semibold uppercase text-cyan-200">
          Specification Workspace
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          {[
            ['status', 'Status'],
            ['questionnaire', 'Questionnaire'],
            ['blueprints', 'Blueprints'],
            ['db-design', 'DB Design'],
            ['specification', 'Specification'],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              disabled={id === 'specification' && !isDesignAssemblyReady}
              className={`rounded border px-2 py-1 text-xs ${
                activeTab === id
                  ? 'border-cyan-400/70 bg-cyan-950/40 text-cyan-100'
                  : id === 'specification' && !isDesignAssemblyReady
                    ? 'cursor-not-allowed border-slate-800 bg-slate-950/10 text-slate-600'
                    : 'border-slate-700 bg-slate-950/20 text-slate-300 hover:border-slate-500'
              }`}
              onClick={() => {
                if (id === 'specification' && !isDesignAssemblyReady) return;
                setActiveTab(id as typeof activeTab);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="nightworkers-scrollbar min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {activeTab === 'blueprints' ? (
          <div className="grid gap-3">
            <WorkspaceBlueprintPreview sessionId={sessionId} message={activeBlueprintMessage} />
          </div>
        ) : activeTab === 'db-design' ? (
          <div className="grid gap-4">
            <WorkspaceList
              items={workspace?.dbDesignArtifacts || []}
              empty="No DB Design revisions."
            />
            <WorkspaceDbDesignPanel
              sessionId={sessionId}
              message={activeDbDesignMessage}
              empty="No DB Design artifact."
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
                  disabled={Boolean(busyAction) || isImplementationLocked}
                >
                  {busyAction === 'start' ? (
                    <LoaderCircle className="h-3 w-3 animate-spin" />
                  ) : null}
                  この画面案から質問を作成
                </button>
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
                    disabled={unansweredQuestions.length > 0 || isImplementationLocked}
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
                        .map((question: unknown) => String(toDeepRecord(question).question || ''))
                        .join(' / ')}
                    </span>
                  ) : null}
                </div>
              </>
            ) : (
              <p className="text-xs text-slate-500">No questionnaire session.</p>
            )}
          </div>
        ) : activeTab === 'status' ? (
          <SpecificationStatusView
            workspace={workspace}
            questionnaireSession={activeQuestionnaireSession}
            busyAction={busyAction}
            canGenerateDbDesign={Boolean(
              activeBlueprintSourceMessageId || workspace?.blueprintArtifacts.length
            )}
            hasSpecification={reviewedDesignDocMessages.length > 0}
            isImplementationLocked={isImplementationLocked}
            onOpenQuestionnaire={() => setActiveTab('questionnaire')}
            onGenerateBlueprint={() => generateSpecificationArtifact('blueprint', 'blueprints')}
            onGenerateDbDesign={() => generateSpecificationArtifact('db-design', 'db-design')}
            onGenerateSpecification={() =>
              generateSpecificationArtifact('design-doc', 'specification')
            }
            onQueueSession={
              onQueueSession ? () => runSessionAction('queue-session', onQueueSession) : undefined
            }
            onAddToQueue={
              onAddToQueue ? () => runSessionAction('add-to-queue', onAddToQueue) : undefined
            }
          />
        ) : (
          <MarkdownViewer
            content={
              (reviewedDesignDocMessages.at(-1) || designDocMessages.at(-1))?.content ||
              'No Specification artifact.'
            }
          />
        )}
      </div>
    </div>
  );
}
