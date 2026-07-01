import { describe, expect, it } from 'vitest';
import {
  buildProjectQueueTasks,
  getProjectQueuePriorityLabel,
  groupProjectQueueTasks,
  sortProjectQueueTasksForTable,
} from '../src/modules/queue/projectQueueModel';
import type {
  ProjectQueueDashboard,
  ProjectQueueEntry,
  ProjectQueueRepository,
  ProjectQueueSession,
  ProjectQueueSessionView,
} from '../src/modules/queue/projectQueueTypes';

const project: ProjectQueueRepository = {
  id: 'project-1',
  name: 'Project',
};
const otherProject: ProjectQueueRepository = { ...project, id: 'project-2', name: 'Other' };

describe('projectQueueModel', () => {
  it('deduplicates with executing precedence and orders table by production rank', () => {
    const sessions = [
      task('executing-task', 'Executing Session'),
      task('attention-task', 'Attention Session'),
      task('planned-a', 'Planned A'),
      task('planned-b', 'Planned B'),
      task('unclassified-task', 'Unclassified Session'),
    ];
    const dashboard: ProjectQueueDashboard = {
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
    const dashboard: ProjectQueueDashboard = {
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

  it('keeps review-needed and execution-completed work in Completed on the Kanban board', () => {
    const reviewTask = task('review-needed', 'Review Needed');
    const queueTask = task('queue-completed', 'Queue Completed');
    const dashboard: ProjectQueueDashboard = {
      settings: { processorCount: 1 },
      processors: [],
      queued: [],
      completed: [entry(queueTask, 'execution_completed')],
      notQueued: [],
    };
    const tasks = buildProjectQueueTasks({
      project,
      sessions: [reviewTask, queueTask],
      sessionViews: [sessionView(reviewTask, 'review_needed')],
      implementationQueue: dashboard,
    });

    expect(tasks.find((item) => item.id === 'review-needed')).toMatchObject({
      status: 'completed',
    });
    expect(tasks.find((item) => item.id === 'queue-completed')).toMatchObject({
      status: 'completed',
      queueEntryStatus: 'execution_completed',
    });
    expect(groupProjectQueueTasks(tasks).complete.map((item) => item.id)).toEqual([
      'queue-completed',
      'review-needed',
    ]);
  });

  it('marks only persistable attention rows as movable to Planned', () => {
    const reviewTask = task('review', 'Review');
    const failedTask = task('failed', 'Failed');
    const dashboard: ProjectQueueDashboard = {
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
    const dashboard: ProjectQueueDashboard = {
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

  it('shows project evaluation tasks without plan evidence as Needs Plan', () => {
    const evaluationTask = {
      ...task('evaluation-task', 'Evaluation Improvement'),
      createdBy: 'project-evaluation',
    };
    const planReadyEvaluationTask = {
      ...task('plan-ready-evaluation-task', 'Plan Ready Evaluation Improvement'),
      createdBy: 'project-evaluation',
    };
    const tasks = buildProjectQueueTasks({
      project,
      sessions: [evaluationTask, planReadyEvaluationTask],
      sessionViews: [sessionView(planReadyEvaluationTask, 'plan_ready')],
      implementationQueue: null,
    });
    const lanes = groupProjectQueueTasks(tasks);

    expect(tasks.find((item) => item.id === 'evaluation-task')).toMatchObject({
      status: 'needs_plan',
      phase: 'Needs Plan',
    });
    expect(tasks.find((item) => item.id === 'plan-ready-evaluation-task')?.status).toBe(
      'unclassified'
    );
    expect(lanes.unclassified.map((item) => item.id)).toEqual(
      expect.arrayContaining(['evaluation-task', 'plan-ready-evaluation-task'])
    );
  });

  it('does not synthesize rows for unrelated projects', () => {
    const ownTask = task('own', 'Own');
    const otherTask = { ...task('other', 'Other'), repositoryId: otherProject.id };
    const dashboard: ProjectQueueDashboard = {
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

function task(id: string, title: string): ProjectQueueSession {
  return {
    id,
    repositoryId: project.id,
    title,
    status: 'ready',
    updatedAt: `2026-01-01T00:0${id.length % 9}:00.000Z`,
  };
}

function entry(
  sourceTask: ProjectQueueSession,
  status: ProjectQueueEntry['status'],
  options: Partial<ProjectQueueEntry> & { repository?: ProjectQueueRepository } = {}
): ProjectQueueEntry {
  return {
    id: `entry-${sourceTask.id}`,
    taskId: sourceTask.id,
    repositoryId: sourceTask.repositoryId,
    status,
    queuePosition: null,
    processorSlot: null,
    activeRunId: null,
    statusReason: null,
    updatedAt: sourceTask.updatedAt,
    task: sourceTask,
    repository: options.repository || project,
    ...options,
  };
}

function sessionView(
  taskRecord: ProjectQueueSession,
  emailState: ProjectQueueSessionView['emailState']
) {
  return {
    task: taskRecord,
    emailState,
    phase: 'Reviewing',
  } as ProjectQueueSessionView;
}
