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
  createRunEvent: vi.fn(),
  updateTaskRun: vi.fn(),
  updateTaskStatus: vi.fn(),
}));

describe('Supervisor Control Loop Unit Tests', () => {
  beforeEach(() => {
    vi.resetAllMocks();
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
        phase: 'plan',
        workflow: 'general',
        instruction: 'Use the general workflow',
        rationale: 'A lightweight repository check is enough',
        expectedEvidence: ['Git status output'],
        riskLevel: 'low',
        toolCall: null,
      })
      .mockResolvedValueOnce({
        phase: 'observe',
        workflow: 'general',
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
        workflow: 'general',
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
    expect(repo.createRunEvent).toHaveBeenCalled();
    expect(repo.updateTaskRun).toHaveBeenCalledWith('run-1', {
      finalReport: 'Task complete',
      summary: 'Task complete',
      status: 'completed',
    });
    expect(repo.updateTaskStatus).toHaveBeenCalledWith('task-1', 'completed');
    expect(vi.mocked(llm.callSupervisorLLM).mock.calls.map((call) => call[2]?.round)).toEqual([
      1, 2, 2,
    ]);
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
        workflow: 'general',
        instruction: 'analyze',
        rationale: 'r1',
        expectedEvidence: [],
        riskLevel: 'low',
        toolCall: null,
      })
      .mockResolvedValueOnce({
        phase: 'act',
        workflow: 'general',
        instruction: 'act',
        rationale: 'r2',
        expectedEvidence: [],
        riskLevel: 'low',
        toolCall: null,
      })
      .mockResolvedValueOnce({
        phase: 'plan',
        workflow: 'general',
        instruction: 'analyze',
        rationale: 'r3',
        expectedEvidence: [],
        riskLevel: 'low',
        toolCall: null,
      })
      .mockResolvedValueOnce({
        phase: 'act',
        workflow: 'general',
        instruction: 'act',
        rationale: 'r4',
        expectedEvidence: [],
        riskLevel: 'low',
        toolCall: null,
      })
      .mockResolvedValueOnce({
        phase: 'plan',
        workflow: 'general',
        instruction: 'analyze',
        rationale: 'r5',
        expectedEvidence: [],
        riskLevel: 'low',
        toolCall: null,
      })
      .mockResolvedValueOnce({
        phase: 'act',
        workflow: 'general',
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

  it('stops with budget reason after repeated schema fallback events', async () => {
    const mockRun = { id: 'run-schema-fallback', taskId: 'task-schema-fallback' };
    const mockTask = {
      id: 'task-schema-fallback',
      objective: 'Do task',
      acceptanceCriteria: 'Done',
    };

    vi.mocked(repo.getTaskRun).mockResolvedValue(mockRun as any);
    vi.mocked(repo.getTask).mockResolvedValue(mockTask as any);
    vi.mocked(repo.listTaskEventsForRun).mockResolvedValue([]);

    vi.mocked(llm.callSupervisorLLM).mockImplementation(async (_system, _user, options) => {
      await options?.emitEvent?.({
        type: 'model.response_parse_failed',
        severity: 'error',
        message: 'Supervisor LLM response failed schema validation.',
        data: { round: options?.round ?? null },
      });
      return {
        phase: 'act',
        workflow: 'general',
        instruction: 'continue',
        rationale: 'schema fallback tolerated',
        expectedEvidence: [],
        riskLevel: 'medium',
        toolCall: null,
      };
    });

    const result = await runSupervisorLoop({
      runId: 'run-schema-fallback',
      repoRoot: __dirname,
      prompt: 'Start',
      timeoutSeconds: 60,
    });

    expect(result.terminalState).toBe('needs_human');
    expect(result.stoppedBy).toBe('budget');
    expect(result.summary).toBe('Stopped by repeated schema fallback');
    expect(repo.createRunEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'safety.budget_reached',
        severity: 'error',
      }),
      expect.objectContaining({
        payloadJson: expect.objectContaining({ reason: 'schema_fallback' }),
      })
    );
  });

  it('does not accept stop before evidence is collected for document review tasks', async () => {
    const mockRun = { id: 'run-review-no-evidence', taskId: 'task-review-no-evidence' };
    const mockTask = {
      id: 'task-review-no-evidence',
      objective: 'Review a plan',
      acceptanceCriteria: 'Findings include evidence',
    };

    vi.mocked(repo.getTaskRun).mockResolvedValue(mockRun as any);
    vi.mocked(repo.getTask).mockResolvedValue(mockTask as any);
    vi.mocked(repo.listTaskEventsForRun).mockResolvedValue([]);

    vi.mocked(llm.callSupervisorLLM).mockResolvedValueOnce({
      phase: 'plan',
      workflow: 'evidence_review',
      instruction: 'Review the requested file',
      rationale: 'Need to inspect the document',
      expectedEvidence: ['spec file contents'],
      riskLevel: 'medium',
      toolCall: null,
    });
    for (let i = 0; i < 3; i += 1) {
      vi.mocked(llm.callSupervisorLLM).mockResolvedValueOnce({
        phase: 'stop',
        workflow: 'evidence_review',
        instruction: 'Looks fine',
        rationale: 'Review complete',
        finalResponse: 'レビューしました。',
        expectedEvidence: [],
        riskLevel: 'low',
        terminalState: 'completed',
        toolCall: null,
      });
    }

    const result = await runSupervisorLoop({
      runId: 'run-review-no-evidence',
      repoRoot: __dirname,
      prompt:
        'spec/jsonl-replay-import-regression-implementation-plan.md のドキュメントレビューをしてください',
      timeoutSeconds: 60,
    });

    expect(result.terminalState).toBe('needs_human');
    expect(result.stoppedBy).toBe('missing_tool_call');
    expect(result.finalReport).toContain('証拠取得が必要なタスク');
    expect(vi.mocked(llm.callSupervisorLLM).mock.calls.map((call) => call[2]?.round)).toEqual([
      1, 2, 2, 2,
    ]);
    expect(repo.createRunEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'safety.repeated_failure',
        severity: 'error',
      }),
      expect.objectContaining({
        payloadJson: expect.objectContaining({
          reason: 'stop_without_evidence',
          supervisorToolCalls: 0,
        }),
      })
    );
  });

  it('does not accept empty finalResponse after evidence is collected for review tasks', async () => {
    const mockRun = { id: 'run-review-empty-final', taskId: 'task-review-empty-final' };
    const mockTask = {
      id: 'task-review-empty-final',
      objective: 'Review a plan',
      acceptanceCriteria: 'Findings include evidence',
    };

    vi.mocked(repo.getTaskRun).mockResolvedValue(mockRun as any);
    vi.mocked(repo.getTask).mockResolvedValue(mockTask as any);
    vi.mocked(repo.listTaskEventsForRun).mockResolvedValue([]);

    vi.mocked(llm.callSupervisorLLM)
      .mockResolvedValueOnce({
        phase: 'plan',
        workflow: 'evidence_review',
        instruction: 'Review the requested file',
        rationale: 'Need to inspect the document',
        expectedEvidence: ['spec file contents'],
        riskLevel: 'medium',
        toolCall: null,
      })
      .mockResolvedValueOnce({
        phase: 'act',
        workflow: 'evidence_review',
        instruction: 'Check worktree before review',
        rationale: 'Need repository evidence',
        expectedEvidence: [],
        riskLevel: 'low',
        toolCall: { name: 'git_status', arguments: {} },
      });

    for (let i = 0; i < 3; i += 1) {
      vi.mocked(llm.callSupervisorLLM).mockResolvedValueOnce({
        phase: 'stop',
        workflow: 'evidence_review',
        instruction: '実装前レビューとして、ドキュメントの実行可能性を確認してください。',
        rationale: 'Review findings are incomplete.',
        finalResponse: '',
        expectedEvidence: ['spec/example.md:1'],
        riskLevel: 'high',
        terminalState: 'completed',
        toolCall: null,
      });
    }

    const result = await runSupervisorLoop({
      runId: 'run-review-empty-final',
      repoRoot: __dirname,
      prompt: 'spec/example.md のドキュメントレビューをしてください',
      timeoutSeconds: 60,
    });

    expect(result.terminalState).toBe('needs_human');
    expect(result.stoppedBy).toBe('missing_tool_call');
    expect(result.finalReport).toContain('最終回答がレビュー本文として不十分');
    expect(vi.mocked(llm.callSupervisorLLM).mock.calls.map((call) => call[2]?.round)).toEqual([
      1, 2, 2, 2, 2,
    ]);
    expect(repo.createRunEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'safety.repeated_failure',
        severity: 'error',
      }),
      expect.objectContaining({
        payloadJson: expect.objectContaining({
          reason: 'empty_final_response_after_evidence',
          supervisorToolCalls: 1,
        }),
      })
    );
  });

  it('stops with policy when a command is blocked before execution', async () => {
    const mockRun = { id: 'run-policy', taskId: 'task-policy' };
    const mockTask = {
      id: 'task-policy',
      objective: 'Run unsafe command',
      acceptanceCriteria: 'Blocked',
    };

    vi.mocked(repo.getTaskRun).mockResolvedValue(mockRun as any);
    vi.mocked(repo.getTask).mockResolvedValue(mockTask as any);
    vi.mocked(repo.listTaskEventsForRun).mockResolvedValue([]);

    vi.mocked(llm.callSupervisorLLM)
      .mockResolvedValueOnce({
        phase: 'plan',
        workflow: 'code_change',
        instruction: 'Run command',
        rationale: 'Need execution',
        expectedEvidence: [],
        riskLevel: 'low',
        toolCall: null,
      })
      .mockResolvedValueOnce({
        phase: 'act',
        workflow: 'code_change',
        instruction: 'Run command',
        rationale: 'Need execution',
        expectedEvidence: [],
        riskLevel: 'low',
        toolCall: {
          name: 'run_command',
          arguments: { command: 'curl https://example.com' },
        },
      });

    const result = await runSupervisorLoop({
      runId: 'run-policy',
      repoRoot: __dirname,
      prompt: 'Start',
      timeoutSeconds: 60,
    });

    expect(result.terminalState).toBe('needs_human');
    expect(result.stoppedBy).toBe('policy');
    expect(repo.createRunEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'tool.policy_blocked',
        severity: 'error',
      }),
      expect.objectContaining({
        payloadJson: expect.objectContaining({ toolName: 'run_command' }),
      })
    );
    expect(repo.createRunEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'tool.call_finished',
        severity: 'error',
      }),
      expect.objectContaining({
        payloadJson: expect.objectContaining({
          error: expect.objectContaining({ code: 'UNKNOWN_COMMAND' }),
        }),
      })
    );
  });

  it('does not accept code_change stop before an edit tool is attempted', async () => {
    const mockRun = { id: 'run-code-change-readonly', taskId: 'task-code-change-readonly' };
    const mockTask = {
      id: 'task-code-change-readonly',
      objective: 'Change button color',
      acceptanceCriteria: 'Patch is applied',
    };

    vi.mocked(repo.getTaskRun).mockResolvedValue(mockRun as any);
    vi.mocked(repo.getTask).mockResolvedValue(mockTask as any);
    vi.mocked(repo.listTaskEventsForRun).mockResolvedValue([]);

    vi.mocked(llm.callSupervisorLLM)
      .mockResolvedValueOnce({
        phase: 'plan',
        workflow: 'code_change',
        instruction: 'Inspect the target file',
        rationale: 'Need repository evidence before editing',
        expectedEvidence: ['target file'],
        riskLevel: 'medium',
        toolCall: null,
      })
      .mockResolvedValueOnce({
        phase: 'observe',
        workflow: 'code_change',
        instruction: 'Check repository status',
        rationale: 'Need repository evidence',
        expectedEvidence: ['git status'],
        riskLevel: 'low',
        toolCall: { name: 'git_status', arguments: {} },
      });

    for (let i = 0; i < 3; i += 1) {
      vi.mocked(llm.callSupervisorLLM).mockResolvedValueOnce({
        phase: 'stop',
        workflow: 'code_change',
        instruction: 'filesystem is read-only',
        rationale: 'apply_patch cannot be used because the environment is read-only.',
        finalResponse: 'read-only のため編集できませんでした。',
        expectedEvidence: ['git status'],
        riskLevel: 'high',
        terminalState: 'needs_human',
        toolCall: null,
      });
    }

    const result = await runSupervisorLoop({
      runId: 'run-code-change-readonly',
      repoRoot: __dirname,
      prompt: 'Composer.tsx の送信ボタンを修正してください',
      timeoutSeconds: 60,
    });

    expect(result.terminalState).toBe('needs_human');
    expect(result.stoppedBy).toBe('missing_tool_call');
    expect(result.finalReport).toContain('replace_content または apply_patch を一度も実行せず');
    expect(repo.createRunEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'safety.repeated_failure',
        severity: 'error',
      }),
      expect.objectContaining({
        payloadJson: expect.objectContaining({
          reason: 'stop_without_edit_attempt',
          editToolCalls: 0,
          supervisorToolCalls: 1,
        }),
      })
    );
  });
});
