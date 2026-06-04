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

  it('runs one tool and then accepts a stop decision', async () => {
    vi.mocked(repo.getTaskRun).mockResolvedValue({ id: 'run-1', taskId: 'task-1' } as any);
    vi.mocked(repo.getTask).mockResolvedValue({
      id: 'task-1',
      objective: 'Check status',
      acceptanceCriteria: 'Done',
    } as any);

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
        toolCall: { name: 'git_status', arguments: {} },
      })
      .mockResolvedValueOnce({
        phase: 'stop',
        workflow: 'general',
        instruction: 'Task complete',
        rationale: 'Verification succeeded',
        finalResponse: 'Task complete',
        expectedEvidence: [],
        riskLevel: 'low',
        terminalState: 'completed',
        toolCall: null,
      })
      .mockResolvedValueOnce({
        phase: 'stop',
        workflow: 'general',
        instruction: 'Task complete',
        rationale: 'Finalized from SessionMemory',
        finalResponse: 'Task complete',
        expectedEvidence: [],
        riskLevel: 'low',
        terminalState: 'completed',
        toolCall: null,
      });

    const result = await runSupervisorLoop({
      runId: 'run-1',
      repoRoot: __dirname,
      prompt: 'Start',
      timeoutSeconds: 60,
    });

    expect(result).toMatchObject({
      finalReport: 'Task complete',
      terminalState: 'completed',
      stoppedBy: 'decision',
    });
    expect(vi.mocked(llm.callSupervisorLLM).mock.calls.map((call) => call[2]?.round)).toEqual([
      1, 2, 2, 3,
    ]);
    const finalizeInput = JSON.parse(String(vi.mocked(llm.callSupervisorLLM).mock.calls[3][1]));
    expect(finalizeInput.sessionMemory.evidence.length).toBeGreaterThan(0);
    expect(repo.updateTaskRun).toHaveBeenCalledWith('run-1', {
      finalReport: 'Task complete',
      summary: 'Task complete',
      status: 'completed',
    });
  });

  it('accepts a code_change report without forcing an edit retry loop', async () => {
    vi.mocked(repo.getTaskRun).mockResolvedValue({
      id: 'run-report',
      taskId: 'task-report',
    } as any);
    vi.mocked(repo.getTask).mockResolvedValue({
      id: 'task-report',
      objective: 'Create fizzbuzz.ts',
      acceptanceCriteria: 'File exists',
    } as any);

    vi.mocked(llm.callSupervisorLLM)
      .mockResolvedValueOnce({
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
        instruction: 'Check whether fizzbuzz.ts already exists.',
        rationale: 'The user requested a file creation.',
        finalResponse: '',
        expectedEvidence: ['fizzbuzz.ts exists'],
        riskLevel: 'low',
        toolCall: null,
      })
      .mockResolvedValueOnce({
        phase: 'report',
        workflow: 'code_change',
        instruction: 'File already exists.',
        rationale: 'The requested file is already present.',
        finalResponse: 'fizzbuzz.ts は既にプロジェクトルートにあります。',
        expectedEvidence: ['fizzbuzz.ts exists'],
        riskLevel: 'low',
        toolCall: null,
      })
      .mockResolvedValueOnce({
        phase: 'stop',
        workflow: 'code_change',
        instruction: 'File already exists.',
        rationale: 'Finalized from SessionMemory',
        finalResponse: 'fizzbuzz.ts は既にプロジェクトルートにあります。',
        expectedEvidence: ['fizzbuzz.ts exists'],
        riskLevel: 'low',
        terminalState: 'needs_review',
        toolCall: null,
      });

    const result = await runSupervisorLoop({
      runId: 'run-report',
      repoRoot: '/repo/project',
      prompt: 'fizzbuzz.tsをプロジェクトルートに作ってください',
      timeoutSeconds: 60,
    });

    expect(result.terminalState).toBe('needs_review');
    expect(result.stoppedBy).toBe('decision');
    expect(result.finalReport).toContain('fizzbuzz.ts は既に');
    expect(vi.mocked(llm.callSupervisorLLM)).toHaveBeenCalledTimes(3);
    expect(vi.mocked(llm.callSupervisorLLM).mock.calls.map((call) => call[2]?.round)).toEqual([
      1, 2, 3,
    ]);
  });

  it('rejects finalize decisions that try to request worker tools', async () => {
    vi.mocked(repo.getTaskRun).mockResolvedValue({
      id: 'run-finalize-tool',
      taskId: 'task-finalize-tool',
    } as any);
    vi.mocked(repo.getTask).mockResolvedValue({
      id: 'task-finalize-tool',
      objective: 'Summarize only',
      acceptanceCriteria: 'No tool execution during finalize',
    } as any);

    vi.mocked(llm.callSupervisorLLM)
      .mockResolvedValueOnce({
        phase: 'plan',
        workflow: 'general',
        instruction: 'Plan.',
        rationale: 'Route first.',
        finalResponse: '',
        expectedEvidence: [],
        riskLevel: 'low',
        toolCall: null,
      })
      .mockResolvedValueOnce({
        phase: 'stop',
        workflow: 'general',
        instruction: 'Ready to summarize.',
        rationale: 'No tools needed.',
        finalResponse: 'Fallback final answer',
        expectedEvidence: [],
        riskLevel: 'low',
        terminalState: 'completed',
        toolCall: null,
      })
      .mockResolvedValueOnce({
        phase: 'act',
        workflow: 'general',
        instruction: 'Run a tool from finalize.',
        rationale: 'Invalid finalize action.',
        finalResponse: 'Should not be adopted',
        expectedEvidence: [],
        riskLevel: 'low',
        toolCall: { name: 'git_status', arguments: {} },
      });

    const result = await runSupervisorLoop({
      runId: 'run-finalize-tool',
      repoRoot: '/repo/project',
      prompt: 'Summarize only',
      timeoutSeconds: 60,
    });

    expect(result.finalReport).toBe('Fallback final answer');
    expect(result.terminalState).toBe('completed');
    expect(vi.mocked(llm.callSupervisorLLM).mock.calls.map((call) => call[2]?.round)).toEqual([
      1, 2, 3,
    ]);
  });

  it('stops immediately when a decision has no toolCall and is not terminal', async () => {
    vi.mocked(repo.getTaskRun).mockResolvedValue({
      id: 'run-missing',
      taskId: 'task-missing',
    } as any);
    vi.mocked(repo.getTask).mockResolvedValue({
      id: 'task-missing',
      objective: 'Do work',
      acceptanceCriteria: 'Done',
    } as any);

    vi.mocked(llm.callSupervisorLLM)
      .mockResolvedValueOnce({
        phase: 'plan',
        workflow: 'general',
        instruction: 'Plan only',
        rationale: 'No action selected',
        expectedEvidence: [],
        riskLevel: 'low',
        toolCall: null,
      })
      .mockResolvedValueOnce({
        phase: 'act',
        workflow: 'general',
        instruction: 'Act without a tool',
        rationale: 'Invalid decision',
        expectedEvidence: [],
        riskLevel: 'low',
        toolCall: null,
      });

    const result = await runSupervisorLoop({
      runId: 'run-missing',
      repoRoot: '/repo/project',
      prompt: 'Do work',
      timeoutSeconds: 60,
    });

    expect(result.terminalState).toBe('needs_human');
    expect(result.stoppedBy).toBe('missing_tool_call');
    expect(vi.mocked(llm.callSupervisorLLM)).toHaveBeenCalledTimes(2);
  });

  it('completes code_change immediately after edit tool success', async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'nightworkers-edit-'));
    await fs.mkdir(path.join(repoRoot, 'src'), { recursive: true });
    await fs.writeFile(path.join(repoRoot, 'src/greeting.txt'), 'hello before\n', 'utf-8');

    vi.mocked(repo.getTaskRun).mockResolvedValue({ id: 'run-edit', taskId: 'task-edit' } as any);
    vi.mocked(repo.getTask).mockResolvedValue({
      id: 'task-edit',
      objective: 'Update greeting',
      acceptanceCriteria: 'File contains updated greeting',
    } as any);

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
        rationale: 'The edit tool requires prior file evidence.',
        finalResponse: '',
        expectedEvidence: ['src/greeting.txt'],
        riskLevel: 'low',
        toolCall: { name: 'read_file', arguments: { filePath: 'src/greeting.txt' } },
      })
      .mockResolvedValueOnce({
        phase: 'act',
        workflow: 'code_change',
        instruction: 'Replace the greeting.',
        rationale: 'The target content has been read.',
        finalResponse: '',
        expectedEvidence: ['replace_content result'],
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
        instruction: 'Greeting updated.',
        rationale: 'The edit tool succeeded.',
        finalResponse: '',
        expectedEvidence: ['replace_content result'],
        riskLevel: 'low',
        terminalState: 'needs_review',
        toolCall: null,
      })
      .mockResolvedValueOnce({
        phase: 'stop',
        workflow: 'code_change',
        instruction: 'Greeting updated.',
        rationale: 'Finalized from SessionMemory',
        finalResponse:
          'コード変更を完了し、レビュー待ちにしました。\n変更ファイル: src/greeting.txt',
        expectedEvidence: ['replace_content result'],
        riskLevel: 'low',
        terminalState: 'needs_review',
        toolCall: null,
      });

    try {
      const result = await runSupervisorLoop({
        runId: 'run-edit',
        repoRoot,
        prompt: 'src/greeting.txt の greeting を更新してください',
        timeoutSeconds: 60,
      });

      expect(result.terminalState).toBe('needs_review');
      expect(result.stoppedBy).toBe('decision');
      expect(result.finalReport).toContain('コード変更を完了し、レビュー待ちにしました。');
      expect(result.finalReport).toContain('src/greeting.txt');
      expect(await fs.readFile(path.join(repoRoot, 'src/greeting.txt'), 'utf-8')).toContain(
        'hello after'
      );
      expect(vi.mocked(llm.callSupervisorLLM)).toHaveBeenCalledTimes(5);
      expect(vi.mocked(llm.callSupervisorLLM).mock.calls.map((call) => call[2]?.round)).toEqual([
        1, 2, 2, 2, 3,
      ]);
    } finally {
      await fs.rm(repoRoot, { recursive: true, force: true });
    }
  });
});
