import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as queueService from '../api/modules/nightworkers/nightworkers.queue-management.service';
import * as repo from '../api/modules/nightworkers/nightworkers.repository';
import * as orchestration from '../api/modules/nightworkers/nightworkers.run-orchestration.service';

vi.mock('../api/modules/nightworkers/nightworkers.repository', () => ({
  getTask: vi.fn(),
  listTaskMessages: vi.fn(),
  hasActiveImplementationQueueEntry: vi.fn(),
  updateTask: vi.fn(),
  createImplementationQueueEntry: vi.fn(),
  createTaskMessage: vi.fn(),
}));

vi.mock('../api/modules/nightworkers/nightworkers.planning-helpers.service', () => ({
  assertTaskDraftComplete: vi.fn(),
  getTaskDraftMissingFields: vi.fn(() => []),
  hasImplementationPlanEvidence: vi.fn(() => true),
}));

vi.mock('../api/modules/nightworkers/nightworkers.run-orchestration.service', () => ({
  runImplementationQueue: vi.fn(async () => []),
}));

const task = {
  id: 'task-1',
  repositoryId: 'repo-1',
  status: 'ready',
  priority: 3,
};

const queuedTask = {
  ...task,
  status: 'queued',
};

const queueEntry = {
  id: 'entry-1',
  taskId: task.id,
  repositoryId: task.repositoryId,
  status: 'queued',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(repo.getTask).mockResolvedValue(task as never);
  vi.mocked(repo.listTaskMessages).mockResolvedValue([{ id: 'message-1' }] as never);
  vi.mocked(repo.hasActiveImplementationQueueEntry).mockResolvedValue(false);
  vi.mocked(repo.updateTask).mockResolvedValue(queuedTask as never);
  vi.mocked(repo.createImplementationQueueEntry).mockResolvedValue(queueEntry as never);
  vi.mocked(repo.createTaskMessage).mockResolvedValue({ id: 'message-2' } as never);
});

describe('NightWorkers queue management side effects', () => {
  it('does not auto-drain when createImplementationQueueEntry receives autoDrain false', async () => {
    const entry = await queueService.createImplementationQueueEntry(task.id, { autoDrain: false });

    expect(entry).toBe(queueEntry);
    expect(orchestration.runImplementationQueue).not.toHaveBeenCalled();
  });

  it('auto-drains by default when createImplementationQueueEntry succeeds', async () => {
    await queueService.createImplementationQueueEntry(task.id);

    expect(orchestration.runImplementationQueue).toHaveBeenCalledTimes(1);
  });
});
