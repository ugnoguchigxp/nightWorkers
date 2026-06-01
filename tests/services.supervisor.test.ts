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
    const result = await runSupervisorLoop({
      runId: 'run-1',
      repoRoot: dummyRepoRoot,
      prompt: 'Start',
      timeoutSeconds: 60,
    });

    // 4. Assertions
    expect(result.finalReport).toBe('Task complete');
    expect(result.terminalState).toBe('completed');
    expect(repo.createTaskEvent).toHaveBeenCalled();
    expect(repo.updateTaskRun).toHaveBeenCalledWith('run-1', {
      finalReport: 'Task complete',
      summary: 'Task complete',
      status: 'completed',
    });
    expect(repo.updateTaskStatus).toHaveBeenCalledWith('task-1', 'completed');
  });

  it('stops with needs_human after repeated missing toolCall decisions', async () => {
    const mockRun = { id: 'run-2', taskId: 'task-2' };
    const mockTask = {
      id: 'task-2',
      objective: 'Do task',
      acceptanceCriteria: 'Done',
    };

    vi.mocked(repo.getTaskRun).mockResolvedValue(mockRun as any);
    vi.mocked(repo.getTask).mockResolvedValue(mockTask as any);
    vi.mocked(repo.listTaskEventsForRun).mockResolvedValue([]);

    vi.mocked(llm.callSupervisorLLM)
      .mockResolvedValueOnce({
        phase: 'plan',
        instruction: 'analyze',
        rationale: 'r1',
        expectedEvidence: [],
        riskLevel: 'low',
        toolCall: null,
      })
      .mockResolvedValueOnce({
        phase: 'act',
        instruction: 'act',
        rationale: 'r2',
        expectedEvidence: [],
        riskLevel: 'low',
        toolCall: null,
      })
      .mockResolvedValueOnce({
        phase: 'plan',
        instruction: 'analyze',
        rationale: 'r3',
        expectedEvidence: [],
        riskLevel: 'low',
        toolCall: null,
      })
      .mockResolvedValueOnce({
        phase: 'act',
        instruction: 'act',
        rationale: 'r4',
        expectedEvidence: [],
        riskLevel: 'low',
        toolCall: null,
      })
      .mockResolvedValueOnce({
        phase: 'plan',
        instruction: 'analyze',
        rationale: 'r5',
        expectedEvidence: [],
        riskLevel: 'low',
        toolCall: null,
      })
      .mockResolvedValueOnce({
        phase: 'act',
        instruction: 'act',
        rationale: 'r6',
        expectedEvidence: [],
        riskLevel: 'low',
        toolCall: null,
      });

    const result = await runSupervisorLoop({
      runId: 'run-2',
      repoRoot: __dirname,
      prompt: 'Start',
      timeoutSeconds: 60,
    });

    expect(result.terminalState).toBe('needs_human');
    expect(result.stoppedBy).toBe('missing_tool_call');
  });
});
