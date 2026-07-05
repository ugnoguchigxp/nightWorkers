import { useDraggable } from '@dnd-kit/core';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { AlertTriangle, CheckCircle2, GripVertical, Play } from 'lucide-react';
import type { CSSProperties, HTMLAttributes } from 'react';
import { getProjectQueuePriorityLabel, getProjectQueueStatusLabel } from './projectQueueModel';
import type { ProjectQueueTask } from './projectQueueTypes';
import { getRelativeTimestamp } from './queueTime';

type ProjectQueueTaskCardProps = {
  task: ProjectQueueTask;
  onOpenSession?: (sessionId: string) => void;
};

export function SortableProjectQueueTaskCard(props: ProjectQueueTaskCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.task.id,
    data: { status: props.task.status },
  });
  return (
    <ProjectQueueTaskCardFrame
      dragProps={{ ...attributes, ...listeners }}
      isDragging={isDragging}
      onOpenSession={props.onOpenSession}
      setNodeRef={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      task={props.task}
    />
  );
}

export function DraggableProjectQueueTaskCard(props: ProjectQueueTaskCardProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: props.task.id,
    data: { status: props.task.status },
  });
  return (
    <ProjectQueueTaskCardFrame
      dragProps={{ ...attributes, ...listeners }}
      isDragging={isDragging}
      onOpenSession={props.onOpenSession}
      setNodeRef={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform) }}
      task={props.task}
    />
  );
}

export function StaticProjectQueueTaskCard(props: ProjectQueueTaskCardProps) {
  return (
    <ProjectQueueTaskCardFrame
      dragProps={{}}
      isDragging={false}
      onOpenSession={props.onOpenSession}
      setNodeRef={() => undefined}
      style={{}}
      task={props.task}
    />
  );
}

export function ProjectQueueTaskCardPreview({ task }: { task: ProjectQueueTask }) {
  return (
    <div className="w-64">
      <ProjectQueueTaskCardFrame
        dragProps={{}}
        isDragging
        setNodeRef={() => undefined}
        style={{}}
        task={task}
      />
    </div>
  );
}

function ProjectQueueTaskCardFrame({
  task,
  setNodeRef,
  style,
  dragProps,
  isDragging,
  onOpenSession,
}: {
  task: ProjectQueueTask;
  setNodeRef: (element: HTMLElement | null) => void;
  style: CSSProperties;
  dragProps: HTMLAttributes<HTMLButtonElement>;
  isDragging: boolean;
  onOpenSession?: (sessionId: string) => void;
}) {
  const marker = buildTaskMarker(task);
  return (
    <button
      ref={setNodeRef}
      className={`flex h-36 w-full touch-none flex-col rounded-md border p-3 text-left transition hover:border-cyan-400/60 ${
        Object.keys(dragProps).length ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'
      } ${isDragging ? 'opacity-45 shadow-xl' : ''} ${statusToneClass(task)}`}
      data-task-id={task.id}
      data-task-status={task.status}
      onClick={() => onOpenSession?.(task.sessionId)}
      style={style}
      type="button"
      {...dragProps}
    >
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="inline-flex min-w-0 items-center gap-1 font-semibold">
          {buildStatusIcon(task)}
          <span className="truncate">{marker}</span>
        </span>
        <span className="shrink-0 text-slate-400">{getRelativeTimestamp(task.updatedAt)}</span>
      </div>
      <div className="mt-2 line-clamp-2 min-h-10 font-medium text-[13px] text-slate-50">
        {task.title}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 text-[11px]">
        <span className="truncate text-slate-400">{task.phase}</span>
        <span className="flex shrink-0 items-center gap-1">
          {task.executionType && task.executionType !== 'normal' ? (
            <span className="rounded border border-amber-500/35 bg-amber-950/35 px-1.5 py-0.5 text-amber-100">
              {task.executionType}
            </span>
          ) : null}
          <span className="rounded border border-slate-700 bg-slate-950/55 px-1.5 py-0.5 text-slate-300">
            {getProjectQueueStatusLabel(task.status)}
          </span>
        </span>
      </div>
      <div className="mt-auto flex items-center gap-1.5 pt-2 text-[11px] text-slate-500">
        <CheckCircle2 className="h-3.5 w-3.5" />
        <span className="truncate">{task.statusReason || buildTaskFooter(task)}</span>
      </div>
    </button>
  );
}

function buildTaskIconClass(task: ProjectQueueTask) {
  if (['review_required', 'needs_human', 'failed', 'cancelled'].includes(task.status))
    return 'text-amber-300';
  if (task.status === 'running') return 'text-cyan-300';
  if (task.status === 'plan_mode') return 'text-violet-300';
  if (task.status === 'queued' || task.status === 'ready_for_queue') return 'text-emerald-300';
  return 'text-slate-400';
}

function buildStatusIcon(task: ProjectQueueTask) {
  const className = `h-3.5 w-3.5 shrink-0 ${buildTaskIconClass(task)}`;
  if (['review_required', 'needs_human', 'failed', 'cancelled'].includes(task.status))
    return <AlertTriangle className={className} />;
  if (task.status === 'running') return <Play className={className} />;
  return <GripVertical className={className} />;
}

function buildTaskMarker(task: ProjectQueueTask) {
  const priority = getProjectQueuePriorityLabel(task);
  if (priority) return priority;
  if (task.processorSlot) return `Processor ${task.processorSlot}`;
  return getProjectQueueStatusLabel(task.status);
}

function buildTaskFooter(task: ProjectQueueTask) {
  if (task.status === 'plan_mode') return 'Plan Mode before implementation';
  if (task.status === 'unclassified') return 'not in implementation queue';
  if (task.status === 'ready_for_queue') return 'ready to enter the implementation queue';
  if (task.status === 'queued') return 'queued for implementation';
  if (task.status === 'running')
    return task.activeRunId ? `run ${task.activeRunId.slice(0, 8)}` : 'active run';
  if (task.status === 'review_required') return 'review required';
  if (task.status === 'needs_human') return 'human input required';
  if (task.status === 'failed') return 'failed';
  if (task.status === 'cancelled') return 'cancelled';
  return 'completed';
}

function statusToneClass(task: ProjectQueueTask) {
  if (task.status === 'plan_mode') return 'border-violet-500/35 bg-violet-950/18 text-violet-100';
  if (task.status === 'queued' || task.status === 'ready_for_queue')
    return 'border-emerald-500/35 bg-emerald-950/18 text-emerald-100';
  if (task.status === 'running') return 'border-cyan-500/45 bg-cyan-950/24 text-cyan-100';
  if (['review_required', 'needs_human', 'failed', 'cancelled'].includes(task.status))
    return 'border-amber-500/40 bg-amber-950/20 text-amber-100';
  if (task.status === 'completed') return 'border-slate-700 bg-slate-950/40 text-slate-300';
  return 'border-slate-700 bg-slate-950/40 text-slate-200';
}
