import { Check, LoaderCircle } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../../lib/api-base';
import type {
  ActivityArtifact,
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
  getUnansweredQuestions,
  QuestionnaireForm,
} from './ArtifactQuestionnaire';
import { BlueprintDbDesignPanel, BlueprintPreview } from './blueprint-preview';
import {
  type BlueprintPreviewDesignSettings,
  createBlueprintPreviewDesignSettings,
} from './blueprint-preview/designSettings';

type WorkspaceTab = 'blueprints' | 'db-design' | 'questionnaire' | 'status' | 'specification';

function activityArtifactToTaskMessage(artifact: ActivityArtifact): TaskMessage {
  const metadata =
    artifact.metadataJson && typeof artifact.metadataJson === 'object' ? artifact.metadataJson : {};
  const appBlueprint = metadata.appBlueprint || parseArtifactContentJson(artifact.contentText);
  return {
    id: `artifact-${artifact.id}`,
    taskId: artifact.taskId,
    runId: artifact.runId || null,
    role: 'assistant',
    content: artifact.contentText || '',
    messageType: 'markdown_document',
    metadataJson: {
      ...metadata,
      intent: metadata.intent || 'app_blueprint',
      artifactRef: { artifactId: artifact.id, kind: 'app_blueprint', version: 1 },
      appBlueprint,
    },
    createdAt: artifact.createdAt,
  };
}

function taskMessageArtifactId(message: TaskMessage): string | null {
  const artifactRef = message.metadataJson?.artifactRef;
  return typeof artifactRef?.artifactId === 'string' ? artifactRef.artifactId : null;
}

export function mergeWorkspaceTaskMessages({
  taskMessages,
  activityArtifacts,
  generatedMessages,
}: {
  taskMessages: TaskMessage[];
  activityArtifacts: ActivityArtifact[];
  generatedMessages: TaskMessage[];
}) {
  const existingMessageIds = new Set(taskMessages.map((message) => message.id));
  const existingArtifactIds = new Set(
    taskMessages.map(taskMessageArtifactId).filter((id): id is string => Boolean(id))
  );
  const syntheticArtifactMessages = activityArtifacts
    .filter(
      (artifact) => artifact.kind === 'app_blueprint' && !existingArtifactIds.has(artifact.id)
    )
    .map(activityArtifactToTaskMessage)
    .filter((message) => !existingMessageIds.has(message.id));
  const nextIds = new Set([
    ...existingMessageIds,
    ...syntheticArtifactMessages.map((message) => message.id),
  ]);
  return [
    ...taskMessages,
    ...syntheticArtifactMessages,
    ...generatedMessages.filter((message) => !nextIds.has(message.id)),
  ];
}

export function isReviewedSpecificationMessage(message: TaskMessage) {
  const metadata = message.metadataJson || {};
  return (
    message.messageType === 'markdown_document' &&
    metadata.intent === 'draft_spec' &&
    metadata.source === 'status_document_review' &&
    typeof metadata.reviewedSourceMessageId === 'string'
  );
}

function parseArtifactContentJson(content: string | null | undefined): any {
  if (!content?.trim()) return null;
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

export function BlueprintSpecificationWorkspaceViewer({
  sessionId,
  taskMessages,
  activityArtifacts = [],
  initialTab,
  onQueueSession,
  onStartImplementation,
}: {
  sessionId: string | null;
  taskMessages: TaskMessage[];
  activityArtifacts?: ActivityArtifact[];
  initialTab?: WorkspaceTab;
  onQueueSession?: () => Promise<void>;
  onStartImplementation?: () => Promise<void>;
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
    () =>
      combinedTaskMessages.filter((message) => {
        const metadata = message.metadataJson || {};
        return (
          message.messageType === 'markdown_document' &&
          (metadata.intent === 'app_blueprint' || metadata.appBlueprint) &&
          metadata.artifactType !== 'blueprint_db_design' &&
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
          (metadata.artifactType === 'blueprint_db_design' ||
            metadata.source === 'blueprint-db-design' ||
            metadata.dbDesignTarget)
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
    if (!fn) return;
    await runAction(action, fn);
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
    if (unansweredQuestions.length > 0) return;
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
        setActiveTab('status');
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
          sourceBlueprintMessageId: activeBlueprintSourceMessageId || null,
        }),
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
              disabled={(id === 'status' || id === 'specification') && !isDesignAssemblyReady}
              className={`rounded border px-2 py-1 text-xs ${
                activeTab === id
                  ? 'border-cyan-400/70 bg-cyan-950/40 text-cyan-100'
                  : (id === 'status' || id === 'specification') && !isDesignAssemblyReady
                    ? 'cursor-not-allowed border-slate-800 bg-slate-950/10 text-slate-600'
                    : 'border-slate-700 bg-slate-950/20 text-slate-300 hover:border-slate-500'
              }`}
              onClick={() => {
                if ((id === 'status' || id === 'specification') && !isDesignAssemblyReady) return;
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
                    label={
                      unansweredQuestions.length > 0
                        ? `未回答 ${unansweredQuestions.length}件`
                        : '回答を送信して次へ'
                    }
                    icon="send"
                    busy={busyAction === 'submit-answers'}
                    disabled={unansweredQuestions.length > 0}
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
                      {unansweredQuestions.map((question: any) => question.question).join(' / ')}
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
            onOpenQuestionnaire={() => setActiveTab('questionnaire')}
            onGenerateBlueprint={() => generateSpecificationArtifact('blueprint', 'blueprints')}
            onGenerateDbDesign={() => generateSpecificationArtifact('db-design', 'db-design')}
            onGenerateSpecification={() =>
              generateSpecificationArtifact('design-doc', 'specification')
            }
            onQueueSession={
              onQueueSession ? () => runSessionAction('queue-session', onQueueSession) : undefined
            }
            onStartImplementation={
              onStartImplementation
                ? () => runSessionAction('start-implementation', onStartImplementation)
                : undefined
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

function WorkspaceBlueprintPreview({
  sessionId,
  message,
  empty = 'No Blueprint artifact.',
}: {
  sessionId: string | null;
  message: TaskMessage | null;
  empty?: string;
}) {
  const blueprint = message?.metadataJson?.appBlueprint;
  if (!isRecord(blueprint)) {
    return <MarkdownViewer content={message?.content || empty} />;
  }
  const screens = toRecordArray(blueprint.screens);
  const validation = message?.metadataJson?.validation;
  const issues = isRecord(validation) ? toRecordArray(validation.issues) : [];
  return (
    <BlueprintPreview
      key={String(blueprint.id || blueprint.name || screens[0]?.id || message?.id || 'blueprint')}
      sessionId={sessionId}
      messageId={message?.id || null}
      blueprint={blueprint}
      screens={screens}
      validationIssues={issues}
    />
  );
}

function WorkspaceDbDesignPanel({
  sessionId,
  message,
  empty = 'No DB Design artifact.',
}: {
  sessionId: string | null;
  message: TaskMessage | null;
  empty?: string;
}) {
  const blueprint = message?.metadataJson?.appBlueprint;
  if (!isRecord(blueprint)) {
    return <MarkdownViewer content={message?.content || empty} />;
  }
  return (
    <WorkspaceDbDesignPanelContent sessionId={sessionId} blueprint={blueprint} message={message} />
  );
}

function WorkspaceDbDesignPanelContent({
  sessionId,
  blueprint,
  message,
}: {
  sessionId: string | null;
  blueprint: Record<string, any>;
  message: TaskMessage | null;
}) {
  const tables =
    isRecord(blueprint.databaseSchema) && Array.isArray(blueprint.databaseSchema.tables)
      ? toRecordArray(blueprint.databaseSchema.tables)
      : [];
  const validation = message?.metadataJson?.validation;
  const issues = isRecord(validation) ? toRecordArray(validation.issues) : [];
  const initialSettings = useMemo(
    () => createBlueprintPreviewDesignSettings(blueprint.designPreset),
    [blueprint.designPreset]
  );
  const [settings, setSettings] = useState<BlueprintPreviewDesignSettings>(initialSettings);

  useEffect(() => {
    setSettings(initialSettings);
    if (!sessionId) return;
    const controller = new AbortController();
    apiFetch(`/api/tasks/${sessionId}/blueprint-design-settings`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) return null;
        return (await res.json()) as { settings?: unknown };
      })
      .then((data) => {
        if (controller.signal.aborted || !data?.settings) return;
        setSettings(createBlueprintPreviewDesignSettings(data.settings));
      })
      .catch((error) => {
        if (error?.name !== 'AbortError') {
          console.warn('Failed to load DB Design display settings', error);
        }
      });
    return () => controller.abort();
  }, [initialSettings, sessionId]);

  return (
    <div
      className="blueprint-preview grid gap-[var(--blueprint-preview-gap)] rounded-xl border border-border p-[var(--blueprint-preview-section-padding)] text-ui"
      data-blueprint-preview
      data-theme={settings.theme}
      data-density={settings.density}
      data-shape={settings.shape}
      data-shadow={settings.shadow}
      data-shadow-direction={settings.shadowDirection}
      data-font={settings.font}
      data-contrast={settings.contrast}
      data-motion={settings.motion}
      data-button-variant={settings.componentVariants.button}
      data-card-variant={settings.componentVariants.card}
      data-table-variant={settings.componentVariants.table}
      data-input-variant={settings.componentVariants.input}
    >
      <BlueprintDbDesignPanel
        id="specification-workspace-db-design"
        blueprint={blueprint}
        tables={tables}
        validationIssues={issues}
        adoption={null}
      />
    </div>
  );
}

function SpecificationStatusView({
  workspace,
  questionnaireSession,
  busyAction,
  canGenerateDbDesign,
  hasSpecification,
  onOpenQuestionnaire,
  onGenerateBlueprint,
  onGenerateDbDesign,
  onGenerateSpecification,
  onQueueSession,
  onStartImplementation,
}: {
  workspace: BlueprintSpecificationWorkspace | null;
  questionnaireSession: DesignQuestionnaireSession | null;
  busyAction: string | null;
  canGenerateDbDesign: boolean;
  hasSpecification: boolean;
  onOpenQuestionnaire: () => void;
  onGenerateBlueprint: () => void;
  onGenerateDbDesign: () => void;
  onGenerateSpecification: () => void;
  onQueueSession?: () => void;
  onStartImplementation?: () => void;
}) {
  const answeredCount = questionnaireSession?.answers.length || 0;
  const questionCount = questionnaireSession ? getQuestionCount(questionnaireSession) : 0;
  const hasBlueprint = Boolean(workspace?.blueprintArtifacts.length);
  const hasDbDesign = Boolean(workspace?.dbDesignArtifacts.length);
  const questionnaireDone = Boolean(
    questionnaireSession &&
      (questionnaireSession.status === 'review_ready' || questionnaireSession.status === 'accepted')
  );
  const steps = [
    {
      number: 1,
      title: '仕様に関する質問を回答してください',
      detail:
        questionCount > 0
          ? `Questionnaire ${answeredCount}/${questionCount}`
          : '仕様判断に必要な質問を先に確認します。',
      done: questionnaireDone,
      buttonLabel: questionnaireDone ? 'アンケートを確認' : 'アンケートへ',
      busy: false,
      disabled: false,
      onClick: onOpenQuestionnaire,
    },
    {
      number: 2,
      title: 'インスタントMockUpを作成し、大筋UIの方向性を決めます',
      detail: hasBlueprint
        ? `${workspace?.blueprintArtifacts.length || 0}件のBlueprintがあります。`
        : '画面構成と主要UIセクションを生成します。',
      done: hasBlueprint,
      buttonLabel: hasBlueprint ? 'Blueprintを再生成' : 'Blueprint作成',
      busy: busyAction === 'blueprint',
      disabled: !questionnaireDone,
      onClick: onGenerateBlueprint,
    },
    {
      number: 3,
      title: 'どの様なデータモデルが必要になるかプレビュー出来ます',
      detail: hasDbDesign
        ? `${workspace?.dbDesignArtifacts.length || 0}件のDB Designがあります。`
        : 'DB Designでテーブル、カラム、リレーションを確認します。',
      done: hasDbDesign,
      buttonLabel: hasDbDesign ? 'DBデザインを再生成' : 'DBデザイン作成',
      busy: busyAction === 'db-design',
      disabled: !questionnaireDone || !canGenerateDbDesign,
      onClick: onGenerateDbDesign,
    },
    {
      number: 4,
      title: '設計書Markdownを作ります。これによってすぐに実装に移れます',
      detail: hasSpecification
        ? 'Specificationが作成済みです。'
        : '回答、Blueprint、DB Designを要約して仕様書を生成します。',
      done: hasSpecification,
      buttonLabel: hasSpecification ? '仕様書を再生成' : '仕様書作成',
      busy: busyAction === 'design-doc',
      disabled: !questionnaireDone,
      onClick: onGenerateSpecification,
    },
  ];
  const allStepsDone = steps.every((step) => step.done);
  return (
    <div className="grid gap-3 text-xs">
      <div>
        <h2 className="text-base font-semibold text-slate-100">Status</h2>
        <p className="mt-1 text-slate-400">
          上から順に確認し、必要なArtifactを作成して仕様書へ進みます。
        </p>
      </div>
      <div className="grid gap-3">
        {steps.map((step, index) => (
          <div
            key={step.number}
            className="grid gap-3 rounded border border-slate-800 bg-slate-950/20 p-3 md:grid-cols-[1fr_auto] md:items-center"
          >
            <div className="flex gap-3">
              <div className="flex flex-col items-center">
                <div
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold ${
                    step.done
                      ? 'border-emerald-400/70 bg-emerald-950/40 text-emerald-100'
                      : 'border-slate-700 bg-slate-900 text-slate-300'
                  }`}
                >
                  {step.done ? <Check className="h-3.5 w-3.5" /> : step.number}
                </div>
                {index < steps.length - 1 ? (
                  <div className="mt-2 min-h-8 w-px flex-1 bg-slate-800" />
                ) : null}
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-slate-100">
                  {step.number}. {step.title}
                </div>
                <div className="mt-1 text-slate-400">{step.detail}</div>
              </div>
            </div>
            <StatusActionButton
              label={step.buttonLabel}
              busy={step.busy}
              disabled={step.disabled}
              onClick={step.onClick}
            />
          </div>
        ))}
      </div>
      {allStepsDone ? (
        <div className="mt-4 flex flex-wrap justify-center gap-3">
          <StatusActionButton
            label="night queueに登録"
            busy={busyAction === 'queue-session'}
            disabled={!onQueueSession}
            onClick={() => onQueueSession?.()}
            size="lg"
          />
          <StatusActionButton
            label="今すぐ実装開始"
            busy={busyAction === 'start-implementation'}
            disabled={!onStartImplementation}
            onClick={() => onStartImplementation?.()}
            size="lg"
          />
        </div>
      ) : null}
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
  size = 'sm',
}: {
  label: string;
  busy: boolean;
  disabled?: boolean;
  onClick: () => void;
  size?: 'sm' | 'lg';
}) {
  return (
    <button
      type="button"
      className={`inline-flex items-center gap-1.5 rounded border border-cyan-500/60 bg-cyan-950/30 text-cyan-100 disabled:cursor-not-allowed disabled:opacity-45 ${
        size === 'lg' ? 'px-4 py-2 text-sm font-semibold' : 'px-2 py-1 text-xs'
      }`}
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
