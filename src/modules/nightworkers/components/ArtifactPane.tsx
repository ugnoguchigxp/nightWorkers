import { CodeBlock } from '@repo/design-system';
import { Check, ChevronRight, File, Folder, GitCompare, LoaderCircle, Save } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Components } from 'react-markdown';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { apiFetch } from '../../../lib/api-base';
import type {
  BlueprintSpecificationWorkspace,
  DesignQuestionnaireAnswer,
  DesignQuestionnaireSession,
  ProjectFileContent,
  ProjectFileEntry,
  Repository,
  TaskMessage,
  TaskRun,
  WorkbenchArtifactRef,
  WorkbenchChatIntent,
} from '../types';
import { getChangedFiles } from '../utils/diff';
import { BlueprintPreview } from './blueprint-preview';

type ArtifactPaneProps = {
  activeProject: Repository | null;
  activeSessionId: string | null;
  latestRun?: TaskRun;
  selectedArtifact: WorkbenchArtifactRef | null;
  taskMessages: TaskMessage[];
  fileEntries: ProjectFileEntry[];
  fileEntriesByDirectory: Record<string, ProjectFileEntry[]>;
  expandedDirectories: Record<string, boolean>;
  loadingDirectories: Record<string, boolean>;
  selectedFile: ProjectFileContent | null;
  selectedFilePath: string | null;
  isFilesLoading: boolean;
  isFileLoading: boolean;
  onToggleDirectory: (path: string) => Promise<void>;
  onOpenFile: (path: string) => void;
  onShowDiff: () => void;
  onSubmitWorkbenchMessage?: (prompt: string, intent: WorkbenchChatIntent) => Promise<void>;
  isWorkbenchMessageSubmitting?: boolean;
};

const artifactCodeBlockThemes = {
  light: 'github-dark-default',
  dark: 'github-dark-default',
} as const;
const markdownRemarkPlugins = [remarkGfm];
const markdownComponents: Components = {
  a: ({ children, ...props }) => (
    <a className="text-[#89b4fa] underline underline-offset-2" {...props}>
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="border-[#45475a] border-l-2 pl-4 text-[#bac2de]">{children}</blockquote>
  ),
  code: ({ children }) => (
    <code className="rounded bg-[#181825] px-1 py-0.5 font-mono text-[#f5c2e7] text-[0.92em]">
      {children}
    </code>
  ),
  h1: ({ children }) => (
    <h1 className="mt-0 mb-4 border-[#313244] border-b pb-2 text-2xl font-semibold text-[#f5e0dc]">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="mt-8 mb-3 border-[#313244] border-b pb-1 text-xl font-semibold text-[#f5e0dc]">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-6 mb-2 text-lg font-semibold text-[#f5e0dc]">{children}</h3>
  ),
  li: ({ children }) => <li className="my-1 pl-1">{children}</li>,
  ol: ({ children }) => <ol className="my-3 list-decimal space-y-1 pl-6">{children}</ol>,
  p: ({ children }) => <p className="my-3 leading-7">{children}</p>,
  pre: ({ children }) => (
    <pre className="my-4 overflow-x-hidden whitespace-pre-wrap break-words rounded bg-[#181825] p-3 font-mono text-sm text-[#cdd6f4]">
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div className="my-4 overflow-x-hidden">
      <table className="w-full table-fixed border-collapse text-sm">{children}</table>
    </div>
  ),
  td: ({ children }) => (
    <td className="break-words border border-[#313244] px-2 py-1 align-top">{children}</td>
  ),
  th: ({ children }) => (
    <th className="break-words border border-[#313244] bg-[#181825] px-2 py-1 text-left font-medium">
      {children}
    </th>
  ),
  ul: ({ children }) => <ul className="my-3 list-disc space-y-1 pl-6">{children}</ul>,
};

export function ArtifactPane({
  activeProject,
  activeSessionId,
  latestRun,
  selectedArtifact,
  taskMessages,
  fileEntries,
  fileEntriesByDirectory,
  expandedDirectories,
  loadingDirectories,
  selectedFile,
  selectedFilePath,
  isFilesLoading,
  isFileLoading,
  onToggleDirectory,
  onOpenFile,
  onShowDiff,
  onSubmitWorkbenchMessage,
  isWorkbenchMessageSubmitting = false,
}: ArtifactPaneProps) {
  const { t } = useTranslation();
  const showDiff = selectedArtifact?.kind === 'diff';
  const showBlueprintWorkspace = selectedArtifact?.kind === 'blueprint_workspace';
  const showBlueprint = selectedArtifact?.kind === 'app_blueprint';
  const showComponentDesign =
    selectedArtifact?.kind === 'component_design' || selectedArtifact?.kind === 'design_delta';
  const taskMessageId =
    selectedArtifact?.source.type === 'task_message' ? selectedArtifact.source.messageId : null;
  const selectedMessage = taskMessageId
    ? taskMessages.find((message) => message.id === taskMessageId)
    : null;
  const showDocument =
    Boolean(selectedArtifact) &&
    !showDiff &&
    !showBlueprintWorkspace &&
    !showBlueprint &&
    !showComponentDesign &&
    Boolean(selectedMessage);
  const artifactTitle = selectedArtifact?.title || selectedFilePath || t('artifact.projectTree');
  return (
    <aside className="nightworkers-artifact-pane flex min-h-0 min-w-0 flex-col overflow-hidden">
      <div className="flex h-10 shrink-0 items-center border-b border-[#313244] bg-[#1e1e2e] px-3 pr-12">
        <div className="flex min-w-0 items-center gap-2 text-sm">
          <span className="truncate text-[#a6adc8]">
            {activeProject?.name || t('artifact.project')}
          </span>
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[#6c7086]" />
          <span className="truncate font-medium text-[#cdd6f4]">{artifactTitle}</span>
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        {!selectedArtifact ? (
          <div className="min-h-0 w-56 shrink-0 overflow-auto border-r border-slate-800 p-2">
            <FilesOutline
              latestRun={latestRun}
              isFilesLoading={isFilesLoading}
              fileEntries={fileEntries}
              fileEntriesByDirectory={fileEntriesByDirectory}
              expandedDirectories={expandedDirectories}
              loadingDirectories={loadingDirectories}
              selectedFilePath={selectedFilePath}
              onToggleDirectory={onToggleDirectory}
              onOpenFile={onOpenFile}
              onShowDiff={onShowDiff}
            />
          </div>
        ) : null}
        <div className="min-w-0 flex-1 overflow-hidden bg-[#1e1e2e]">
          {showDiff ? (
            <DiffViewer diff={latestRun?.diffPatch || ''} />
          ) : showBlueprintWorkspace ? (
            <BlueprintSpecificationWorkspaceViewer
              sessionId={activeSessionId}
              taskMessages={taskMessages}
            />
          ) : showBlueprint ? (
            <BlueprintViewer
              sessionId={activeSessionId}
              messageId={taskMessageId}
              blueprint={selectedArtifact?.metadata?.appBlueprint}
              validation={selectedArtifact?.metadata?.validation}
              markdown={selectedMessage?.content}
              isDbDesignSubmitting={isWorkbenchMessageSubmitting}
              onSubmitDbDesignRequest={
                onSubmitWorkbenchMessage
                  ? (prompt) => onSubmitWorkbenchMessage(prompt, 'design_blueprint_data')
                  : undefined
              }
            />
          ) : showComponentDesign ? (
            <ComponentDesignViewer
              artifact={
                selectedArtifact?.metadata?.componentDesign ||
                selectedArtifact?.metadata?.designDelta
              }
              markdown={selectedMessage?.content}
            />
          ) : showDocument ? (
            <MarkdownViewer content={selectedMessage?.content || ''} />
          ) : selectedFile ? (
            <FileViewer file={selectedFile} />
          ) : isFileLoading ? (
            <p className="text-xs text-slate-400">{t('artifact.loadingFile')}</p>
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-slate-500">
              {t('artifact.selectFileOrDiff')}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}

function FilesOutline({
  latestRun,
  isFilesLoading,
  fileEntries,
  fileEntriesByDirectory,
  expandedDirectories,
  loadingDirectories,
  selectedFilePath,
  onToggleDirectory,
  onOpenFile,
  onShowDiff,
}: {
  latestRun?: TaskRun;
  isFilesLoading: boolean;
  fileEntries: ProjectFileEntry[];
  fileEntriesByDirectory: Record<string, ProjectFileEntry[]>;
  expandedDirectories: Record<string, boolean>;
  loadingDirectories: Record<string, boolean>;
  selectedFilePath: string | null;
  onToggleDirectory: (path: string) => Promise<void>;
  onOpenFile: (path: string) => void;
  onShowDiff: () => void;
}) {
  const { t } = useTranslation();

  return (
    <>
      {latestRun?.diffPatch?.trim() ? (
        <button
          type="button"
          className="mb-2 flex w-full items-center gap-2 rounded border border-slate-700/70 px-2 py-1 text-left text-[11px] text-slate-200 hover:border-slate-500"
          onClick={onShowDiff}
        >
          <GitCompare className="h-3.5 w-3.5" />
          {t('artifact.diff')}
        </button>
      ) : null}
      {isFilesLoading ? (
        <div className="px-2 py-1 text-[11px] text-slate-500">{t('artifact.loading')}</div>
      ) : (
        <ProjectTree
          entries={fileEntries}
          entriesByDirectory={fileEntriesByDirectory}
          expandedDirectories={expandedDirectories}
          loadingDirectories={loadingDirectories}
          selectedFilePath={selectedFilePath}
          onToggleDirectory={onToggleDirectory}
          onOpenFile={onOpenFile}
        />
      )}
    </>
  );
}

function BlueprintSpecificationWorkspaceViewer({
  sessionId,
  taskMessages,
}: {
  sessionId: string | null;
  taskMessages: TaskMessage[];
}) {
  const [workspace, setWorkspace] = useState<BlueprintSpecificationWorkspace | null>(null);
  const [sessions, setSessions] = useState<DesignQuestionnaireSession[]>([]);
  const [activeTab, setActiveTab] = useState<
    'blueprints' | 'db-design' | 'questionnaire' | 'decisions' | 'implementation'
  >('blueprints');
  const [activeBlueprintId, setActiveBlueprintId] = useState<string | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, DesignQuestionnaireAnswer>>({});
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const blueprintMessages = useMemo(
    () =>
      taskMessages.filter(
        (message) =>
          message.messageType === 'markdown_document' &&
          (message.metadataJson?.intent === 'app_blueprint' || message.metadataJson?.appBlueprint)
      ),
    [taskMessages]
  );
  const activeBlueprintMessage =
    blueprintMessages.find((message) => message.id === activeBlueprintId) ||
    blueprintMessages.at(-1) ||
    null;

  const refresh = useCallback(async () => {
    if (!sessionId) return;
    const workspaceRes = await apiFetch(`/api/tasks/${sessionId}/specification-workspace`);
    if (workspaceRes.ok)
      setWorkspace((await workspaceRes.json()) as BlueprintSpecificationWorkspace);
    const sessionsRes = await apiFetch(`/api/tasks/${sessionId}/design-questionnaire`);
    if (sessionsRes.ok) {
      const nextSessions = (await sessionsRes.json()) as DesignQuestionnaireSession[];
      setSessions(nextSessions);
      const selected = nextSessions.find((item) => item.id === activeSessionId) || nextSessions[0];
      if (selected) {
        setActiveSessionId(selected.id);
        setAnswers(
          Object.fromEntries(selected.answers.map((item) => [item.questionId, item.answer]))
        );
      }
    }
  }, [activeSessionId, sessionId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!activeBlueprintId && activeBlueprintMessage)
      setActiveBlueprintId(activeBlueprintMessage.id);
  }, [activeBlueprintId, activeBlueprintMessage]);

  const activeQuestionnaireSession =
    sessions.find((session) => session.id === activeSessionId) || sessions[0] || null;
  const questionGroups =
    activeQuestionnaireSession?.questionSets.flatMap(
      (set) => set.questionnaire?.questionSets || []
    ) || [];
  const review = activeQuestionnaireSession?.reviews.find((item) => item.review)?.review || null;

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

  async function saveAnswers() {
    if (!sessionId || !activeQuestionnaireSession) return;
    await runAction('save', async () => {
      const res = await apiFetch(
        `/api/tasks/${sessionId}/design-questionnaire/${activeQuestionnaireSession.id}/answers`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ answers: Object.values(answers) }),
        }
      );
      if (!res.ok) throw new Error(await res.text());
    });
  }

  async function generateFollowUp() {
    if (!sessionId || !activeQuestionnaireSession) return;
    await runAction('follow-up', async () => {
      const res = await apiFetch(
        `/api/tasks/${sessionId}/design-questionnaire/${activeQuestionnaireSession.id}/follow-up`,
        { method: 'POST' }
      );
      if (!res.ok) throw new Error(await res.text());
    });
  }

  async function generateReview() {
    if (!sessionId || !activeQuestionnaireSession) return;
    await runAction('review', async () => {
      const res = await apiFetch(
        `/api/tasks/${sessionId}/design-questionnaire/${activeQuestionnaireSession.id}/review`,
        { method: 'POST' }
      );
      if (!res.ok) throw new Error(await res.text());
      setActiveTab('decisions');
    });
  }

  async function acceptReview() {
    if (!sessionId || !activeQuestionnaireSession) return;
    await runAction('accept', async () => {
      const res = await apiFetch(
        `/api/tasks/${sessionId}/design-questionnaire/${activeQuestionnaireSession.id}/review/accept`,
        { method: 'POST' }
      );
      if (!res.ok) throw new Error(await res.text());
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
            ['decisions', 'Decisions'],
            ['implementation', 'Implementation'],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`rounded border px-2 py-1 text-xs ${
                activeTab === id
                  ? 'border-cyan-400/70 bg-cyan-950/40 text-cyan-100'
                  : 'border-slate-700 bg-slate-950/20 text-slate-300 hover:border-slate-500'
              }`}
              onClick={() => setActiveTab(id as typeof activeTab)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="nightworkers-scrollbar min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {activeTab === 'blueprints' ? (
          <div className="grid gap-4">
            <ArtifactList
              items={blueprintMessages.map((message) => ({
                id: message.id,
                title: String(
                  message.metadataJson?.title ||
                    message.metadataJson?.appBlueprint?.name ||
                    'Blueprint'
                ),
                detail: `message ${message.id.slice(0, 8)}`,
              }))}
              activeId={activeBlueprintMessage?.id || null}
              onSelect={setActiveBlueprintId}
            />
            <MarkdownViewer content={activeBlueprintMessage?.content || 'No Blueprint artifact.'} />
          </div>
        ) : activeTab === 'db-design' ? (
          <WorkspaceList
            items={workspace?.dbDesignArtifacts || []}
            empty="No DB Design revisions."
          />
        ) : activeTab === 'questionnaire' ? (
          <div className="grid gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded border border-cyan-500/60 bg-cyan-950/30 px-2 py-1 text-xs text-cyan-100 disabled:cursor-wait disabled:opacity-60"
                onClick={startQuestionnaire}
                disabled={!activeBlueprintMessage || Boolean(busyAction)}
              >
                {busyAction === 'start' ? <LoaderCircle className="h-3 w-3 animate-spin" /> : null}
                Start
              </button>
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
                <div className="flex flex-wrap gap-2">
                  <ActionButton
                    label="Save"
                    icon="save"
                    busy={busyAction === 'save'}
                    onClick={saveAnswers}
                  />
                  <ActionButton
                    label="Follow-up"
                    busy={busyAction === 'follow-up'}
                    onClick={generateFollowUp}
                  />
                  <ActionButton
                    label="Review"
                    busy={busyAction === 'review'}
                    onClick={generateReview}
                  />
                </div>
              </>
            ) : (
              <p className="text-xs text-slate-500">No questionnaire session.</p>
            )}
          </div>
        ) : activeTab === 'decisions' ? (
          <DecisionReviewView
            review={review}
            onAccept={acceptReview}
            busy={busyAction === 'accept'}
          />
        ) : (
          <WorkspaceList
            items={workspace?.implementationReferences || []}
            empty="No implementation references."
          />
        )}
      </div>
    </div>
  );
}

function ArtifactList({
  items,
  activeId,
  onSelect,
}: {
  items: Array<{ id: string; title: string; detail: string }>;
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className={`rounded border px-2 py-1 text-left text-xs ${
            activeId === item.id
              ? 'border-cyan-400/70 bg-cyan-950/40 text-cyan-100'
              : 'border-slate-700 bg-slate-950/20 text-slate-300'
          }`}
          onClick={() => onSelect(item.id)}
        >
          <span className="block max-w-56 truncate">{item.title}</span>
          <span className="block text-[10px] text-slate-500">{item.detail}</span>
        </button>
      ))}
    </div>
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

function QuestionnaireForm({
  questionGroups,
  answers,
  onChange,
}: {
  questionGroups: any[];
  answers: Record<string, DesignQuestionnaireAnswer>;
  onChange: (answers: Record<string, DesignQuestionnaireAnswer>) => void;
}) {
  if (questionGroups.length === 0)
    return <p className="text-xs text-slate-500">No valid question set.</p>;
  const updateAnswer = (questionId: string, patch: Partial<DesignQuestionnaireAnswer>) => {
    const current = answers[questionId] || emptyAnswer(questionId);
    onChange({ ...answers, [questionId]: { ...current, ...patch } });
  };
  return (
    <div className="grid gap-4">
      {questionGroups.map((group) => {
        const questions = (Array.isArray(group.questions) ? group.questions : []).filter(
          (question: any) => isQuestionDependencySatisfied(question, answers)
        );
        const unanswered = questions.filter(
          (question: any) => !isAnswered(answers[question.id])
        ).length;
        return (
          <section key={String(group.id)} className="grid gap-2">
            <div className="flex items-center justify-between gap-3 border-slate-800 border-b pb-1">
              <div>
                <h2 className="text-sm font-semibold text-slate-100">{String(group.title)}</h2>
                <p className="text-[11px] text-slate-500">
                  {String(group.purpose || group.category || '')}
                </p>
              </div>
              <span className="rounded border border-slate-700 px-2 py-0.5 text-[10px] text-slate-300">
                {unanswered} unanswered
              </span>
            </div>
            {questions.map((question: any) => (
              <QuestionCard
                key={String(question.id)}
                question={question}
                answer={answers[question.id] || emptyAnswer(question.id)}
                onChange={(patch) => updateAnswer(question.id, patch)}
              />
            ))}
          </section>
        );
      })}
    </div>
  );
}

function QuestionCard({
  question,
  answer,
  onChange,
}: {
  question: any;
  answer: DesignQuestionnaireAnswer;
  onChange: (patch: Partial<DesignQuestionnaireAnswer>) => void;
}) {
  const options = Array.isArray(question.options) ? question.options : [];
  return (
    <div className="rounded border border-slate-800 bg-slate-950/20 p-3 text-xs">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase text-cyan-200">
            {String(question.topic || question.outputSection)}
          </div>
          <h3 className="mt-1 text-sm font-medium text-slate-100">{String(question.question)}</h3>
        </div>
        <label className="flex items-center gap-1 text-[11px] text-slate-400">
          <input
            type="checkbox"
            checked={answer.deferred}
            onChange={(event) => onChange({ deferred: event.target.checked })}
          />
          Later
        </label>
      </div>
      <p className="mt-2 text-slate-400">{String(question.why || '')}</p>
      {options.length > 0 ? (
        <div className="mt-3 grid gap-2">
          {options.map((option: any) => {
            const selected = answer.selectedOptionIds.includes(option.id);
            return (
              <button
                key={String(option.id)}
                type="button"
                className={`rounded border p-2 text-left ${
                  selected
                    ? 'border-cyan-400/70 bg-cyan-950/30 text-cyan-50'
                    : 'border-slate-800 bg-slate-950/20 text-slate-300 hover:border-slate-600'
                }`}
                onClick={() => {
                  if (question.answerType === 'multi_choice') {
                    onChange({
                      selectedOptionIds: selected
                        ? answer.selectedOptionIds.filter((id) => id !== option.id)
                        : [...answer.selectedOptionIds, option.id],
                    });
                    return;
                  }
                  onChange({ selectedOptionIds: [option.id] });
                }}
              >
                <span className="flex items-center gap-2">
                  <span className="font-medium">{String(option.label)}</span>
                  {option.recommended || question.recommendedAnswerId === option.id ? (
                    <span className="rounded bg-emerald-950/50 px-1.5 py-0.5 text-[10px] text-emerald-200">
                      Recommended
                    </span>
                  ) : null}
                </span>
                <span className="mt-1 block text-[11px] text-slate-500">
                  {String(option.tradeoff || '')}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
      {question.answerType === 'boolean' ? (
        <div className="mt-3 flex gap-2">
          {[true, false].map((value) => (
            <button
              key={String(value)}
              type="button"
              className={`rounded border px-3 py-1 ${
                answer.booleanValue === value
                  ? 'border-cyan-400/70 bg-cyan-950/30 text-cyan-100'
                  : 'border-slate-800 text-slate-300'
              }`}
              onClick={() => onChange({ booleanValue: value })}
            >
              {value ? 'Yes' : 'No'}
            </button>
          ))}
        </div>
      ) : null}
      {question.allowsCustomAnswer || question.answerType === 'free_text' ? (
        <textarea
          className="mt-3 min-h-20 w-full resize-y rounded border border-slate-800 bg-slate-950/40 p-2 text-xs text-slate-100 outline-none focus:border-cyan-500/70"
          value={answer.freeText || ''}
          onChange={(event) => onChange({ freeText: event.target.value })}
          placeholder="Supplement"
        />
      ) : null}
      <div className="mt-2 text-[11px] text-slate-500">
        Blocks: {Array.isArray(question.blocks) ? question.blocks.join(', ') : ''}
      </div>
    </div>
  );
}

function DecisionReviewView({
  review,
  onAccept,
  busy,
}: {
  review: any | null;
  onAccept: () => void;
  busy: boolean;
}) {
  if (!review) return <p className="text-xs text-slate-500">No Decision Review draft.</p>;
  return (
    <div className="grid gap-4 text-xs">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-100">{String(review.title)}</h2>
          <p className="mt-1 text-slate-400">{String(review.summary || '')}</p>
        </div>
        <ActionButton label="Accept" icon="check" busy={busy} onClick={onAccept} />
      </div>
      <ReviewSection
        title="Decisions"
        items={review.decisions}
        render={(item) => `${item.outputSection}: ${item.decision}`}
      />
      <ReviewSection
        title="Deferred"
        items={review.deferredItems}
        render={(item) => `${item.topic}: ${item.reason}`}
      />
      <ReviewSection
        title="Unresolved"
        items={review.unresolvedQuestions}
        render={(item) => `${item.topic}: ${item.reason}`}
      />
      <ReviewSection
        title="DB Design Handoff"
        items={review.dbDesignHandoffNotes}
        render={(item) => `${item.summary}: ${item.constraint}`}
      />
    </div>
  );
}

function ReviewSection({
  title,
  items,
  render,
}: {
  title: string;
  items: any[];
  render: (item: any) => string;
}) {
  return (
    <section>
      <h3 className="mb-2 text-[11px] font-semibold uppercase text-slate-400">{title}</h3>
      <div className="grid gap-2">
        {Array.isArray(items) && items.length > 0 ? (
          items.map((item, index) => (
            <div
              key={`${title}-${index}`}
              className="rounded border border-slate-800 bg-slate-950/20 p-2 text-slate-300"
            >
              {render(item)}
            </div>
          ))
        ) : (
          <div className="rounded border border-slate-800 bg-slate-950/20 p-2 text-slate-500">
            None
          </div>
        )}
      </div>
    </section>
  );
}

function ActionButton({
  label,
  icon,
  busy,
  onClick,
}: {
  label: string;
  icon?: 'save' | 'check';
  busy?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1.5 rounded border border-slate-700 bg-slate-950/20 px-2 py-1 text-xs text-slate-200 hover:border-slate-500 disabled:cursor-wait disabled:opacity-60"
      onClick={onClick}
      disabled={busy}
    >
      {busy ? (
        <LoaderCircle className="h-3 w-3 animate-spin" />
      ) : icon === 'save' ? (
        <Save className="h-3 w-3" />
      ) : icon === 'check' ? (
        <Check className="h-3 w-3" />
      ) : null}
      {label}
    </button>
  );
}

function emptyAnswer(questionId: string): DesignQuestionnaireAnswer {
  return {
    questionId,
    selectedOptionIds: [],
    rankedOptionIds: [],
    deferred: false,
  };
}

function isAnswered(answer?: DesignQuestionnaireAnswer) {
  return Boolean(
    answer?.deferred ||
      answer?.selectedOptionIds.length ||
      answer?.rankedOptionIds.length ||
      answer?.booleanValue !== undefined ||
      answer?.freeText?.trim()
  );
}

function getQuestionCount(session: DesignQuestionnaireSession) {
  const answers = Object.fromEntries(session.answers.map((item) => [item.questionId, item.answer]));
  return session.questionSets.reduce((total, set) => {
    const groups = set.questionnaire?.questionSets;
    if (!Array.isArray(groups)) return total;
    return (
      total +
      groups.reduce(
        (sum: number, group: any) =>
          sum +
          (Array.isArray(group.questions)
            ? group.questions.filter((question: any) =>
                isQuestionDependencySatisfied(question, answers)
              ).length
            : 0),
        0
      )
    );
  }, 0);
}

function isQuestionDependencySatisfied(
  question: any,
  answers: Record<string, DesignQuestionnaireAnswer>
) {
  const dependencies = Array.isArray(question.dependsOn) ? question.dependsOn : [];
  return dependencies.every((dependency: any) => {
    const answer = answers[String(dependency.questionId)];
    if (!answer) return false;
    return evaluateQuestionDependency(answer, dependency);
  });
}

function evaluateQuestionDependency(answer: DesignQuestionnaireAnswer, dependency: any) {
  const expected = dependency.value;
  const values = [
    ...answer.selectedOptionIds,
    ...answer.rankedOptionIds,
    ...(answer.freeText?.trim() ? [answer.freeText.trim()] : []),
  ];
  const hasExpectedString = Array.isArray(expected)
    ? expected.some((value) => values.includes(String(value)))
    : values.includes(String(expected));
  if (typeof expected === 'boolean') {
    if (dependency.operator === 'equals') return answer.booleanValue === expected;
    if (dependency.operator === 'not_equals') return answer.booleanValue !== expected;
    return false;
  }
  if (dependency.operator === 'equals' || dependency.operator === 'includes') {
    return hasExpectedString;
  }
  if (dependency.operator === 'not_equals' || dependency.operator === 'excludes') {
    return !hasExpectedString;
  }
  return false;
}

function BlueprintViewer({
  sessionId,
  messageId,
  blueprint,
  validation,
  markdown,
  isDbDesignSubmitting,
  onSubmitDbDesignRequest,
}: {
  sessionId: string | null;
  messageId: string | null;
  blueprint: unknown;
  validation: unknown;
  markdown?: string;
  isDbDesignSubmitting?: boolean;
  onSubmitDbDesignRequest?: (prompt: string) => Promise<void>;
}) {
  const { t } = useTranslation();

  if (!isObject(blueprint)) {
    return <MarkdownViewer content={markdown || t('artifact.noBlueprintContent')} />;
  }
  const screens = toObjectArray(blueprint.screens);
  const tables =
    isObject(blueprint.databaseSchema) && Array.isArray(blueprint.databaseSchema.tables)
      ? toObjectArray(blueprint.databaseSchema.tables)
      : [];
  const bindings = toObjectArray(blueprint.dataBindings);
  const issues = isObject(validation) ? toObjectArray(validation.issues) : [];
  return (
    <div className="h-full overflow-y-auto px-6 py-5 text-sm text-slate-100">
      <div className="grid gap-4">
        <BlueprintSection title={t('artifact.designPreview')}>
          <BlueprintPreview
            key={String(blueprint.id || blueprint.name || screens[0]?.id || 'draft-blueprint')}
            sessionId={sessionId}
            messageId={messageId}
            blueprint={blueprint}
            screens={screens}
            tables={tables}
            bindings={bindings}
            validationIssues={issues}
            isDbDesignSubmitting={isDbDesignSubmitting}
            onSubmitDbDesignRequest={onSubmitDbDesignRequest}
          />
        </BlueprintSection>
        <PromptDetail>
          <BlueprintSection title={t('artifact.screenComposition')}>
            {screens.map((screen, index) => (
              <div
                key={String(screen?.id || index)}
                className="rounded border border-slate-700/80 p-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium text-slate-100">
                    {String(screen?.name || screen?.id)}
                  </span>
                  <span className="text-[11px] text-slate-500">
                    {String(screen?.componentName || '')}
                  </span>
                </div>
                <div className="mt-2 grid gap-1">
                  {toObjectArray(screen.sections).map((section, sectionIndex) => (
                    <div
                      key={String(section?.id || sectionIndex)}
                      className="flex items-center justify-between gap-3 text-xs"
                    >
                      <span className="min-w-0 truncate text-slate-300">
                        {String(section?.name || section?.id)}
                      </span>
                      <span className="shrink-0 text-slate-500">
                        {String(section?.componentName || '')}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </BlueprintSection>
          <BlueprintSection title={t('artifact.validationIssues')}>
            {issues.length > 0 ? (
              issues.map((issue, index) => (
                <div
                  key={`${String(issue?.path)}-${index}`}
                  className="rounded border border-amber-700/70 bg-amber-950/20 p-2 text-xs"
                >
                  <div className="font-mono text-amber-100">{String(issue?.path || '$')}</div>
                  <div className="mt-1 text-amber-50">
                    {String(issue?.message || issue?.code || '')}
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded border border-emerald-700/60 bg-emerald-950/20 p-2 text-xs text-emerald-100">
                {t('artifact.noValidationIssues')}
              </div>
            )}
          </BlueprintSection>
        </PromptDetail>
      </div>
    </div>
  );
}

function ComponentDesignViewer({ artifact, markdown }: { artifact: unknown; markdown?: string }) {
  const { t } = useTranslation();

  if (!isObject(artifact))
    return <MarkdownViewer content={markdown || t('artifact.noComponentDesign')} />;
  const variants = toObjectArray(artifact.variants);
  const tokenChanges = toObjectArray(artifact.tokenChanges);
  const discussionPrompts = Array.isArray(artifact.discussionPrompts)
    ? artifact.discussionPrompts.map(String)
    : [];
  return (
    <div className="h-full overflow-y-auto px-6 py-5 text-sm text-slate-100">
      <div className="mb-5 border-slate-700 border-b pb-4">
        <div className="text-xs font-semibold uppercase text-cyan-200">
          {t('artifact.componentDesign')}
        </div>
        <h1 className="mt-1 text-xl font-semibold text-slate-50">
          {String(artifact.componentName || t('artifact.componentFallback'))}
        </h1>
        <div className="mt-1 text-xs text-slate-400">{String(artifact.scope || '')}</div>
        <p className="mt-3 line-clamp-3 text-xs leading-5 text-slate-300">
          {String(artifact.summary || t('artifact.noSummary'))}
        </p>
      </div>
      <div className="grid gap-4">
        <BlueprintSection title={t('artifact.variantPreview')}>
          <div className="grid gap-3 sm:grid-cols-2">
            {variants.map((variant, index) => (
              <div
                key={String(variant.name || index)}
                className="rounded border border-slate-700/80 bg-slate-950/20 p-3"
              >
                <div className="mb-3 flex items-center justify-between gap-3">
                  <span className="text-xs font-medium text-slate-100">
                    {String(variant.name || 'variant')}
                  </span>
                  <span className="text-[10px] uppercase text-slate-500">
                    {t('artifact.button')}
                  </span>
                </div>
                <button
                  type="button"
                  className={componentButtonClass(String(variant.name || 'primary'))}
                >
                  {buttonLabelForVariant(String(variant.name || 'primary'), t)}
                </button>
                <p className="mt-3 text-[11px] leading-4 text-slate-400">
                  {String(variant.purpose || '')}
                </p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {(Array.isArray(variant.states) ? variant.states : []).map((state) => (
                    <span
                      key={String(state)}
                      className="rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-300"
                    >
                      {String(state)}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </BlueprintSection>
        <BlueprintSection title={t('artifact.tokenChanges')}>
          {tokenChanges.map((change, index) => (
            <div
              key={String(change.token || index)}
              className="rounded border border-slate-700/80 p-3 text-xs"
            >
              <div className="font-medium text-slate-100">{String(change.token || '')}</div>
              <div className="mt-2 grid gap-2 md:grid-cols-2">
                <TokenValue label={t('artifact.before')} value={String(change.before || '')} />
                <TokenValue label={t('artifact.proposed')} value={String(change.proposed || '')} />
              </div>
              <p className="mt-2 leading-5 text-slate-400">{String(change.rationale || '')}</p>
            </div>
          ))}
        </BlueprintSection>
        <BlueprintSection title={t('artifact.discussion')}>
          {discussionPrompts.map((prompt, index) => (
            <div
              key={`${prompt}-${index}`}
              className="rounded border border-slate-700/80 p-2 text-xs text-slate-300"
            >
              {prompt}
            </div>
          ))}
        </BlueprintSection>
      </div>
    </div>
  );
}

function TokenValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-slate-800 bg-slate-950/25 p-2">
      <div className="text-[10px] uppercase text-slate-500">{label}</div>
      <div className="mt-1 text-slate-200">{value}</div>
    </div>
  );
}

function componentButtonClass(variant: string): string {
  const base =
    'inline-flex h-9 min-w-24 items-center justify-center rounded border px-3 text-xs font-medium';
  if (variant === 'danger') return `${base} border-rose-500/70 bg-rose-600 text-white`;
  if (variant === 'secondary') return `${base} border-slate-600 bg-slate-800 text-slate-100`;
  if (variant === 'icon-only')
    return `${base} w-9 min-w-9 border-slate-600 bg-slate-900 text-cyan-100`;
  return `${base} border-cyan-400/70 bg-cyan-500 text-slate-950`;
}

function buttonLabelForVariant(variant: string, t: (key: string) => string): string {
  if (variant === 'danger') return t('artifact.action.delete');
  if (variant === 'secondary') return t('artifact.action.cancel');
  if (variant === 'icon-only') return '+';
  return t('artifact.action.save');
}

function BlueprintSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-xs font-semibold uppercase text-slate-400">{title}</h2>
      <div className="grid gap-2">{children}</div>
    </section>
  );
}

function PromptDetail({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();

  return (
    <details className="rounded border border-slate-800 bg-slate-950/20">
      <summary className="cursor-pointer select-none px-3 py-2 text-xs font-semibold uppercase text-slate-400 hover:text-slate-200">
        {t('artifact.promptDetail')}
      </summary>
      <div className="grid gap-4 border-slate-800 border-t p-3">{children}</div>
    </details>
  );
}

function isObject(value: unknown): value is Record<string, any> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function toObjectArray(value: unknown): Array<Record<string, any>> {
  return Array.isArray(value) ? value.filter(isObject) : [];
}

const FileViewer = memo(function FileViewer({ file }: { file: ProjectFileContent }) {
  const { t } = useTranslation();
  const isMarkdown = /\.(md|mdx|markdown)$/i.test(file.path);
  return (
    <div className="flex h-full min-h-0 flex-col">
      {file.truncated ? (
        <div className="shrink-0 border-b border-[#313244] bg-[#1e1e2e] px-3 py-2 text-xs text-amber-300">
          {t('artifact.truncated')}
        </div>
      ) : null}
      {isMarkdown ? (
        <MarkdownViewer content={file.content || ''} />
      ) : (
        <CodeBlock
          className="dark nightworkers-artifact-code min-h-0 flex-1 [&_.line]:whitespace-pre-wrap [&_code]:break-words [&_code]:whitespace-pre-wrap [&_pre]:overflow-x-hidden"
          data={[
            {
              code: file.content || t('artifact.noContent'),
              filename: file.path,
              language: inferLanguage(file.path),
            },
          ]}
          maxHeight="none"
          showHeader={false}
          themes={artifactCodeBlockThemes}
        />
      )}
    </div>
  );
});

const MarkdownViewer = memo(function MarkdownViewer({ content }: { content: string }) {
  const { t } = useTranslation();

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden bg-[#1e1e2e] px-8 py-6 text-[#cdd6f4]">
      <ReactMarkdown remarkPlugins={markdownRemarkPlugins} components={markdownComponents}>
        {content || t('artifact.noContent')}
      </ReactMarkdown>
    </div>
  );
});

function DiffViewer({ diff }: { diff: string }) {
  const { t } = useTranslation();
  const files = getChangedFiles(diff);
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <div className="text-xs font-medium text-slate-100">{t('artifact.changedFiles')}</div>
        {files.length > 0 ? (
          <ul className="grid gap-1">
            {files.map((file) => (
              <li
                key={file.path}
                className="flex items-center justify-between gap-3 rounded border border-slate-800 bg-slate-900/35 px-2 py-1 text-xs"
              >
                <span className="min-w-0 truncate text-slate-200">{file.path}</span>
                <span className="shrink-0 text-slate-400">
                  <span className="text-emerald-300">+{file.added}</span>{' '}
                  <span className="text-rose-300">-{file.deleted}</span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-slate-500">{t('artifact.noChangedFiles')}</p>
        )}
      </div>
      <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap rounded border border-slate-800 bg-slate-950/60 p-3 font-mono text-xs leading-5 text-slate-200">
        {diff || t('artifact.noDiff')}
      </pre>
    </div>
  );
}

function ProjectTree({
  entries,
  entriesByDirectory,
  expandedDirectories,
  loadingDirectories,
  selectedFilePath,
  onToggleDirectory,
  onOpenFile,
}: {
  entries: ProjectFileEntry[];
  entriesByDirectory: Record<string, ProjectFileEntry[]>;
  expandedDirectories: Record<string, boolean>;
  loadingDirectories: Record<string, boolean>;
  selectedFilePath: string | null;
  onToggleDirectory: (path: string) => Promise<void>;
  onOpenFile: (path: string) => void;
}) {
  return (
    <ul className="space-y-0.5">
      {entries.map((entry) => (
        <ProjectTreeNode
          key={`${entry.type}-${entry.path}`}
          entry={entry}
          entriesByDirectory={entriesByDirectory}
          expandedDirectories={expandedDirectories}
          loadingDirectories={loadingDirectories}
          selectedFilePath={selectedFilePath}
          onToggleDirectory={onToggleDirectory}
          onOpenFile={onOpenFile}
        />
      ))}
    </ul>
  );
}

function ProjectTreeNode({
  entry,
  entriesByDirectory,
  expandedDirectories,
  loadingDirectories,
  selectedFilePath,
  onToggleDirectory,
  onOpenFile,
  depth = 0,
}: {
  entry: ProjectFileEntry;
  entriesByDirectory: Record<string, ProjectFileEntry[]>;
  expandedDirectories: Record<string, boolean>;
  loadingDirectories: Record<string, boolean>;
  selectedFilePath: string | null;
  onToggleDirectory: (path: string) => Promise<void>;
  onOpenFile: (path: string) => void;
  depth?: number;
}) {
  const { t } = useTranslation();
  const isDirectory = entry.type === 'directory';
  const isExpanded = Boolean(expandedDirectories[entry.path]);
  const isLoading = Boolean(loadingDirectories[entry.path]);
  const children = entriesByDirectory[entry.path] || [];
  return (
    <li>
      <button
        type="button"
        className={`flex w-full min-w-0 items-center gap-1.5 rounded px-2 py-1 text-left text-[11px] ${
          selectedFilePath === entry.path
            ? 'bg-slate-800 text-slate-100'
            : 'text-slate-300 hover:bg-slate-800/60'
        }`}
        onClick={() => (isDirectory ? void onToggleDirectory(entry.path) : onOpenFile(entry.path))}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
      >
        {isDirectory ? (
          <ChevronRight
            className={`h-3 w-3 shrink-0 text-slate-500 transition-transform ${
              isExpanded ? 'rotate-90' : ''
            }`}
          />
        ) : (
          <span className="h-3 w-3 shrink-0" />
        )}
        {isDirectory ? (
          <Folder className="h-3.5 w-3.5 shrink-0 text-slate-400" />
        ) : (
          <File className="h-3.5 w-3.5 shrink-0 text-slate-500" />
        )}
        <span className="min-w-0 flex-1 truncate">{entry.name}</span>
      </button>
      {isDirectory && isExpanded ? (
        <div className="mt-0.5">
          {isLoading ? (
            <div
              className="px-2 py-1 text-[11px] text-slate-500"
              style={{ paddingLeft: `${28 + (depth + 1) * 14}px` }}
            >
              {t('artifact.loading')}
            </div>
          ) : children.length > 0 ? (
            <ul className="space-y-0.5">
              {children.map((child) => (
                <ProjectTreeNode
                  key={`${child.type}-${child.path}`}
                  entry={child}
                  entriesByDirectory={entriesByDirectory}
                  expandedDirectories={expandedDirectories}
                  loadingDirectories={loadingDirectories}
                  selectedFilePath={selectedFilePath}
                  onToggleDirectory={onToggleDirectory}
                  onOpenFile={onOpenFile}
                  depth={depth + 1}
                />
              ))}
            </ul>
          ) : (
            <div
              className="px-2 py-1 text-[11px] text-slate-600"
              style={{ paddingLeft: `${28 + (depth + 1) * 14}px` }}
            >
              {t('artifact.empty')}
            </div>
          )}
        </div>
      ) : null}
    </li>
  );
}

function inferLanguage(filePath: string) {
  const extension = filePath.split('.').pop()?.toLowerCase();
  if (!extension) return 'text';
  const languageByExtension: Record<string, string> = {
    js: 'javascript',
    jsx: 'jsx',
    ts: 'typescript',
    tsx: 'tsx',
    json: 'json',
    md: 'markdown',
    css: 'css',
    html: 'html',
    yml: 'yaml',
    yaml: 'yaml',
    sh: 'bash',
    sql: 'sql',
  };
  return languageByExtension[extension] || 'text';
}
