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
  DecisionReviewView,
  getQuestionCount,
  QuestionnaireForm,
} from './ArtifactQuestionnaire';

export function BlueprintSpecificationWorkspaceViewer({
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
