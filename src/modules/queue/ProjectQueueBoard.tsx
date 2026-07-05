import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Archive, Cpu, ListChecks, PackageOpen } from 'lucide-react';
import { ProjectQueueLane } from './ProjectQueueLane';
import {
  DraggableProjectQueueTaskCard,
  SortableProjectQueueTaskCard,
  StaticProjectQueueTaskCard,
} from './ProjectQueueTaskCard';
import { canDragProjectQueueTask } from './projectQueueDnd';
import type { ProjectQueueLanes, ProjectQueueTask } from './projectQueueTypes';

type ProjectQueueBoardProps = {
  lanes: ProjectQueueLanes;
  activeTask: ProjectQueueTask | null;
  onOpenSession: (sessionId: string) => void;
};

export function ProjectQueueBoard({ lanes, activeTask, onOpenSession }: ProjectQueueBoardProps) {
  return (
    <div className="grid min-h-[620px] min-w-[820px] grid-cols-[repeat(4,minmax(180px,1fr))]">
      <ProjectQueueLane
        activeTask={activeTask}
        count={lanes.unclassified.length}
        icon={<PackageOpen className="h-4 w-4" />}
        laneId="unclassified"
        title="Unclassified / Plan Mode"
      >
        {lanes.unclassified.map((task) => (
          <StaticProjectQueueTaskCard key={task.id} onOpenSession={onOpenSession} task={task} />
        ))}
      </ProjectQueueLane>
      <ProjectQueueLane
        activeTask={activeTask}
        count={lanes.planned.length}
        emphasized
        icon={<ListChecks className="h-4 w-4" />}
        laneId="planned"
        title="Implementation Queue"
      >
        <SortableContext
          items={lanes.planned.map((task) => task.id)}
          strategy={verticalListSortingStrategy}
        >
          {lanes.planned.map((task) => (
            <SortableProjectQueueTaskCard key={task.id} onOpenSession={onOpenSession} task={task} />
          ))}
        </SortableContext>
      </ProjectQueueLane>
      <ProjectQueueLane
        activeTask={activeTask}
        count={lanes.executing.length}
        icon={<Cpu className="h-4 w-4" />}
        laneId="executing"
        title="Running"
      >
        {lanes.executing.map((task) => (
          <StaticProjectQueueTaskCard key={task.id} onOpenSession={onOpenSession} task={task} />
        ))}
      </ProjectQueueLane>
      <ProjectQueueLane
        activeTask={activeTask}
        count={lanes.complete.length}
        icon={<Archive className="h-4 w-4" />}
        laneId="complete"
        title="Done / Needs Attention"
      >
        {lanes.complete.map((task) =>
          canDragProjectQueueTask(task) ? (
            <DraggableProjectQueueTaskCard
              key={task.id}
              onOpenSession={onOpenSession}
              task={task}
            />
          ) : (
            <StaticProjectQueueTaskCard key={task.id} onOpenSession={onOpenSession} task={task} />
          )
        )}
      </ProjectQueueLane>
    </div>
  );
}
