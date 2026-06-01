import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as repo from '../api/modules/nightworkers/nightworkers.repository';
import * as llm from '../api/services/supervisor/llm-provider';
import { runSupervisorLoop } from '../api/services/supervisor/supervisor-loop';

vi.mock('../api/services/supervisor/llm-provider', () => ({
  callSupervisorLLM: vi.fn(),
}));

vi.mock('../api/modules/nightworkers/nightworkers.repository', () => ({
  getTaskRun: vi.fn(),
  getTask: vi.fn(),
  listTaskEventsForRun: vi.fn(),
  createTaskEvent: vi.fn(),
  updateTaskRun: vi.fn(),
  updateTaskStatus: vi.fn(),
}));

describe('Supervisor Control Loop Unit Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runs supervisor loop through observe, execute, and stop sequences', async () => {
    // 1. Setup DB mocks
    const mockRun = { id: 'run-1', taskId: 'task-1' };
    const mockTask = {
      id: 'task-1',
      objective: 'Add comment',
      acceptanceCriteria: 'Done',
    };

    vi.mocked(repo.getTaskRun).mockResolvedValue(mockRun as any);
    vi.mocked(repo.getTask).mockResolvedValue(mockTask as any);
    vi.mocked(repo.listTaskEventsForRun).mockResolvedValue([]);

    // 2. Setup LLM mocks
    // First iteration: worker calls git_status
    // Second iteration: stop execution
    vi.mocked(llm.callSupervisorLLM)
      .mockResolvedValueOnce({
        phase: 'observe',
        instruction: 'Check repository status',
        rationale: 'Observe current state',
        expectedEvidence: ['Git status output'],
        riskLevel: 'low',
        toolCall: {
          name: 'git_status',
          arguments: {},
        },
      })
      .mockResolvedValueOnce({
        phase: 'stop',
        instruction: 'Task complete',
        rationale: 'Verification succeeded',
        expectedEvidence: [],
        riskLevel: 'low',
        terminalState: 'completed',
      });

    // 3. Trigger supervisor loop execution
    const dummyRepoRoot = __dirname;
    const finalReport = await runSupervisorLoop({
      runId: 'run-1',
      repoRoot: dummyRepoRoot,
      prompt: 'Start',
      timeoutSeconds: 60,
    });

    // 4. Assertions
    expect(finalReport).toBe('Task complete');
    expect(repo.createTaskEvent).toHaveBeenCalled();
    expect(repo.updateTaskRun).toHaveBeenCalledWith('run-1', {
      finalReport: 'Task complete',
      summary: 'Task complete',
      status: 'completed',
    });
    expect(repo.updateTaskStatus).toHaveBeenCalledWith('task-1', 'completed');
  });
});
