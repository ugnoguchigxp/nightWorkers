import { arrayMove } from '@dnd-kit/sortable';
import type { ProjectQueueLaneId, ProjectQueueTask } from './projectQueueTypes';

export const PROJECT_QUEUE_LANE_IDS: Record<ProjectQueueLaneId, string> = {
  unclassified: 'project-queue-lane-unclassified',
  planned: 'project-queue-lane-planned',
  executing: 'project-queue-lane-executing',
  complete: 'project-queue-lane-complete',
};

const PROJECT_QUEUE_LANE_ID_SET = new Set(Object.values(PROJECT_QUEUE_LANE_IDS));

export function isProjectQueueLaneDomId(id: string) {
  return PROJECT_QUEUE_LANE_ID_SET.has(id);
}

export function canDragProjectQueueTask(task: ProjectQueueTask) {
  return task.status === 'planned' || (task.status === 'attention' && task.canMoveToPlanned);
}

export function canDropTaskOnLane(task: ProjectQueueTask | null, laneId: ProjectQueueLaneId) {
  if (!task) return false;
  if (laneId !== 'planned') return false;
  return canDragProjectQueueTask(task);
}

export function buildPlannedReorderUpdates(
  tasks: ProjectQueueTask[],
  activeTaskId: string,
  overTaskId: string
) {
  const planned = tasks.filter((task) => task.status === 'planned');
  const oldIndex = planned.findIndex((task) => task.id === activeTaskId);
  const newIndex = planned.findIndex((task) => task.id === overTaskId);
  if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return [];

  return arrayMove(planned, oldIndex, newIndex)
    .map((task, index) => ({ task, queuePosition: index + 1 }))
    .filter(({ task, queuePosition }) => task.queueEntryId && task.queuePosition !== queuePosition)
    .map(({ task, queuePosition }) => ({
      entryId: task.queueEntryId as string,
      queuePosition,
    }));
}

export function isAttentionToPlannedMove(
  activeTask: ProjectQueueTask | null,
  overId: string | null,
  overTask: ProjectQueueTask | null
) {
  if (!activeTask || activeTask.status !== 'attention' || !activeTask.canMoveToPlanned) {
    return false;
  }
  if (overId === PROJECT_QUEUE_LANE_IDS.planned) return true;
  return overTask?.status === 'planned';
}
