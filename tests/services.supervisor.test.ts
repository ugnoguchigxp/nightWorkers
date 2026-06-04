import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
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
  createTaskMessage: vi.fn(),
  updateTaskRun: vi.fn(),
  updateTaskStatus: vi.fn(),
}));

const execFileAsync = promisify(execFile);

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

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
      expect(repo.createTaskMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: 'task-edit',
          runId: 'run-edit',
          role: 'assistant',
          messageType: 'markdown_document',
          content: [
            '--- src/greeting.txt',
            '+++ src/greeting.txt',
            '# replace_content occurrences: 1',
            '- hello before',
            '+ hello after',
          ].join('\n'),
          payloadJson: expect.objectContaining({
            intent: 'tool_diff',
            toolName: 'replace_content',
          }),
        })
      );
      expect(vi.mocked(llm.callSupervisorLLM)).toHaveBeenCalledTimes(5);
      expect(vi.mocked(llm.callSupervisorLLM).mock.calls.map((call) => call[2]?.round)).toEqual([
        1, 2, 2, 2, 3,
      ]);
    } finally {
      await fs.rm(repoRoot, { recursive: true, force: true });
    }
  });

  it('removes existing fizzbuzz output when present, recreates it, verifies it, finalizes, and removes the workspace', async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'nightworkers-fizzbuzz-regression-'));
    const fizzbuzzPath = path.join(repoRoot, 'fizzbuzz.ts');
    let workspaceCleaned = false;

    if (await pathExists(fizzbuzzPath)) {
      await fs.rm(fizzbuzzPath);
    }

    await execFileAsync('git', ['init'], { cwd: repoRoot });
    await fs.mkdir(path.join(repoRoot, 'tests'), { recursive: true });
    await fs.writeFile(path.join(repoRoot, 'README.md'), '# FizzBuzz regression\n', 'utf-8');

    vi.mocked(repo.getTaskRun).mockResolvedValue({
      id: 'run-fizzbuzz-regression',
      taskId: 'task-fizzbuzz-regression',
    } as any);
    vi.mocked(repo.getTask).mockResolvedValue({
      id: 'task-fizzbuzz-regression',
      objective: 'Create fizzbuzz and tests',
      acceptanceCriteria: 'Implementation, tests, and verification are complete',
    } as any);

    vi.mocked(llm.callSupervisorLLM)
      .mockResolvedValueOnce({
        phase: 'plan',
        workflow: 'code_change',
        instruction: 'Create fizzbuzz.ts and a matching test.',
        rationale: 'The user requested implementation plus tests.',
        finalResponse: '',
        expectedEvidence: ['fizzbuzz.ts', 'tests/fizzbuzz.test.ts', 'verification result'],
        riskLevel: 'low',
        toolCall: null,
      })
      .mockResolvedValueOnce({
        phase: 'act',
        workflow: 'code_change',
        instruction: 'Create fizzbuzz.ts.',
        rationale: 'The implementation file is required first.',
        finalResponse: '',
        expectedEvidence: ['fizzbuzz.ts'],
        riskLevel: 'low',
        toolCall: {
          name: 'apply_patch',
          arguments: {
            patchContent: [
              'diff --git a/fizzbuzz.ts b/fizzbuzz.ts',
              'new file mode 100644',
              '--- /dev/null',
              '+++ b/fizzbuzz.ts',
              '@@ -0,0 +1,6 @@',
              '+export function fizzbuzz(n: number): string {',
              '+  if (n % 15 === 0) return "FizzBuzz";',
              '+  if (n % 3 === 0) return "Fizz";',
              '+  if (n % 5 === 0) return "Buzz";',
              '+  return String(n);',
              '+}',
              '',
            ].join('\n'),
          },
        },
      })
      .mockResolvedValueOnce({
        phase: 'act',
        workflow: 'code_change',
        instruction: 'Create fizzbuzz tests.',
        rationale: 'The implementation needs coverage before finalizing.',
        finalResponse: '',
        expectedEvidence: ['tests/fizzbuzz.test.ts'],
        riskLevel: 'low',
        toolCall: {
          name: 'apply_patch',
          arguments: {
            patchContent: [
              'diff --git a/tests/fizzbuzz.test.ts b/tests/fizzbuzz.test.ts',
              'new file mode 100644',
              '--- /dev/null',
              '+++ b/tests/fizzbuzz.test.ts',
              '@@ -0,0 +1,17 @@',
              "+import { describe, expect, it } from 'vitest';",
              "+import { fizzbuzz } from '../fizzbuzz';",
              '+',
              "+describe('fizzbuzz', () => {",
              "+  it('returns FizzBuzz for multiples of 15', () => {",
              "+    expect(fizzbuzz(15)).toBe('FizzBuzz');",
              '+  });',
              '+',
              "+  it('returns Fizz and Buzz for their multiples', () => {",
              "+    expect(fizzbuzz(3)).toBe('Fizz');",
              "+    expect(fizzbuzz(5)).toBe('Buzz');",
              '+  });',
              '+',
              "+  it('returns the number otherwise', () => {",
              "+    expect(fizzbuzz(7)).toBe('7');",
              '+  });',
              '+});',
              '',
            ].join('\n'),
          },
        },
      })
      .mockResolvedValueOnce({
        phase: 'verify',
        workflow: 'code_change',
        instruction: 'Verify generated implementation and tests exist.',
        rationale: 'The run must not finalize before checking both generated files.',
        finalResponse: '',
        expectedEvidence: ['verification result'],
        riskLevel: 'low',
        toolCall: {
          name: 'run_verification',
          arguments: {
            command: 'grep -q FizzBuzz fizzbuzz.ts',
            reason: 'Confirm generated fizzbuzz implementation and test file are present.',
            timeoutSeconds: 10,
          },
        },
      })
      .mockResolvedValueOnce({
        phase: 'stop',
        workflow: 'code_change',
        instruction: 'FizzBuzz implementation and tests are verified.',
        rationale: 'Both files were created and verification succeeded.',
        finalResponse: '',
        expectedEvidence: ['fizzbuzz.ts', 'tests/fizzbuzz.test.ts', 'verification result'],
        riskLevel: 'low',
        terminalState: 'needs_review',
        toolCall: null,
      })
      .mockResolvedValueOnce({
        phase: 'stop',
        workflow: 'code_change',
        instruction: 'FizzBuzz implementation and tests are verified.',
        rationale: 'Finalized from SessionMemory.',
        finalResponse: 'fizzbuzz.ts と tests/fizzbuzz.test.ts を追加し、検証も成功しました。',
        expectedEvidence: ['fizzbuzz.ts', 'tests/fizzbuzz.test.ts', 'verification result'],
        riskLevel: 'low',
        terminalState: 'needs_review',
        toolCall: null,
      });

    try {
      const result = await runSupervisorLoop({
        runId: 'run-fizzbuzz-regression',
        repoRoot,
        prompt: 'fizzbuzz.tsをプロジェクトルートに作り、Vitestのテストも追加して検証してください',
        timeoutSeconds: 60,
      });

      expect(result.terminalState).toBe('needs_review');
      expect(result.stoppedBy).toBe('decision');
      expect(result.finalReport).toContain('tests/fizzbuzz.test.ts');
      expect(await fs.readFile(fizzbuzzPath, 'utf-8')).toContain('FizzBuzz');
      expect(await fs.readFile(path.join(repoRoot, 'tests/fizzbuzz.test.ts'), 'utf-8')).toContain(
        'multiples of 15'
      );
      expect(vi.mocked(llm.callSupervisorLLM).mock.calls.map((call) => call[2]?.round)).toEqual([
        1, 2, 2, 2, 2, 3,
      ]);
      const finalizeInput = JSON.parse(String(vi.mocked(llm.callSupervisorLLM).mock.calls[5][1]));
      expect(finalizeInput.sessionMemory.changedFiles).toEqual(
        expect.arrayContaining(['fizzbuzz.ts', 'tests/fizzbuzz.test.ts'])
      );
      expect(finalizeInput.sessionMemory.verification.some((item: any) => item.ok)).toBe(true);
    } finally {
      await fs.rm(repoRoot, { recursive: true, force: true });
      workspaceCleaned = true;
    }

    expect(workspaceCleaned).toBe(true);
    await expect(fs.access(repoRoot)).rejects.toThrow();
  });
});
