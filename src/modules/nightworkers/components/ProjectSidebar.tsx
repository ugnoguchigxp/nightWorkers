import { Button } from '@repo/design-system';
import {
  Archive,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderPlus,
  ListTodo,
  LoaderCircle,
  Plus,
  Trash2,
} from 'lucide-react';
import { memo, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
  onOpenQueue: (projectId: string) => void;
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
          className="nightworkers-sidebar-logo inline-flex min-w-0 items-center px-1 py-1 text-left text-base transition focus-visible:outline-none focus-visible:ring-2"
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
      <div className="nightworkers-scrollbar min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain pb-4">
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
                      onClick={() => props.onOpenQueue(project.id)}
                      title={t('sidebar.openImplementationQueue')}
                    >
                      <ListTodo className="h-3.5 w-3.5" />
                    </Button>
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
                    <SessionList
                      sessions={currentSessions}
                      activeSessionId={props.activeSessionId}
                      onSelectSession={handleSelectSession}
                      seenDoneSessionIds={seenDoneSessionIds}
                    />
                    <ProjectArchive
                      sessions={isArchiveExpanded ? grouped.archive : []}
                      count={grouped.archive.length}
                      activeSessionId={props.activeSessionId}
                      onToggleArchive={() =>
                        setExpandedArchives((prev) => ({
                          ...prev,
                          [project.id]: !isArchiveExpanded,
                        }))
                      }
                      onSelectSession={handleSelectSession}
                      archiveExpanded={isArchiveExpanded}
                      seenDoneSessionIds={seenDoneSessionIds}
                    />
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

function isDoneSession(session: WorkbenchSessionView) {
  return session.task.status === 'completed' || session.phase === 'Completed';
}

function ProjectArchive({
  sessions,
  count,
  activeSessionId,
  onSelectSession,
  archiveExpanded,
  onToggleArchive,
  seenDoneSessionIds,
}: {
  sessions: WorkbenchSessionView[];
  count: number;
  activeSessionId: string | null;
  onSelectSession: (session: WorkbenchSessionView) => void;
  archiveExpanded: boolean;
  onToggleArchive: () => void;
  seenDoneSessionIds: Set<string>;
}) {
  const { t } = useTranslation();

  return (
    <SessionSection
      label={t('sidebar.archive')}
      sessions={sessions}
      count={count}
      activeSessionId={activeSessionId}
      onSelectSession={onSelectSession}
      onToggle={onToggleArchive}
      expanded={archiveExpanded}
      showEmpty={false}
      seenDoneSessionIds={seenDoneSessionIds}
    />
  );
}

function SessionList({
  sessions,
  activeSessionId,
  onSelectSession,
  seenDoneSessionIds,
}: {
  sessions: WorkbenchSessionView[];
  activeSessionId: string | null;
  onSelectSession: (session: WorkbenchSessionView) => void;
  seenDoneSessionIds: Set<string>;
}) {
  const { t } = useTranslation();

  return (
    <section>
      {sessions.length === 0 ? (
        <div className="nightworkers-sidebar-subtle px-12 py-2 text-xs">{t('sidebar.noTasks')}</div>
      ) : (
        <ul className="space-y-1">
          {sessions.map((session) => (
            <SessionRow
              key={session.task.id}
              session={session}
              active={session.task.id === activeSessionId}
              onSelectSession={onSelectSession}
              seenDoneSessionIds={seenDoneSessionIds}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function SessionSection({
  label,
  sessions,
  count,
  activeSessionId,
  onSelectSession,
  onToggle,
  expanded,
  showEmpty = true,
  seenDoneSessionIds,
}: {
  label: string;
  sessions: WorkbenchSessionView[];
  count?: number;
  activeSessionId: string | null;
  onSelectSession: (session: WorkbenchSessionView) => void;
  onToggle?: () => void;
  expanded?: boolean;
  showEmpty?: boolean;
  seenDoneSessionIds: Set<string>;
}) {
  const { t } = useTranslation();

  return (
    <section className="pt-1">
      {label ? (
        onToggle ? (
          <button
            type="button"
            className="nightworkers-sidebar-archive-toggle flex w-full items-center justify-between px-4 py-2 text-xs transition focus-visible:outline-none focus-visible:ring-2"
            onClick={onToggle}
          >
            <span className="inline-flex min-w-0 items-center gap-2">
              {expanded ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
              <Archive className="h-3.5 w-3.5" />
              {label}
            </span>
            <span className="nightworkers-sidebar-chip rounded-full px-2 py-0.5 text-[11px]">
              {count ?? sessions.length}
            </span>
          </button>
        ) : (
          <div className="nightworkers-sidebar-subtle flex items-center justify-between px-4 py-1 text-[10px] font-semibold uppercase">
            <span>{label}</span>
            <span>{count ?? sessions.length}</span>
          </div>
        )
      ) : null}
      {sessions.length === 0 && showEmpty ? (
        <div className="nightworkers-sidebar-subtle px-12 py-2 text-xs">{t('sidebar.none')}</div>
      ) : sessions.length > 0 ? (
        <ul className="space-y-1">
          {sessions.map((session) => (
            <SessionRow
              key={session.task.id}
              session={session}
              active={session.task.id === activeSessionId}
              onSelectSession={onSelectSession}
              seenDoneSessionIds={seenDoneSessionIds}
            />
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function SessionRow({
  session,
  queuePosition,
  active,
  onSelectSession,
  seenDoneSessionIds,
}: {
  session: WorkbenchSessionView;
  queuePosition?: number;
  active: boolean;
  onSelectSession: (session: WorkbenchSessionView) => void;
  seenDoneSessionIds: Set<string>;
}) {
  return (
    <li className="px-1">
      <button
        type="button"
        onClick={() => onSelectSession(session)}
        className={`nightworkers-sidebar-session-row flex min-h-11 w-full min-w-0 items-center gap-3 rounded-2xl px-4 py-2.5 text-left text-[15px] leading-tight transition focus-visible:outline-none focus-visible:ring-2 ${
          active ? 'nightworkers-sidebar-session-row-active' : ''
        }`}
      >
        <span className="min-w-0 flex-1 truncate font-medium">{session.task.title}</span>
        <span className="nightworkers-sidebar-subtle flex shrink-0 items-center gap-2 text-xs">
          <SessionProgressLabel session={session} queuePosition={queuePosition} />
          <SessionStateMarker session={session} seen={seenDoneSessionIds.has(session.task.id)} />
        </span>
      </button>
    </li>
  );
}

function SessionProgressLabel({
  session,
  queuePosition,
}: {
  session: WorkbenchSessionView;
  queuePosition?: number;
}) {
  const { t } = useTranslation();

  if (session.group === 'queue') {
    if (session.task.status === 'ready') {
      return <span className="shrink-0">{t('sidebar.ready')}</span>;
    }
    return <span className="shrink-0">#{queuePosition ?? session.queuePosition ?? '-'}</span>;
  }
  if (session.latestRun) return <span className="shrink-0">{session.progress.percent}%</span>;
  return null;
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
