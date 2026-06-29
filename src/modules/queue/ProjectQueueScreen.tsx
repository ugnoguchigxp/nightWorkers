import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { Rows3, Table2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ProjectQueueBoard } from './ProjectQueueBoard';
import { ProjectQueueTable } from './ProjectQueueTable';
import { ProjectQueueTaskCardPreview } from './ProjectQueueTaskCard';
import {
  buildPlannedReorderUpdates,
  isAttentionToPlannedMove,
  isProjectQueueLaneDomId,
} from './projectQueueDnd';
import { buildProjectQueueTasks, groupProjectQueueTasks } from './projectQueueModel';
import type { ProjectQueueScreenProps, ProjectQueueViewMode } from './projectQueueTypes';

export function ProjectQueueScreen(props: ProjectQueueScreenProps) {
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ProjectQueueViewMode>('board');
  const [isPersisting, setIsPersisting] = useState(false);
  const tasks = useMemo(() => buildProjectQueueTasks(props), [props]);
  const lanes = useMemo(() => groupProjectQueueTasks(tasks), [tasks]);
  const activeTask = activeTaskId ? tasks.find((task) => task.id === activeTaskId) || null : null;
  const processorCount = props.implementationQueue?.settings.processorCount ?? 0;
  const projectExecutingCount = lanes.executing.length;
  const occupiedSlots =
    props.implementationQueue?.processors.filter((lane) => lane.entry).length ?? 0;
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragStart = (event: DragStartEvent) => {
    setActiveTaskId(String(event.active.id));
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveTaskId(null);
    const active = tasks.find((task) => task.id === String(event.active.id)) || null;
    const overId = event.over?.id ? String(event.over.id) : null;
    if (!active || !overId) return;
    const overTask = tasks.find((task) => task.id === overId) || null;

    if (active.status === 'planned' && overTask?.status === 'planned') {
      const updates = buildPlannedReorderUpdates(tasks, active.id, overTask.id);
      if (updates.length === 0) return;
      setIsPersisting(true);
      try {
        await Promise.all(
          updates.map((update) =>
            props.onUpdateQueueEntry(update.entryId, { queuePosition: update.queuePosition })
          )
        );
      } finally {
        setIsPersisting(false);
      }
      return;
    }

    if (isAttentionToPlannedMove(active, overId, overTask)) {
      setIsPersisting(true);
      try {
        if (active.queueEntryId) {
          await props.onRequeueEntry(
            active.queueEntryId,
            'Returned to Planned from Project Queue.'
          );
        } else {
          await props.onQueueSession(active.sessionId);
        }
      } finally {
        setIsPersisting(false);
      }
    }
  };

  return (
    <DndContext
      collisionDetection={(args) => {
        if (args.active.data.current?.status === 'planned') {
          const collisions = closestCenter(args);
          const taskCollision = collisions.find(
            (collision) =>
              !isProjectQueueLaneDomId(String(collision.id)) &&
              String(collision.id) !== String(args.active.id)
          );
          return taskCollision ? [taskCollision] : collisions;
        }
        const pointerCollisions = pointerWithin(args);
        const taskCollision = pointerCollisions.find(
          (collision) =>
            !isProjectQueueLaneDomId(String(collision.id)) &&
            String(collision.id) !== String(args.active.id)
        );
        if (taskCollision) return [taskCollision];
        return pointerCollisions.length > 0 ? pointerCollisions : closestCenter(args);
      }}
      onDragCancel={() => setActiveTaskId(null)}
      onDragEnd={(event) => {
        void handleDragEnd(event);
      }}
      onDragStart={handleDragStart}
      sensors={sensors}
    >
      <main className="flex h-full min-h-0 flex-col bg-[#111827] text-slate-100">
        <header className="flex h-12 shrink-0 items-center justify-between border-slate-800 border-b px-4">
          <div className="min-w-0">
            <div className="truncate font-semibold text-sm text-slate-100">
              {props.project.name}
            </div>
            <div className="text-slate-500 text-xs">
              {processorCount} global slots / {occupiedSlots} occupied / {projectExecutingCount}{' '}
              project executing
            </div>
          </div>
          <div className="flex items-center gap-2">
            {props.isLoading || isPersisting ? (
              <span className="text-slate-500 text-xs">
                {isPersisting ? 'Saving queue order...' : 'Loading queue...'}
              </span>
            ) : null}
            <button
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-slate-700 bg-slate-950/60 text-slate-300 transition hover:border-cyan-400/60 hover:text-cyan-100"
              data-view-toggle="project-queue"
              onClick={() => setViewMode((current) => (current === 'board' ? 'table' : 'board'))}
              title={viewMode === 'board' ? 'Switch to Table view' : 'Switch to Queue view'}
              type="button"
            >
              {viewMode === 'board' ? (
                <Table2 className="h-4 w-4" />
              ) : (
                <Rows3 className="h-4 w-4" />
              )}
            </button>
          </div>
        </header>
        <div className="nightworkers-scrollbar min-h-0 flex-1 overflow-auto">
          {!props.isLoading && tasks.length === 0 ? (
            <ProjectQueueEmptyState />
          ) : viewMode === 'table' ? (
            <ProjectQueueTable onOpenSession={props.onOpenSession} tasks={tasks} />
          ) : (
            <ProjectQueueBoard
              activeTask={activeTask}
              lanes={lanes}
              onOpenSession={props.onOpenSession}
            />
          )}
        </div>
      </main>
      <DragOverlay style={{ zIndex: 10_000 }}>
        {activeTask ? <ProjectQueueTaskCardPreview task={activeTask} /> : null}
      </DragOverlay>
    </DndContext>
  );
}

function ProjectQueueEmptyState() {
  return (
    <div className="flex min-h-[360px] items-center justify-center p-8">
      <div className="rounded-md border border-slate-800 bg-slate-950/35 px-4 py-3 text-center text-slate-400 text-sm">
        This project has no Sessions in the Project Queue view.
      </div>
    </div>
  );
}
