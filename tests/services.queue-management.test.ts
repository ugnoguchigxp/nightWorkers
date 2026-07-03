import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as queueService from '../api/modules/nightworkers/nightworkers.queue-management.service';
import * as repo from '../api/modules/nightworkers/nightworkers.repository';
import * as queueRepo from '../api/modules/queue/queue.repository';
import * as queueSchedulerPort from '../api/modules/queue/queue-scheduler-port';

vi.mock('../api/modules/nightworkers/nightworkers.repository', () => ({
  getTask: vi.fn(),
  listTaskMessages: vi.fn(),
  updateTask: vi.fn(),
  createTaskMessage: vi.fn(),
}));

vi.mock('../api/modules/queue/queue.repository', () => ({
  hasActiveImplementationQueueEntry: vi.fn(),
  createImplementationQueueEntry: vi.fn(),
}));

vi.mock('../api/modules/nightworkers/nightworkers.planning-helpers.service', () => ({
  assertTaskDraftComplete: vi.fn(),
  getTaskDraftMissingFields: vi.fn(() => []),
  hasImplementationPlanEvidence: vi.fn(() => true),
}));

vi.mock('../api/modules/queue/queue-scheduler-port', () => ({
  triggerConfiguredQueueDrain: vi.fn(),
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
  vi.mocked(queueRepo.hasActiveImplementationQueueEntry).mockResolvedValue(false);
  vi.mocked(repo.updateTask).mockResolvedValue(queuedTask as never);
  vi.mocked(queueRepo.createImplementationQueueEntry).mockResolvedValue(queueEntry as never);
  vi.mocked(repo.createTaskMessage).mockResolvedValue({ id: 'message-2' } as never);
});

describe('NightWorkers queue management side effects', () => {
  it('does not auto-drain when createImplementationQueueEntry receives autoDrain false', async () => {
    const entry = await queueService.createImplementationQueueEntry(task.id, { autoDrain: false });

    expect(entry).toBe(queueEntry);
    expect(queueSchedulerPort.triggerConfiguredQueueDrain).not.toHaveBeenCalled();
  });

  it('auto-drains by default when createImplementationQueueEntry succeeds', async () => {
    await queueService.createImplementationQueueEntry(task.id);

    expect(queueSchedulerPort.triggerConfiguredQueueDrain).toHaveBeenCalledTimes(1);
  });

  it('downgrades incomplete sequence scheduling metadata to exclusive enqueue scheduling', async () => {
    vi.mocked(repo.listTaskMessages).mockResolvedValue([
      {
        id: 'message-1',
        metadataJson: {
          intakeJobSelection: {
            jobType: 'major_code_edit',
            scheduling: {
              executionType: 'sequence',
              reason: 'Requires ordered work',
              sequenceGroupId: null,
              sequenceOrder: null,
              dependsOnTaskIds: null,
            },
          },
        },
      },
    ] as never);

    await queueService.createImplementationQueueEntry(task.id, { autoDrain: false });

    expect(queueRepo.createImplementationQueueEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        executionType: 'exclusive',
        sequenceGroupId: null,
        sequenceOrder: null,
        schedulingReason: expect.stringContaining('sequence metadata missing'),
      })
    );
  });
});
