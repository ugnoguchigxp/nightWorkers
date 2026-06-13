import {
  Archive,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderPlus,
  LoaderCircle,
  MessageCircleQuestion,
  Plus,
  Trash2,
} from 'lucide-react';
import { memo, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import type { ProjectSessionGroups } from '../hooks/useNightWorkersWorkspace';
import type { Repository, WorkbenchSessionView } from '../types';
import { getRelativeTimestamp } from '../utils/time';

type ProjectSidebarProps = {
  projects: Repository[];
  groupedSessions: Record<string, ProjectSessionGroups>;
  isProjectsLoading: boolean;
  activeSessionId: string | null;
  expandedProjects: Record<string, boolean>;
  onSelectSession: (sessionId: string) => void;
  onCreateSession: (repositoryId: string) => void;
  onDeleteProject: (projectId: string) => void;
  onToggleProject: (projectId: string) => void;
  onOpenOverview: () => void;
  isOverviewActive: boolean;
  onQueueSession: (sessionId: string) => Promise<void> | void;
  onRemoveQueueEntry: (entryId: string) => void;
  onOpenFolderBrowser: () => void;
};

const EMPTY_PROJECT_SESSION_GROUPS: ProjectSessionGroups = {
  processing: [],
  queue: [],
  archive: [],
};
const SEEN_DONE_SESSIONS_STORAGE_KEY = 'nightworkers.sidebar.seenDoneSessions.v1';

export const ProjectSidebar = memo(function ProjectSidebar(props: ProjectSidebarProps) {
  const { t } = useTranslation();
  const [expandedArchives, setExpandedArchives] = useState<Record<string, boolean>>({});
  const [seenDoneSessionIds, setSeenDoneSessionIds] = useState<Set<string>>(() =>
    readSeenDoneSessionIds()
  );
  const markDoneSessionSeen = useCallback((session: WorkbenchSessionView) => {
    if (!isDoneSession(session)) return;
    setSeenDoneSessionIds((prev) => {
      if (prev.has(session.task.id)) return prev;
      const next = new Set(prev);
      next.add(session.task.id);
      writeSeenDoneSessionIds(next);
      return next;
    });
  }, []);
  const handleSelectSession = (session: WorkbenchSessionView) => {
    markDoneSessionSeen(session);
    props.onSelectSession(session.task.id);
  };

  useEffect(() => {
    const activeSession = Object.values(props.groupedSessions)
      .flatMap((grouped) => [...grouped.processing, ...grouped.queue, ...grouped.archive])
      .find((session) => session.task.id === props.activeSessionId);
    if (activeSession) markDoneSessionSeen(activeSession);
  }, [props.activeSessionId, props.groupedSessions, markDoneSessionSeen]);

  return (
    <div className="nightworkers-sidebar flex h-screen min-h-0 w-full flex-col overflow-hidden border-r">
      <div className="flex shrink-0 items-center justify-between px-4 pb-3 pt-4">
        <button
          type="button"
          onClick={props.onOpenOverview}
          className={`nightworkers-sidebar-logo inline-flex min-w-0 items-center px-1 py-1 text-left text-base transition focus-visible:outline-none focus-visible:ring-2 ${
            props.isOverviewActive ? 'nightworkers-sidebar-link-active rounded-lg' : ''
          }`}
          aria-current={props.isOverviewActive ? 'page' : undefined}
        >
          <span className="truncate">nightWorkers</span>
        </button>
        <button
          type="button"
          onClick={props.onOpenFolderBrowser}
          className="nightworkers-sidebar-icon-button flex h-8 w-8 items-center justify-center rounded-lg transition focus-visible:outline-none focus-visible:ring-2"
          title={t('sidebar.registerProjectFolder')}
        >
          <FolderPlus className="h-4 w-4" />
        </button>
      </div>
      <div className="nightworkers-scrollbar min-h-0 flex-1 space-y-3 overflow-x-hidden overflow-y-auto overscroll-contain pb-4">
        {props.isProjectsLoading ? (
          <div className="nightworkers-sidebar-muted px-4 text-xs">
            {t('sidebar.loadingWorkspaces')}
          </div>
        ) : props.projects.length === 0 ? (
          <div className="nightworkers-sidebar-subtle px-4 text-xs italic">
            {t('sidebar.emptyProjects')}
          </div>
        ) : (
          props.projects.map((project) => {
            const grouped = props.groupedSessions[project.id] || EMPTY_PROJECT_SESSION_GROUPS;
            const isExpanded = props.expandedProjects[project.id] ?? true;
            const isArchiveExpanded = expandedArchives[project.id] ?? false;
            const currentSessions = [...grouped.processing, ...grouped.queue];
            const summary = buildNightShiftSummary(grouped);
            return (
              <div key={project.id} className="space-y-1">
                <div className="group flex items-center justify-between px-3 py-1">
                  <button
                    type="button"
                    onClick={() => props.onToggleProject(project.id)}
                    className="nightworkers-sidebar-project flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1.5 py-1.5 text-left text-sm transition focus-visible:outline-none focus-visible:ring-2"
                    aria-expanded={isExpanded}
                  >
                    {isExpanded ? (
                      <ChevronDown className="nightworkers-sidebar-subtle h-3.5 w-3.5 shrink-0" />
                    ) : (
                      <ChevronRight className="nightworkers-sidebar-subtle h-3.5 w-3.5 shrink-0" />
                    )}
                    <Folder className="nightworkers-sidebar-muted h-4 w-4 shrink-0" />
                    <span className="truncate font-medium">{project.name}</span>
                  </button>
                  <div className="flex items-center gap-1 opacity-70 transition group-hover:opacity-100">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="nightworkers-sidebar-icon-button h-7 w-7 rounded-md p-0"
                      onClick={() => props.onCreateSession(project.id)}
                      title={t('sidebar.createTask')}
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="nightworkers-sidebar-danger-button h-7 w-7 rounded-md p-0"
                      onClick={() => {
                        const ok = window.confirm(
                          t('sidebar.confirmDeleteProject', { name: project.name })
                        );
                        if (!ok) return;
                        props.onDeleteProject(project.id);
                      }}
                      title={t('sidebar.deleteProject')}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                {isExpanded ? (
                  <div className="space-y-1">
                    <NightShiftSummary
                      summary={summary}
                      archiveCount={grouped.archive.length}
                      archiveExpanded={isArchiveExpanded}
                      onToggleArchive={() =>
                        setExpandedArchives((prev) => ({
                          ...prev,
                          [project.id]: !isArchiveExpanded,
                        }))
                      }
                    />
                    <SessionList
                      sessions={currentSessions}
                      activeSessionId={props.activeSessionId}
                      onSelectSession={handleSelectSession}
                      onQueueSession={props.onQueueSession}
                      onRemoveQueueEntry={props.onRemoveQueueEntry}
                      seenDoneSessionIds={seenDoneSessionIds}
                    />
                    {isArchiveExpanded ? (
                      <SessionList
                        sessions={grouped.archive}
                        activeSessionId={props.activeSessionId}
                        onSelectSession={handleSelectSession}
                        onQueueSession={props.onQueueSession}
                        onRemoveQueueEntry={props.onRemoveQueueEntry}
                        seenDoneSessionIds={seenDoneSessionIds}
                      />
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
});

function readSeenDoneSessionIds() {
  if (typeof window === 'undefined') return new Set<string>();
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SEEN_DONE_SESSIONS_STORAGE_KEY) || '[]');
    return new Set(Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : []);
  } catch {
    return new Set<string>();
  }
}

function writeSeenDoneSessionIds(ids: Set<string>) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(SEEN_DONE_SESSIONS_STORAGE_KEY, JSON.stringify([...ids]));
}

function NightShiftSummary({
  summary,
  archiveCount,
  archiveExpanded,
  onToggleArchive,
}: {
  summary: ReturnType<typeof buildNightShiftSummary>;
  archiveCount: number;
  archiveExpanded: boolean;
  onToggleArchive: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="nightworkers-sidebar-subtle flex min-w-0 items-center gap-3 overflow-hidden px-12 pb-1 text-[11px]">
      <span className="inline-flex shrink-0 items-center gap-1" title="Queued">
        <Archive className="h-3 w-3" />
        {summary.queued}
      </span>
      <span className="inline-flex shrink-0 items-center gap-1" title="Running">
        <LoaderCircle className="h-3 w-3" />
        {summary.running}
      </span>
      <span
        className="inline-flex shrink-0 items-center gap-1 text-emerald-600"
        title="Review required"
      >
        <span className="h-2 w-2 rounded-full bg-emerald-500" />
        {summary.reviewNeeded}
      </span>
      <span
        className="inline-flex shrink-0 items-center gap-1 text-red-600"
        title="Needs human input"
      >
        <MessageCircleQuestion className="h-3 w-3" />
        {summary.needsInput}
      </span>
      <button
        type="button"
        className={`nightworkers-sidebar-icon-button inline-flex h-5 shrink-0 items-center gap-1 rounded px-1 transition focus-visible:outline-none focus-visible:ring-2 ${
          archiveExpanded ? 'nightworkers-sidebar-link-active' : ''
        }`}
        onClick={onToggleArchive}
        title={t('sidebar.archive')}
        aria-label={`${t('sidebar.archive')} ${archiveCount}`}
        aria-pressed={archiveExpanded}
      >
        <Archive className="h-3 w-3" />
        <span>{archiveCount}</span>
      </button>
      <span className="sr-only">
        NightShift: {summary.queued} queued, {summary.running} running, {summary.reviewNeeded}{' '}
        review required, {summary.needsInput} needs input, {archiveCount} archived
      </span>
    </div>
  );
}

function isDoneSession(session: WorkbenchSessionView) {
  return session.task.status === 'completed' || session.phase === 'Completed';
}

function SessionList({
  sessions,
  activeSessionId,
  onSelectSession,
  onQueueSession,
  onRemoveQueueEntry,
  seenDoneSessionIds,
}: {
  sessions: WorkbenchSessionView[];
  activeSessionId: string | null;
  onSelectSession: (session: WorkbenchSessionView) => void;
  onQueueSession: (sessionId: string) => Promise<void> | void;
  onRemoveQueueEntry: (entryId: string) => void;
  seenDoneSessionIds: Set<string>;
}) {
  const { t } = useTranslation();

  return (
    <section>
      {sessions.length === 0 ? (
        <div className="nightworkers-sidebar-subtle px-12 py-2 text-xs">{t('sidebar.noTasks')}</div>
      ) : (
        <ul className="min-w-0 space-y-1 overflow-hidden">
          {sessions.map((session) => (
            <SessionRow
              key={session.task.id}
              session={session}
              active={session.task.id === activeSessionId}
              onSelectSession={onSelectSession}
              onQueueSession={onQueueSession}
              onRemoveQueueEntry={onRemoveQueueEntry}
              seenDoneSessionIds={seenDoneSessionIds}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function SessionRow({
  session,
  active,
  onSelectSession,
  onQueueSession,
  onRemoveQueueEntry,
  seenDoneSessionIds,
}: {
  session: WorkbenchSessionView;
  active: boolean;
  onSelectSession: (session: WorkbenchSessionView) => void;
  onQueueSession: (sessionId: string) => Promise<void> | void;
  onRemoveQueueEntry: (entryId: string) => void;
  seenDoneSessionIds: Set<string>;
}) {
  const { t } = useTranslation();
  const action = getRowAction(t, session);
  return (
    <li className="group flex min-w-0 items-stretch gap-1 overflow-hidden px-1">
      <button
        type="button"
        onClick={() => onSelectSession(session)}
        className={`nightworkers-sidebar-session-row min-h-[56px] min-w-0 flex-1 overflow-hidden rounded-lg px-3 py-2 text-left transition focus-visible:outline-none focus-visible:ring-2 ${
          active ? 'nightworkers-sidebar-session-row-active' : ''
        }`}
      >
        <span className="flex min-w-0 items-center justify-between gap-2">
          <span className="block min-w-0 flex-1 truncate text-[13px] font-medium">
            {session.task.title}
          </span>
          <SessionStateBadge session={session} />
        </span>
        <span className="nightworkers-sidebar-subtle mt-1 flex min-w-0 items-center gap-2 text-[11px]">
          <SessionProgressLabel session={session} />
          <span className="truncate">{action.label}</span>
          <SessionStateMarker session={session} seen={seenDoneSessionIds.has(session.task.id)} />
        </span>
      </button>
      {action.kind === 'button' ? (
        <button
          type="button"
          className="nightworkers-sidebar-icon-button my-2 w-14 shrink-0 rounded-md px-2 text-[11px] opacity-80 transition hover:opacity-100 focus-visible:outline-none focus-visible:ring-2"
          onClick={() => {
            if (action.command === 'queue') void onQueueSession(session.task.id);
            if (action.command === 'remove' && session.queueEntry) {
              onRemoveQueueEntry(session.queueEntry.id);
            }
          }}
          disabled={action.command === 'remove' && !session.queueEntry}
          title={action.command === 'queue' ? t('sidebar.queueSession') : t('sidebar.removeQueue')}
        >
          {action.text}
        </button>
      ) : null}
    </li>
  );
}

function SessionProgressLabel({ session }: { session: WorkbenchSessionView }) {
  const { t } = useTranslation();

  if (session.emailState === 'plan_ready') {
    return <span className="shrink-0">{t('sidebar.ready')}</span>;
  }
  if (session.emailState === 'queued') {
    return <span className="shrink-0">Queue #{session.queuePosition ?? '-'}</span>;
  }
  if (session.latestRun) return <span className="shrink-0">{session.progress.percent}%</span>;
  return null;
}

function SessionStateBadge({ session }: { session: WorkbenchSessionView }) {
  if (session.emailState === 'review_needed') {
    return (
      <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500" title="Review required">
        <span className="sr-only">Review required</span>
      </span>
    );
  }
  if (session.emailState === 'failed' || session.emailState === 'needs_input') {
    const label = session.emailState === 'needs_input' ? 'Needs human input' : 'Error';
    return (
      <span
        className="nightworkers-sidebar-problem h-2.5 w-2.5 shrink-0 rounded-full"
        title={label}
      >
        <span className="sr-only">{label}</span>
      </span>
    );
  }
  return (
    <span className="nightworkers-sidebar-chip shrink-0 rounded-full px-2 py-0.5 text-[10px]">
      {stateLabel(session)}
    </span>
  );
}

function SessionStateMarker({ session, seen }: { session: WorkbenchSessionView; seen: boolean }) {
  const { t } = useTranslation();
  const taskStatus = session.task.status;
  const runStatus = session.latestRun?.status;
  const hasProblem =
    session.progress.blockers.length > 0 ||
    ['failed', 'blocked', 'timed_out', 'needs_human'].includes(taskStatus) ||
    (runStatus ? ['failed', 'blocked', 'timed_out', 'needs_human'].includes(runStatus) : false);
  const isComplete = taskStatus === 'completed' || session.phase === 'Completed';
  const isRunning =
    !hasProblem &&
    !isComplete &&
    (['running', 'context_compiling', 'compiling_context', 'finalizing', 'verifying'].includes(
      taskStatus
    ) ||
      (runStatus
        ? ['running', 'context_compiling', 'compiling_context', 'finalizing', 'verifying'].includes(
            runStatus
          )
        : false));

  if (hasProblem) {
    return (
      <span
        className="nightworkers-sidebar-problem h-2 w-2 shrink-0 rounded-full"
        title={t('sidebar.problem')}
      />
    );
  }
  if (isComplete && !seen) {
    return (
      <span className="nightworkers-sidebar-done rounded-full px-2 py-0.5 text-[11px]">
        {t('sidebar.done')}
      </span>
    );
  }
  if (isRunning) {
    return (
      <LoaderCircle
        className="nightworkers-sidebar-running h-3 w-3 shrink-0 animate-spin"
        aria-label={t('sidebar.running')}
      />
    );
  }
  return <span className="shrink-0">{getRelativeTimestamp(session.task.updatedAt)}</span>;
}

function buildNightShiftSummary(grouped: ProjectSessionGroups) {
  const sessions = [...grouped.processing, ...grouped.queue, ...grouped.archive];
  return {
    queued: sessions.filter((session) => session.emailState === 'queued').length,
    running: sessions.filter((session) => session.emailState === 'running').length,
    reviewNeeded: sessions.filter((session) => session.emailState === 'review_needed').length,
    needsInput: sessions.filter((session) => session.emailState === 'needs_input').length,
  };
}

function getRowAction(
  t: (key: string) => string,
  session: WorkbenchSessionView
):
  | { kind: 'button'; command: 'queue' | 'remove'; text: string; label: string }
  | { kind: 'text'; label: string } {
  if (session.primaryAction === 'queue') {
    return {
      kind: 'button',
      command: 'queue',
      text: t('queue.enqueue'),
      label: t('sidebar.queueSessionLabel'),
    };
  }
  if (session.primaryAction === 'remove') {
    return { kind: 'button', command: 'remove', text: 'Remove', label: 'Remove · Open' };
  }
  if (session.primaryAction === 'review') return { kind: 'text', label: 'Review · Requeue' };
  if (session.primaryAction === 'respond') return { kind: 'text', label: 'Respond · Open' };
  if (session.primaryAction === 'inspect') return { kind: 'text', label: 'Inspect · Open' };
  return { kind: 'text', label: 'Open' };
}

function stateLabel(session: WorkbenchSessionView) {
  if (session.emailState === 'plan_ready') return 'Plan ready';
  if (session.emailState === 'queued') return `Queued #${session.queuePosition ?? '-'}`;
  if (session.emailState === 'running') return 'Running';
  if (session.emailState === 'needs_input') return 'Needs input';
  if (session.emailState === 'review_needed') return 'Review needed';
  if (session.emailState === 'done') return 'Done';
  if (session.emailState === 'failed') return 'Failed';
  return 'Draft';
}
