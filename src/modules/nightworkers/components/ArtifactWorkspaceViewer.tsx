import { LoaderCircle } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../../lib/api-base';
import type {
  BlueprintSpecificationWorkspace,
  DesignQuestionnaireAnswer,
  DesignQuestionnaireSession,
  TaskMessage,
} from '../types';
import { MarkdownViewer } from './ArtifactFileViewers';
import {
  ActionButton,
  buildSubmittableQuestionnaireAnswers,
  getAnswerProgress,
  getQuestionCount,
  QuestionnaireForm,
} from './ArtifactQuestionnaire';
import { BlueprintPreview } from './blueprint-preview';

type WorkspaceTab =
  | 'blueprints'
  | 'db-design'
  | 'questionnaire'
  | 'specification-status'
  | 'specification';

export function BlueprintSpecificationWorkspaceViewer({
  sessionId,
  taskMessages,
  initialTab,
}: {
  sessionId: string | null;
  taskMessages: TaskMessage[];
  initialTab?: WorkspaceTab;
}) {
  const [workspace, setWorkspace] = useState<BlueprintSpecificationWorkspace | null>(null);
  const [sessions, setSessions] = useState<DesignQuestionnaireSession[]>([]);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>(initialTab || 'blueprints');
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, DesignQuestionnaireAnswer>>({});
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [assemblyReadySessionIds, setAssemblyReadySessionIds] = useState<Set<string>>(new Set());
  const [generatedMessages, setGeneratedMessages] = useState<TaskMessage[]>([]);
  const combinedTaskMessages = useMemo(() => {
    const existingIds = new Set(taskMessages.map((message) => message.id));
    return [
      ...taskMessages,
      ...generatedMessages.filter((message) => !existingIds.has(message.id)),
    ];
  }, [generatedMessages, taskMessages]);
  const blueprintMessages = useMemo(
    () =>
      combinedTaskMessages.filter((message) => {
        const metadata = message.metadataJson || {};
        return (
          message.messageType === 'markdown_document' &&
          (metadata.intent === 'app_blueprint' || metadata.appBlueprint) &&
          metadata.source !== 'blueprint-db-design' &&
          !metadata.dbDesignTarget
        );
      }),
    [combinedTaskMessages]
  );
  const dbDesignMessages = useMemo(
    () =>
      combinedTaskMessages.filter((message) => {
        const metadata = message.metadataJson || {};
        return (
          message.messageType === 'markdown_document' &&
          (metadata.intent === 'app_blueprint' || metadata.appBlueprint) &&
          (metadata.source === 'blueprint-db-design' || metadata.dbDesignTarget)
        );
      }),
    [combinedTaskMessages]
  );
  const designDocMessages = useMemo(
    () =>
      combinedTaskMessages.filter(
        (message) =>
          message.messageType === 'markdown_document' &&
          message.metadataJson?.intent === 'draft_spec'
      ),
    [combinedTaskMessages]
  );
  const activeBlueprintMessage = blueprintMessages.at(-1) || null;

  const refresh = useCallback(async () => {
    if (!sessionId) return;
    const workspaceRes = await apiFetch(`/api/tasks/${sessionId}/specification-workspace`);
    if (workspaceRes.ok)
      setWorkspace((await workspaceRes.json()) as BlueprintSpecificationWorkspace);
    const sessionsRes = await apiFetch(`/api/tasks/${sessionId}/design-questionnaire`);
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

  async function startQuestionnaire() {
    if (!sessionId || !activeBlueprintMessage) return;
    await runAction('start', async () => {
      const res = await apiFetch(`/api/tasks/${sessionId}/design-questionnaire`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceBlueprintMessageId: activeBlueprintMessage.id }),
      });
      if (!res.ok) throw new Error(await res.text());
      const created = (await res.json()) as DesignQuestionnaireSession;
      setActiveSessionId(created.id);
      setActiveTab('questionnaire');
    });
  }

  async function submitAnswersForNextStep() {
    if (!sessionId || !activeQuestionnaireSession) return;
    await runAction('submit-answers', async () => {
      const answersRes = await apiFetch(
        `/api/tasks/${sessionId}/design-questionnaire/${activeQuestionnaireSession.id}/answers`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            answers: buildSubmittableQuestionnaireAnswers(questionGroups, answers),
          }),
        }
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
        setActiveTab('specification-status');
      }
    });
  }

  async function generateSpecificationArtifact(
    action: 'blueprint' | 'db-design' | 'design-doc',
    nextTab: WorkspaceTab
  ) {
    if (!sessionId || !activeQuestionnaireSession) return;
    await runAction(action, async () => {
      const res = await apiFetch(`/api/tasks/${sessionId}/specification-workspace/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          questionnaireSessionId: activeQuestionnaireSession.id,
          sourceBlueprintMessageId: activeBlueprintMessage?.id || null,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const result = (await res.json()) as {
        message?: TaskMessage;
        workspace?: BlueprintSpecificationWorkspace;
      };
      if (result.message) {
        setGeneratedMessages((prev) => [...prev, result.message as TaskMessage]);
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
            ['blueprints', 'Blueprints'],
            ['db-design', 'DB Design'],
            ['questionnaire', 'Questionnaire'],
            ['specification-status', 'Specification Status'],
            ['specification', 'Specification'],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              disabled={
                (id === 'specification-status' || id === 'specification') && !isDesignAssemblyReady
              }
              className={`rounded border px-2 py-1 text-xs ${
                activeTab === id
                  ? 'border-cyan-400/70 bg-cyan-950/40 text-cyan-100'
                  : (id === 'specification-status' || id === 'specification') &&
                      !isDesignAssemblyReady
                    ? 'cursor-not-allowed border-slate-800 bg-slate-950/10 text-slate-600'
                    : 'border-slate-700 bg-slate-950/20 text-slate-300 hover:border-slate-500'
              }`}
              onClick={() => {
                if (
                  (id === 'specification-status' || id === 'specification') &&
                  !isDesignAssemblyReady
                )
                  return;
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
            <MarkdownViewer
              content={dbDesignMessages.at(-1)?.content || 'No DB Design artifact.'}
            />
          </div>
        ) : activeTab === 'questionnaire' ? (
          <div className="grid gap-4">
            <div className="flex flex-wrap items-center gap-2">
              {activeBlueprintMessage ? (
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded border border-cyan-500/60 bg-cyan-950/30 px-2 py-1 text-xs text-cyan-100 disabled:cursor-wait disabled:opacity-60"
                  onClick={startQuestionnaire}
                  disabled={Boolean(busyAction)}
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
                    label="回答を送信して次へ"
                    icon="send"
                    busy={busyAction === 'submit-answers'}
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
                </div>
              </>
            ) : (
              <p className="text-xs text-slate-500">No questionnaire session.</p>
            )}
          </div>
        ) : activeTab === 'specification-status' ? (
          <SpecificationStatusView
            workspace={workspace}
            questionnaireSession={activeQuestionnaireSession}
            busyAction={busyAction}
            canGenerateDbDesign={Boolean(
              activeBlueprintMessage || workspace?.blueprintArtifacts.length
            )}
            onGenerateBlueprint={() => generateSpecificationArtifact('blueprint', 'blueprints')}
            onGenerateDbDesign={() => generateSpecificationArtifact('db-design', 'db-design')}
            onGenerateSpecification={() =>
              generateSpecificationArtifact('design-doc', 'specification')
            }
          />
        ) : (
          <MarkdownViewer
            content={designDocMessages.at(-1)?.content || 'No Specification artifact.'}
          />
        )}
      </div>
    </div>
  );
}

function WorkspaceBlueprintPreview({
  sessionId,
  message,
}: {
  sessionId: string | null;
  message: TaskMessage | null;
}) {
  const blueprint = message?.metadataJson?.appBlueprint;
  if (!isRecord(blueprint)) {
    return <MarkdownViewer content={message?.content || 'No Blueprint artifact.'} />;
  }
  const screens = toRecordArray(blueprint.screens);
  const tables =
    isRecord(blueprint.databaseSchema) && Array.isArray(blueprint.databaseSchema.tables)
      ? toRecordArray(blueprint.databaseSchema.tables)
      : [];
  const bindings = toRecordArray(blueprint.dataBindings);
  const validation = message?.metadataJson?.validation;
  const issues = isRecord(validation) ? toRecordArray(validation.issues) : [];
  return (
    <BlueprintPreview
      key={String(blueprint.id || blueprint.name || screens[0]?.id || message?.id || 'blueprint')}
      sessionId={sessionId}
      messageId={message?.id || null}
      blueprint={blueprint}
      screens={screens}
      tables={tables}
      bindings={bindings}
      validationIssues={issues}
    />
  );
}

function SpecificationStatusView({
  workspace,
  questionnaireSession,
  busyAction,
  canGenerateDbDesign,
  onGenerateBlueprint,
  onGenerateDbDesign,
  onGenerateSpecification,
}: {
  workspace: BlueprintSpecificationWorkspace | null;
  questionnaireSession: DesignQuestionnaireSession | null;
  busyAction: string | null;
  canGenerateDbDesign: boolean;
  onGenerateBlueprint: () => void;
  onGenerateDbDesign: () => void;
  onGenerateSpecification: () => void;
}) {
  const answeredCount = questionnaireSession?.answers.length || 0;
  const questionCount = questionnaireSession ? getQuestionCount(questionnaireSession) : 0;
  const hasBlueprint = Boolean(workspace?.blueprintArtifacts.length);
  const hasDbDesign = Boolean(workspace?.dbDesignArtifacts.length);
  return (
    <div className="grid gap-4 text-xs">
      <section className="rounded border border-slate-800 bg-slate-950/20 p-3">
        <h2 className="text-sm font-semibold text-slate-100">Specification Status</h2>
        <div className="mt-2 grid gap-1 text-slate-400">
          <div>
            Questionnaire {answeredCount}/{questionCount}
          </div>
          <div>Blueprint {workspace?.blueprintArtifacts.length || 0}</div>
          <div>DB Design {workspace?.dbDesignArtifacts.length || 0}</div>
          <div>Implementation {workspace?.implementationReferences.length || 0}</div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <StatusActionButton
            label={hasBlueprint ? 'Blueprint を再生成' : 'Blueprint を生成'}
            busy={busyAction === 'blueprint'}
            onClick={onGenerateBlueprint}
          />
          <StatusActionButton
            label={hasDbDesign ? 'DB Design を再提案' : 'DB Design を提案'}
            busy={busyAction === 'db-design'}
            disabled={!canGenerateDbDesign}
            onClick={onGenerateDbDesign}
          />
          <StatusActionButton
            label="Specification を作成"
            busy={busyAction === 'design-doc'}
            onClick={onGenerateSpecification}
          />
        </div>
      </section>
    </div>
  );
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function toRecordArray(value: unknown): Array<Record<string, any>> {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function StatusActionButton({
  label,
  busy,
  disabled,
  onClick,
}: {
  label: string;
  busy: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1.5 rounded border border-cyan-500/60 bg-cyan-950/30 px-2 py-1 text-xs text-cyan-100 disabled:cursor-not-allowed disabled:opacity-45"
      disabled={busy || disabled}
      onClick={onClick}
    >
      {busy ? <LoaderCircle className="h-3 w-3 animate-spin" /> : null}
      {label}
    </button>
  );
}

function WorkspaceList({
  items,
  empty,
}: {
  items: Array<{
    id: string;
    title: string;
    sourceMessageId?: string;
    status?: string;
    adoptionState?: string;
    kind?: string;
  }>;
  empty: string;
}) {
  if (items.length === 0) return <p className="text-xs text-slate-500">{empty}</p>;
  return (
    <div className="grid gap-2">
      {items.map((item) => (
        <div key={item.id} className="rounded border border-slate-800 bg-slate-950/20 p-3 text-xs">
          <div className="font-medium text-slate-100">{item.title}</div>
          <div className="mt-1 text-slate-500">
            {item.kind || 'artifact'}{' '}
            {item.sourceMessageId ? `message ${item.sourceMessageId.slice(0, 8)}` : ''}
            {item.adoptionState ? ` · ${item.adoptionState}` : ''}
          </div>
        </div>
      ))}
    </div>
  );
}
