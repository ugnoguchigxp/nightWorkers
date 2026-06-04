import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
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
      currentTodo: {
        id: 'todo-1',
        seq: 1,
        title: 'Implement feature',
        description: 'Detailed work',
        taskType: 'code_change',
        status: 'running',
        procedureId: 'code-change',
        procedureDigest: 'sha256:procedure',
        contextDigest: 'context-digest',
      },
      todoPlan: [
        {
          id: 'todo-1',
          seq: 1,
          title: 'Implement feature',
          description: 'Detailed work',
          taskType: 'code_change',
          status: 'pending',
          procedureId: 'code-change',
          procedureDigest: 'sha256:procedure',
          contextDigest: 'context-digest',
        },
      ],
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
    const firstRound2Input = JSON.parse(String(vi.mocked(llm.callSupervisorLLM).mock.calls[1][1]));
    expect(firstRound2Input.todoPlan).toEqual([
      expect.objectContaining({
        id: 'todo-1',
        seq: 1,
        title: 'Implement feature',
        taskType: 'code_change',
        procedureId: 'code-change',
        procedureDigest: 'sha256:procedure',
        contextDigest: 'context-digest',
      }),
    ]);
    expect(repo.createRunEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'supervisor.decision',
        data: expect.objectContaining({
          todoId: 'todo-1',
          todoSeq: 1,
          procedureId: 'code-change',
        }),
      }),
      expect.anything()
    );
    expect(repo.createRunEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'tool.call_started',
        data: expect.objectContaining({
          todoId: 'todo-1',
          todoSeq: 1,
          procedureId: 'code-change',
        }),
      }),
      expect.anything()
    );
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

  it('does not accept a round 1 code_change stop as an execution result', async () => {
    const mockRun = { id: 'run-code-change-round1-stop', taskId: 'task-code-change-round1-stop' };
    const mockTask = {
      id: 'task-code-change-round1-stop',
      objective: 'Create fizzbuzz.ts',
      acceptanceCriteria: 'File is created',
    };

    vi.mocked(repo.getTaskRun).mockResolvedValue(mockRun as any);
    vi.mocked(repo.getTask).mockResolvedValue(mockTask as any);
    vi.mocked(repo.listTaskEventsForRun).mockResolvedValue([]);

    for (let i = 0; i < 4; i += 1) {
      vi.mocked(llm.callSupervisorLLM).mockResolvedValueOnce({
        phase: 'stop',
        workflow: 'code_change',
        routingHypothesis: {
          primaryMode: 'code_edit',
          secondaryModes: [],
          phase: 'execute',
          workKinds: ['code'],
          overlays: [],
          requiredEvidence: ['fizzbuzz.ts exists'],
          nextSkillFiles: [],
          confidence: 0.95,
        },
        instruction: 'Cannot create the file.',
        rationale: 'Claims apply_patch was rejected, but no tool was called.',
        finalResponse: '書き込み不可のため作成できませんでした。',
        expectedEvidence: ['apply_patch result'],
        riskLevel: 'high',
        terminalState: 'needs_human',
        toolCall: null,
      });
    }

    const result = await runSupervisorLoop({
      runId: 'run-code-change-round1-stop',
      repoRoot: '/repo/project',
      prompt: 'fizzbuzz.tsをプロジェクトルートに作ってください',
      timeoutSeconds: 60,
    });

    expect(result.terminalState).toBe('needs_human');
    expect(result.finalReport).toContain('replace_content または apply_patch を一度も実行せず');
    expect(vi.mocked(llm.callSupervisorLLM).mock.calls.map((call) => call[2]?.round)).toEqual([
      1, 2, 2, 2,
    ]);
    expect(
      vi.mocked(llm.callSupervisorLLM).mock.calls.map((call) => call[2]?.workingDirectory)
    ).toEqual(['/repo/project', '/repo/project', '/repo/project', '/repo/project']);
    expect(repo.createRunEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'safety.repeated_failure',
        severity: 'error',
      }),
      expect.objectContaining({
        payloadJson: expect.objectContaining({
          reason: 'stop_without_edit_attempt',
          editToolCalls: 0,
        }),
      })
    );
  });

  it('does not accept a code_change report before an edit tool is attempted', async () => {
    const mockRun = { id: 'run-code-change-report-no-edit', taskId: 'task-code-change-report' };
    const mockTask = {
      id: 'task-code-change-report',
      objective: 'Create fizzbuzz.ts',
      acceptanceCriteria: 'File is created',
    };

    vi.mocked(repo.getTaskRun).mockResolvedValue(mockRun as any);
    vi.mocked(repo.getTask).mockResolvedValue(mockTask as any);
    vi.mocked(repo.listTaskEventsForRun).mockResolvedValue([]);

    vi.mocked(llm.callSupervisorLLM).mockResolvedValueOnce({
      phase: 'plan',
      workflow: 'code_change',
      routingHypothesis: {
        primaryMode: 'code_edit',
        secondaryModes: [],
        phase: 'execute',
        workKinds: ['code'],
        overlays: [],
        requiredEvidence: ['fizzbuzz.ts exists'],
        nextSkillFiles: [],
        confidence: 0.95,
      },
      instruction: 'Create fizzbuzz.ts.',
      rationale: 'A file edit is required.',
      finalResponse: '',
      expectedEvidence: ['fizzbuzz.ts exists'],
      riskLevel: 'low',
      toolCall: null,
    });

    for (let i = 0; i < 3; i += 1) {
      vi.mocked(llm.callSupervisorLLM).mockResolvedValueOnce({
        phase: 'report',
        workflow: 'code_change',
        routingHypothesis: {
          primaryMode: 'code_edit',
          secondaryModes: [],
          phase: 'summarize',
          workKinds: ['code'],
          overlays: [],
          requiredEvidence: ['fizzbuzz.ts exists'],
          nextSkillFiles: [],
          confidence: 0.95,
        },
        instruction: 'Report the file as created.',
        rationale: 'Claims completion without worker edit evidence.',
        finalResponse: 'fizzbuzz.ts を作成しました。',
        expectedEvidence: ['fizzbuzz.ts exists'],
        riskLevel: 'low',
        toolCall: null,
      });
    }

    const result = await runSupervisorLoop({
      runId: 'run-code-change-report-no-edit',
      repoRoot: '/repo/project',
      prompt: 'fizzbuzz.tsをプロジェクトルートに作ってください',
      timeoutSeconds: 60,
    });

    expect(result.terminalState).toBe('needs_human');
    expect(result.stoppedBy).toBe('missing_tool_call');
    expect(result.finalReport).toContain('report/stop を繰り返したため停止');
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
          reason: 'report_without_edit_attempt',
          editToolCalls: 0,
        }),
      })
    );
  });

  it('reads back edited files immediately and passes that result as code_change evidence', async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'nightworkers-readback-'));
    await fs.mkdir(path.join(repoRoot, 'src'), { recursive: true });
    await fs.writeFile(path.join(repoRoot, 'src/greeting.txt'), 'hello before\n', 'utf-8');

    const mockRun = { id: 'run-code-change-readback', taskId: 'task-code-change-readback' };
    const mockTask = {
      id: 'task-code-change-readback',
      objective: 'Update greeting',
      acceptanceCriteria: 'File contains updated greeting',
    };

    vi.mocked(repo.getTaskRun).mockResolvedValue(mockRun as any);
    vi.mocked(repo.getTask).mockResolvedValue(mockTask as any);
    vi.mocked(repo.listTaskEventsForRun).mockResolvedValue([]);

    vi.mocked(llm.callSupervisorLLM)
      .mockResolvedValueOnce({
        phase: 'plan',
        workflow: 'code_change',
        instruction: 'Use code edit workflow.',
        rationale: 'The user requested a file edit.',
        finalResponse: '',
        expectedEvidence: ['src/greeting.txt'],
        riskLevel: 'low',
        toolCall: null,
      })
      .mockResolvedValueOnce({
        phase: 'observe',
        workflow: 'code_change',
        instruction: 'Read the target file.',
        rationale: 'Existing content is required before editing.',
        finalResponse: '',
        expectedEvidence: ['src/greeting.txt contents'],
        riskLevel: 'low',
        toolCall: { name: 'read_file', arguments: { filePath: 'src/greeting.txt' } },
      })
      .mockResolvedValueOnce({
        phase: 'act',
        workflow: 'code_change',
        instruction: 'Replace the greeting.',
        rationale: 'The target content has been read.',
        finalResponse: '',
        expectedEvidence: ['replace_content result', 'post-edit readback'],
        riskLevel: 'low',
        toolCall: {
          name: 'replace_content',
          arguments: {
            filePath: 'src/greeting.txt',
            needle: 'hello before',
            replacement: 'hello after',
            mode: 'literal',
          },
        },
      })
      .mockResolvedValueOnce({
        phase: 'stop',
        workflow: 'code_change',
        instruction: 'Report the completed edit.',
        rationale: 'replace_content and post-edit readback evidence are present.',
        finalResponse:
          'src/greeting.txt を更新し、replace_content の成功結果と post-edit readback の read_file 結果で hello after が反映されていることを確認しました。追加の検証コマンドは不要な単純テキスト変更です。',
        expectedEvidence: ['replace_content result', 'post-edit readback read_file'],
        riskLevel: 'low',
        terminalState: 'completed',
        toolCall: null,
      });

    try {
      const result = await runSupervisorLoop({
        runId: 'run-code-change-readback',
        repoRoot,
        prompt: 'src/greeting.txt の greeting を更新してください',
        timeoutSeconds: 60,
      });

      expect(result.terminalState).toBe('completed');
      expect(await fs.readFile(path.join(repoRoot, 'src/greeting.txt'), 'utf-8')).toContain(
        'hello after'
      );
      const finalRoundInput = JSON.parse(String(vi.mocked(llm.callSupervisorLLM).mock.calls[3][1]));
      expect(finalRoundInput.observations.join('\n')).toContain('[Post-edit readback]');
      expect(finalRoundInput.observations.join('\n')).toContain('tool=read_file status=ok');
      expect(finalRoundInput.observations.join('\n')).toContain('hello after');
      expect(repo.createRunEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'tool.call_started',
          message: expect.stringContaining('after replace_content'),
        }),
        expect.objectContaining({
          payloadJson: expect.objectContaining({
            toolName: 'read_file',
            sourceToolName: 'replace_content',
            automatic: true,
          }),
        })
      );
    } finally {
      await fs.rm(repoRoot, { recursive: true, force: true });
    }
  });

  it('passes latest user message together with compiled runtime context', async () => {
    const mockRun = { id: 'run-runtime-context', taskId: 'task-runtime-context' };
    const mockTask = {
      id: 'task-runtime-context',
      objective: 'Do work',
      acceptanceCriteria: 'Done',
    };

    vi.mocked(repo.getTaskRun).mockResolvedValue(mockRun as any);
    vi.mocked(repo.getTask).mockResolvedValue(mockTask as any);
    vi.mocked(repo.listTaskEventsForRun).mockResolvedValue([]);
    vi.mocked(llm.callSupervisorLLM)
      .mockResolvedValueOnce({
        phase: 'plan',
        workflow: 'general',
        instruction: 'Plan',
        rationale: 'Need context',
        expectedEvidence: [],
        riskLevel: 'low',
        toolCall: null,
      })
      .mockResolvedValueOnce({
        phase: 'stop',
        workflow: 'general',
        instruction: 'Done',
        rationale: 'Context read',
        finalResponse: 'Done',
        expectedEvidence: [],
        riskLevel: 'low',
        terminalState: 'completed',
        toolCall: null,
      });

    await runSupervisorLoop({
      runId: 'run-runtime-context',
      repoRoot: '/repo/project',
      prompt: 'compiled runtime context',
      latestUserMessage: 'latest user request',
      timeoutSeconds: 60,
    });

    const round1UserPrompt = vi.mocked(llm.callSupervisorLLM).mock.calls[0][1];
    expect(round1UserPrompt).toContain('latest user request');
    expect(round1UserPrompt).toContain('[Runtime Context]');
    expect(round1UserPrompt).toContain('compiled runtime context');
  });
});
