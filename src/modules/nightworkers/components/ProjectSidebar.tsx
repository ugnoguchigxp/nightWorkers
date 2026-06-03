import {
  closestCorners,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Button } from '@repo/design-system';
import {
  ChevronDown,
  ChevronRight,
  Folder,
  LoaderCircle,
  Pause,
  Play,
  Plus,
  Trash2,
} from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
import type { ProjectSessionGroups } from '../hooks/useNightWorkersWorkspace';
import type { Repository, WorkbenchMovableSessionGroup, WorkbenchSessionView } from '../types';
import { getRelativeTimestamp } from '../utils/time';

type ProjectSidebarProps = {
  projects: Repository[];
  groupedSessions: Record<string, ProjectSessionGroups>;
  isProjectsLoading: boolean;
  activeSessionId: string | null;
  expandedProjects: Record<string, boolean>;
  onSelectSession: (sessionId: string) => void;
  onCreateSession: (repositoryId: string) => void;
  onUpdateProject: (
    projectId: string,
    input: { queueEnabled?: boolean; maxConcurrentSessions?: number }
  ) => void;
  onDeleteProject: (projectId: string) => void;
  onMoveSession: (input: {
    sessionId: string;
    sourceGroup: WorkbenchMovableSessionGroup;
    targetGroup: WorkbenchMovableSessionGroup;
    processingIds: string[];
    queueIds: string[];
    archiveIds: string[];
  }) => void;
  onToggleProject: (projectId: string) => void;
  onOpenFolderBrowser: () => void;
};

const EMPTY_PROJECT_SESSION_GROUPS: ProjectSessionGroups = {
  processing: [],
  queue: [],
  archive: [],
};

export const ProjectSidebar = memo(function ProjectSidebar(props: ProjectSidebarProps) {
  const [expandedArchives, setExpandedArchives] = useState<Record<string, boolean>>({});
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  return (
    <div className="flex min-h-screen w-full flex-col border-r border-slate-700/70 bg-[#0f172a]">
      <div className="flex items-center justify-between px-4 pb-2 pt-4">
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
      <div className="space-y-5 py-2">
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
                      className={`h-6 w-6 p-0 ${
                        project.queueEnabled
                          ? 'text-emerald-300 hover:text-emerald-200'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                      onClick={() =>
                        props.onUpdateProject(project.id, {
                          queueEnabled: !project.queueEnabled,
                        })
                      }
                      title={project.queueEnabled ? 'Pause session queue' : 'Play session queue'}
                    >
                      {project.queueEnabled ? (
                        <Pause className="h-3.5 w-3.5" />
                      ) : (
                        <Play className="h-3.5 w-3.5" />
                      )}
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
                    <ProjectSessionDnD
                      projectId={project.id}
                      grouped={grouped}
                      activeSessionId={props.activeSessionId}
                      sensors={sensors}
                      archiveExpanded={isArchiveExpanded}
                      onToggleArchive={() =>
                        setExpandedArchives((prev) => ({
                          ...prev,
                          [project.id]: !isArchiveExpanded,
                        }))
                      }
                      onSelectSession={props.onSelectSession}
                      onMoveSession={props.onMoveSession}
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

function ProjectSessionDnD({
  projectId,
  grouped,
  activeSessionId,
  sensors,
  onSelectSession,
  onMoveSession,
  archiveExpanded,
  onToggleArchive,
}: {
  projectId: string;
  grouped: ProjectSessionGroups;
  activeSessionId: string | null;
  sensors: ReturnType<typeof useSensors>;
  onSelectSession: (sessionId: string) => void;
  onMoveSession: (input: {
    sessionId: string;
    sourceGroup: WorkbenchMovableSessionGroup;
    targetGroup: WorkbenchMovableSessionGroup;
    processingIds: string[];
    queueIds: string[];
    archiveIds: string[];
  }) => void;
  archiveExpanded: boolean;
  onToggleArchive: () => void;
}) {
  const containerId = (group: WorkbenchMovableSessionGroup) => `${projectId}:${group}`;
  const processingId = containerId('processing');
  const queueId = containerId('queue');
  const archiveId = containerId('archive');
  const sessionById = useMemo(
    () =>
      new Map(
        [...grouped.processing, ...grouped.queue, ...grouped.archive].map((session) => [
          session.task.id,
          session,
        ])
      ),
    [grouped.archive, grouped.processing, grouped.queue]
  );
  const orderedIdsByGroup = useMemo(
    () => ({
      processing: grouped.processing.map((session) => session.task.id),
      queue: grouped.queue.map((session) => session.task.id),
      archive: grouped.archive.map((session) => session.task.id),
    }),
    [grouped.archive, grouped.processing, grouped.queue]
  );

  const findGroup = useCallback(
    (id: string): WorkbenchMovableSessionGroup | null => {
      if (id === processingId) return 'processing';
      if (id === queueId) return 'queue';
      if (id === archiveId) return 'archive';
      return ['processing', 'queue', 'archive'].includes(sessionById.get(id)?.group || '')
        ? (sessionById.get(id)?.group as WorkbenchMovableSessionGroup)
        : null;
    },
    [archiveId, processingId, queueId, sessionById]
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const sessionId = String(event.active.id);
      const overId = event.over ? String(event.over.id) : null;
      if (!overId || sessionId === overId) return;

      const activeGroup = findGroup(sessionId);
      const targetGroup = findGroup(overId);
      if (!activeGroup || !targetGroup) return;

      const movedSession = sessionById.get(sessionId);
      if (!movedSession) return;
      if (
        activeGroup === 'processing' &&
        targetGroup !== 'processing' &&
        hasActiveRun(movedSession)
      ) {
        return;
      }

      const next = {
        processing: [...orderedIdsByGroup.processing],
        queue: [...orderedIdsByGroup.queue],
        archive: [...orderedIdsByGroup.archive],
      };

      if (activeGroup === targetGroup) {
        const oldIndex = next[activeGroup].indexOf(sessionId);
        const newIndex = next[targetGroup].indexOf(overId);
        if (oldIndex < 0 || newIndex < 0) return;
        next[targetGroup] = arrayMove(next[targetGroup], oldIndex, newIndex);
      } else {
        next[activeGroup] = next[activeGroup].filter((id) => id !== sessionId);
        const targetIds = next[targetGroup];
        const overIndex = targetIds.indexOf(overId);
        const insertIndex = overIndex >= 0 ? overIndex : targetIds.length;
        next[targetGroup] = [
          ...targetIds.slice(0, insertIndex),
          sessionId,
          ...targetIds.slice(insertIndex),
        ];
      }

      onMoveSession({
        sessionId,
        sourceGroup: activeGroup,
        targetGroup,
        processingIds: next.processing,
        queueIds: next.queue,
        archiveIds: next.archive,
      });
    },
    [findGroup, onMoveSession, orderedIdsByGroup, sessionById]
  );

  return (
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={handleDragEnd}>
      <SessionSection
        id={processingId}
        label="Processing"
        sessions={grouped.processing}
        activeSessionId={activeSessionId}
        onSelectSession={onSelectSession}
      />
      <SessionSection
        id={queueId}
        label="Queue"
        sessions={grouped.queue}
        activeSessionId={activeSessionId}
        onSelectSession={onSelectSession}
      />
      <SessionSection
        id={archiveId}
        label="Archive"
        sessions={archiveExpanded ? grouped.archive : []}
        count={grouped.archive.length}
        activeSessionId={activeSessionId}
        onSelectSession={onSelectSession}
        onToggle={onToggleArchive}
        expanded={archiveExpanded}
        showEmpty={false}
      />
    </DndContext>
  );
}

function SessionSection({
  id,
  label,
  sessions,
  count,
  activeSessionId,
  onSelectSession,
  onToggle,
  expanded,
  showEmpty = true,
}: {
  id: string;
  label: string;
  sessions: WorkbenchSessionView[];
  count?: number;
  activeSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
  onToggle?: () => void;
  expanded?: boolean;
  showEmpty?: boolean;
}) {
  const itemIds = useMemo(() => sessions.map((session) => session.task.id), [sessions]);
  const droppable = useDroppable({ id });
  return (
    <section ref={droppable.setNodeRef}>
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
        <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
          <ul className="space-y-0.5">
            {sessions.map((session) => (
              <SortableSessionRow
                key={session.task.id}
                session={session}
                queuePosition={session.group === 'queue' ? session.queuePosition : undefined}
                active={session.task.id === activeSessionId}
                disabled={session.group === 'archive'}
                onSelectSession={onSelectSession}
              />
            ))}
          </ul>
        </SortableContext>
      ) : null}
    </section>
  );
}

function SortableSessionRow({
  session,
  queuePosition,
  active,
  onSelectSession,
  disabled = false,
}: {
  session: WorkbenchSessionView;
  queuePosition?: number;
  active: boolean;
  onSelectSession: (sessionId: string) => void;
  disabled?: boolean;
}) {
  const sortable = useSortable({
    id: session.task.id,
    disabled,
    data: { group: session.group },
  });
  const style = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
  };
  return (
    <li
      ref={sortable.setNodeRef}
      style={style}
      className={`mx-2 min-h-9 w-[calc(100%-1rem)] rounded-md border px-2 py-1.5 text-xs ${
        active
          ? 'border-slate-500/70 bg-slate-800/60 text-slate-100'
          : 'border-slate-700/70 text-slate-300 hover:border-slate-500/60 hover:bg-slate-800/40'
      } ${disabled ? '' : 'cursor-grab active:cursor-grabbing'} ${
        sortable.isDragging ? 'z-10 opacity-50' : ''
      }`}
      {...sortable.attributes}
      {...sortable.listeners}
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
    if (session.task.status === 'draft') return <span className="shrink-0">draft</span>;
    return <span className="shrink-0">#{queuePosition ?? session.queuePosition ?? '-'}</span>;
  }
  if (session.latestRun) return <span className="shrink-0">{session.progress.percent}%</span>;
  return null;
}

function hasActiveRun(session: WorkbenchSessionView) {
  return session.latestRun
    ? ['context_compiling', 'compiling_context', 'running', 'finalizing'].includes(
        session.latestRun.status
      )
    : false;
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
    (session.group === 'processing' ||
      ['running', 'context_compiling', 'compiling_context', 'finalizing', 'verifying'].includes(
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
