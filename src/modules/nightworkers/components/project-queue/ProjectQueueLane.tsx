import { useDroppable } from '@dnd-kit/core';
import type { ReactNode } from 'react';
import { canDropTaskOnLane, PROJECT_QUEUE_LANE_IDS } from './projectQueueDnd';
import type { ProjectQueueLaneId, ProjectQueueTask } from './projectQueueTypes';

type ProjectQueueLaneProps = {
  laneId: ProjectQueueLaneId;
  title: string;
  icon: ReactNode;
  count: number;
  activeTask: ProjectQueueTask | null;
  children: ReactNode;
  emphasized?: boolean;
};

export function ProjectQueueLane({
  laneId,
  title,
  icon,
  count,
  activeTask,
  children,
  emphasized,
}: ProjectQueueLaneProps) {
  const domId = PROJECT_QUEUE_LANE_IDS[laneId];
  const { isOver, setNodeRef } = useDroppable({ id: domId });
  const acceptsDrop = canDropTaskOnLane(activeTask, laneId);
  return (
    <section
      ref={setNodeRef}
      className={`flex min-h-[620px] flex-col border-slate-800 border-r ${
        acceptsDrop && activeTask ? 'bg-emerald-950/16 ring-1 ring-inset ring-emerald-400/45' : ''
      } ${acceptsDrop && isOver ? 'bg-emerald-900/24 ring-2 ring-inset ring-emerald-300/80' : ''} ${
        activeTask && !acceptsDrop ? 'opacity-72' : ''
      }`}
      data-lane-id={domId}
    >
      <ProjectQueueLaneHeader count={count} emphasized={emphasized} icon={icon} title={title} />
      {acceptsDrop && activeTask ? (
        <div className="mx-3 mt-3 rounded-md border border-emerald-400/40 bg-emerald-950/40 px-3 py-2 text-emerald-100 text-xs">
          {activeTask.status === 'attention'
            ? 'Drop here to return this Session to Planned.'
            : 'Drop onto another Planned Session to persist queue order.'}
        </div>
      ) : null}
      <div className="space-y-2 p-3">{children}</div>
    </section>
  );
}

function ProjectQueueLaneHeader({
  icon,
  title,
  count,
  emphasized,
}: {
  icon: ReactNode;
  title: string;
  count: number;
  emphasized?: boolean;
}) {
  return (
    <div className="flex h-10 items-center justify-between border-slate-800 border-b px-3">
      <div className="flex min-w-0 items-center gap-2 font-semibold text-slate-200 text-xs uppercase">
        <span className={emphasized ? 'text-emerald-200' : 'text-slate-400'}>{icon}</span>
        <span className="truncate">{title}</span>
      </div>
      <span className="rounded-full border border-slate-700 bg-slate-950 px-2 py-0.5 text-[11px] text-slate-400">
        {count}
      </span>
    </div>
  );
}
