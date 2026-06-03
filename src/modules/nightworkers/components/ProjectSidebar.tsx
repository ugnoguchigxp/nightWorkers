import { Button } from '@repo/design-system';
import {
  ChevronDown,
  ChevronRight,
  Folder,
  ListTodo,
  LoaderCircle,
  Plus,
  Trash2,
} from 'lucide-react';
import { memo, useState } from 'react';
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
  onOpenQueue: (projectId: string) => void;
  onOpenFolderBrowser: () => void;
};

const EMPTY_PROJECT_SESSION_GROUPS: ProjectSessionGroups = {
  processing: [],
  queue: [],
  archive: [],
};

export const ProjectSidebar = memo(function ProjectSidebar(props: ProjectSidebarProps) {
  const [expandedArchives, setExpandedArchives] = useState<Record<string, boolean>>({});
  return (
    <div className="flex h-screen min-h-0 w-full flex-col overflow-hidden border-r border-slate-700/70 bg-[#0f172a]">
      <div className="flex shrink-0 items-center justify-between px-4 pb-2 pt-4">
        <span className="text-xs font-bold uppercase tracking-wider text-slate-300/80">
          NightWorkers
        </span>
        <button
          type="button"
          onClick={props.onOpenFolderBrowser}
          className="flex h-6 w-6 items-center justify-center rounded-md text-slate-300 hover:bg-slate-700/40"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="nightworkers-scrollbar min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain py-2">
        {props.isProjectsLoading ? (
          <div className="px-4 text-xs text-slate-300/70">Loading workspaces...</div>
        ) : props.projects.length === 0 ? (
          <div className="px-4 text-xs italic text-slate-300/70">
            No project folders registered. Click "+" to register a local directory.
          </div>
        ) : (
          props.projects.map((project) => {
            const grouped = props.groupedSessions[project.id] || EMPTY_PROJECT_SESSION_GROUPS;
            const isExpanded = props.expandedProjects[project.id] ?? true;
            const isArchiveExpanded = expandedArchives[project.id] ?? false;
            const currentSessions = [...grouped.processing, ...grouped.queue];
            return (
              <div key={project.id} className="space-y-1">
                <div className="flex items-center justify-between px-4 py-1.5 text-slate-200/90">
                  <button
                    type="button"
                    onClick={() => props.onToggleProject(project.id)}
                    className="flex items-center gap-2 text-sm font-bold"
                  >
                    <Folder className="h-4 w-4 text-slate-400" />
                    <span>{project.name}</span>
                  </button>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 min-w-6 px-1.5 text-[10px] text-slate-400 hover:text-cyan-100"
                      onClick={() => props.onOpenQueue(project.id)}
                      title="Open Implementation Queue"
                    >
                      <ListTodo className="h-3.5 w-3.5" />
                      <span>Queue</span>
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 text-rose-300 hover:text-rose-200"
                      onClick={() => {
                        const ok = window.confirm(
                          `Project "${project.name}" を削除します。関連するSessionも削除される可能性があります。続行しますか？`
                        );
                        if (!ok) return;
                        props.onDeleteProject(project.id);
                      }}
                      title="Delete project"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0"
                      onClick={() => props.onCreateSession(project.id)}
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                {isExpanded ? (
                  <div className="space-y-2">
                    <SessionList
                      label="Sessions"
                      sessions={currentSessions}
                      activeSessionId={props.activeSessionId}
                      onSelectSession={props.onSelectSession}
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
                      onSelectSession={props.onSelectSession}
                      archiveExpanded={isArchiveExpanded}
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

function ProjectArchive({
  sessions,
  count,
  activeSessionId,
  onSelectSession,
  archiveExpanded,
  onToggleArchive,
}: {
  sessions: WorkbenchSessionView[];
  count: number;
  activeSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
  archiveExpanded: boolean;
  onToggleArchive: () => void;
}) {
  return (
    <SessionSection
      label="Archive"
      sessions={sessions}
      count={count}
      activeSessionId={activeSessionId}
      onSelectSession={onSelectSession}
      onToggle={onToggleArchive}
      expanded={archiveExpanded}
      showEmpty={false}
    />
  );
}

function SessionList({
  label,
  sessions,
  activeSessionId,
  onSelectSession,
}: {
  label: string;
  sessions: WorkbenchSessionView[];
  activeSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
}) {
  return (
    <section>
      <div className="flex items-center justify-between px-4 py-1 text-[10px] font-semibold uppercase text-slate-400">
        <span>{label}</span>
        <span>{sessions.length}</span>
      </div>
      {sessions.length === 0 ? (
        <div className="px-8 py-1 text-[10px] text-slate-500">None</div>
      ) : (
        <ul className="space-y-0.5">
          {sessions.map((session) => (
            <SessionRow
              key={session.task.id}
              session={session}
              active={session.task.id === activeSessionId}
              onSelectSession={onSelectSession}
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
}: {
  label: string;
  sessions: WorkbenchSessionView[];
  count?: number;
  activeSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
  onToggle?: () => void;
  expanded?: boolean;
  showEmpty?: boolean;
}) {
  return (
    <section>
      {label ? (
        onToggle ? (
          <button
            type="button"
            className="flex w-full items-center justify-between px-4 py-1 text-[10px] font-semibold uppercase text-slate-400 hover:text-slate-200"
            onClick={onToggle}
          >
            <span className="inline-flex items-center gap-1">
              {expanded ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
              {label}
            </span>
            <span>{count ?? sessions.length}</span>
          </button>
        ) : (
          <div className="flex items-center justify-between px-4 py-1 text-[10px] font-semibold uppercase text-slate-400">
            <span>{label}</span>
            <span>{count ?? sessions.length}</span>
          </div>
        )
      ) : null}
      {sessions.length === 0 && showEmpty ? (
        <div className="px-8 py-1 text-[10px] text-slate-500">None</div>
      ) : sessions.length > 0 ? (
        <ul className="space-y-0.5">
          {sessions.map((session) => (
            <SessionRow
              key={session.task.id}
              session={session}
              active={session.task.id === activeSessionId}
              onSelectSession={onSelectSession}
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
}: {
  session: WorkbenchSessionView;
  queuePosition?: number;
  active: boolean;
  onSelectSession: (sessionId: string) => void;
}) {
  return (
    <li
      className={`mx-2 min-h-9 w-[calc(100%-1rem)] rounded-md border px-2 py-1.5 text-xs ${
        active
          ? 'border-slate-500/70 bg-slate-800/60 text-slate-100'
          : 'border-slate-700/70 text-slate-300 hover:border-slate-500/60 hover:bg-slate-800/40'
      }`}
    >
      <button
        type="button"
        onClick={() => onSelectSession(session.task.id)}
        className="flex w-full min-w-0 items-center gap-2 text-left"
      >
        <span className="min-w-0 flex-1 truncate font-medium">{session.task.title}</span>
        <span className="flex shrink-0 items-center gap-2 text-[10px] text-slate-400">
          <SessionProgressLabel session={session} queuePosition={queuePosition} />
          <SessionStateMarker session={session} />
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
  if (session.group === 'queue') {
    if (session.task.status === 'ready') return <span className="shrink-0">ready</span>;
    return <span className="shrink-0">#{queuePosition ?? session.queuePosition ?? '-'}</span>;
  }
  if (session.latestRun) return <span className="shrink-0">{session.progress.percent}%</span>;
  return null;
}

function SessionStateMarker({ session }: { session: WorkbenchSessionView }) {
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
    return <span className="h-2 w-2 shrink-0 rounded-full bg-rose-500" title="問題あり" />;
  }
  if (isComplete) {
    return <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-400" title="完了" />;
  }
  if (isRunning) {
    return (
      <LoaderCircle className="h-3 w-3 shrink-0 animate-spin text-cyan-300" aria-label="実行中" />
    );
  }
  return <span className="shrink-0">{getRelativeTimestamp(session.task.updatedAt)}</span>;
}
