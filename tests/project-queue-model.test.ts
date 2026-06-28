import { describe, expect, it } from 'vitest';
import {
  buildProjectQueueTasks,
  getProjectQueuePriorityLabel,
  groupProjectQueueTasks,
  sortProjectQueueTasksForTable,
} from '../src/modules/nightworkers/components/project-queue/projectQueueModel';
import type {
  ImplementationQueueDashboard,
  ImplementationQueueItem,
  Repository,
  Task,
  WorkbenchSessionView,
} from '../src/modules/nightworkers/types';

const project: Repository = {
  id: 'project-1',
  name: 'Project',
  localPath: '/tmp/project',
  branch: 'main',
  allowed: true,
  queueEnabled: true,
  maxConcurrentSessions: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};
const otherProject: Repository = { ...project, id: 'project-2', name: 'Other' };

describe('projectQueueModel', () => {
  it('deduplicates with executing precedence and orders table by production rank', () => {
    const sessions = [
      task('executing-task', 'Executing Session'),
      task('attention-task', 'Attention Session'),
      task('planned-a', 'Planned A'),
      task('planned-b', 'Planned B'),
      task('unclassified-task', 'Unclassified Session'),
    ];
    const dashboard: ImplementationQueueDashboard = {
      settings: { processorCount: 2 },
      processors: [{ slot: 2, entry: entry(sessions[0], 'processing', { processorSlot: 2 }) }],
      queued: [
        entry(sessions[0], 'queued', { queuePosition: 5 }),
        entry(sessions[2], 'queued', { queuePosition: 2 }),
        entry(sessions[3], 'queued', { queuePosition: 1 }),
      ],
      completed: [entry(sessions[1], 'failed'), entry(sessions[4], 'execution_archived')],
      notQueued: [{ task: sessions[4], repository: project }],
    };
    const tasks = buildProjectQueueTasks({
      project,
      sessions,
      sessionViews: [sessionView(sessions[1], 'review_needed')],
      implementationQueue: dashboard,
    });

    expect(tasks).toHaveLength(5);
    expect(tasks.find((item) => item.id === 'executing-task')?.status).toBe('executing');
    expect(sortProjectQueueTasksForTable(tasks).map((item) => item.id)).toEqual([
      'executing-task',
      'attention-task',
      'planned-b',
      'planned-a',
      'unclassified-task',
    ]);
  });

  it('groups planned by queuePosition and keeps queue priority empty outside Planned', () => {
    const sessions = [task('planned-a', 'A'), task('planned-b', 'B'), task('completed', 'Done')];
    const dashboard: ImplementationQueueDashboard = {
      settings: { processorCount: 1 },
      processors: [],
      queued: [
        entry(sessions[0], 'queued', { queuePosition: 2 }),
        entry(sessions[1], 'queued', { queuePosition: 1 }),
      ],
      completed: [entry(sessions[2], 'execution_archived', { queuePosition: 3 })],
      notQueued: [],
    };
    const tasks = buildProjectQueueTasks({
      project,
      sessions,
      sessionViews: [],
      implementationQueue: dashboard,
    });
    const lanes = groupProjectQueueTasks(tasks);

    expect(lanes.planned.map((item) => item.id)).toEqual(['planned-b', 'planned-a']);
    expect(getProjectQueuePriorityLabel(lanes.planned[0])).toBe('#1');
    expect(getProjectQueuePriorityLabel(lanes.complete[0])).toBe('');
  });

  it('maps done session views without queue entries to Completed', () => {
    const completedTask = { ...task('completed-session', 'Completed'), status: 'completed' };
    const tasks = buildProjectQueueTasks({
      project,
      sessions: [completedTask],
      sessionViews: [sessionView(completedTask, 'done')],
      implementationQueue: null,
    });

    expect(tasks).toMatchObject([{ id: 'completed-session', status: 'completed' }]);
    expect(groupProjectQueueTasks(tasks).complete.map((item) => item.id)).toEqual([
      'completed-session',
    ]);
  });

  it('marks only persistable attention rows as movable to Planned', () => {
    const reviewTask = task('review', 'Review');
    const failedTask = task('failed', 'Failed');
    const dashboard: ImplementationQueueDashboard = {
      settings: { processorCount: 1 },
      processors: [],
      queued: [],
      completed: [entry(reviewTask, 'awaiting_commit_decision'), entry(failedTask, 'failed')],
      notQueued: [],
    };
    const tasks = buildProjectQueueTasks({
      project,
      sessions: [reviewTask, failedTask],
      sessionViews: [],
      implementationQueue: dashboard,
    });

    expect(tasks.find((item) => item.id === 'review')).toMatchObject({
      status: 'attention',
      canMoveToPlanned: false,
    });
    expect(tasks.find((item) => item.id === 'failed')).toMatchObject({
      status: 'attention',
      canMoveToPlanned: true,
    });
  });

  it('keeps cancelled queue entries in Completed even when session state looks failed', () => {
    const cancelledTask = task('cancelled-entry', 'Cancelled');
    const dashboard: ImplementationQueueDashboard = {
      settings: { processorCount: 1 },
      processors: [],
      queued: [],
      completed: [entry(cancelledTask, 'cancelled')],
      notQueued: [],
    };
    const tasks = buildProjectQueueTasks({
      project,
      sessions: [cancelledTask],
      sessionViews: [sessionView(cancelledTask, 'failed')],
      implementationQueue: dashboard,
    });

    expect(tasks).toMatchObject([{ id: 'cancelled-entry', status: 'completed' }]);
  });

  it('does not synthesize rows for unrelated projects', () => {
    const ownTask = task('own', 'Own');
    const otherTask = { ...task('other', 'Other'), repositoryId: otherProject.id };
    const dashboard: ImplementationQueueDashboard = {
      settings: { processorCount: 1 },
      processors: [],
      queued: [entry(otherTask, 'queued', { repository: otherProject, queuePosition: 1 })],
      completed: [],
      notQueued: [],
    };

    expect(
      buildProjectQueueTasks({
        project,
        sessions: [ownTask],
        sessionViews: [],
        implementationQueue: dashboard,
      }).map((item) => item.id)
    ).toEqual(['own']);
  });
});

function task(id: string, title: string): Task {
  return {
    id,
    repositoryId: project.id,
    title,
    status: 'ready',
    timeoutSeconds: 3600,
    priority: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: `2026-01-01T00:0${id.length % 9}:00.000Z`,
  };
}

function entry(
  sourceTask: Task,
  status: ImplementationQueueItem['status'],
  options: Partial<ImplementationQueueItem> & { repository?: Repository } = {}
): ImplementationQueueItem {
  return {
    id: `entry-${sourceTask.id}`,
    taskId: sourceTask.id,
    repositoryId: sourceTask.repositoryId,
    status,
    priority: 0,
    queuePosition: null,
    processorSlot: null,
    activeRunId: null,
    statusReason: null,
    createdAt: sourceTask.createdAt,
    updatedAt: sourceTask.updatedAt,
    task: sourceTask,
    repository: options.repository || project,
    ...options,
  };
}

function sessionView(taskRecord: Task, emailState: WorkbenchSessionView['emailState']) {
  return {
    task: taskRecord,
    group: 'archive',
    emailState,
    phase: 'Reviewing',
  } as WorkbenchSessionView;
}
