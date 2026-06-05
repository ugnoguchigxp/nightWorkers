import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as repo from '../api/modules/nightworkers/nightworkers.repository';
import * as llm from '../api/services/supervisor/llm-provider';
import {
  buildRound2ToolCallPrompt,
  getAllowedToolsForJobType,
} from '../api/services/supervisor/prompt';
import { runSupervisorLoop } from '../api/services/supervisor/supervisor-loop';

const execFileAsync = promisify(execFile);

vi.mock('../api/services/supervisor/llm-provider', () => ({
  callSupervisorLLM: vi.fn(),
}));

vi.mock('../api/modules/nightworkers/nightworkers.repository', () => ({
  getTaskRun: vi.fn(),
  getTask: vi.fn(),
  createRunEvent: vi.fn(),
  createTaskMessage: vi.fn(),
  updateTaskRun: vi.fn(),
  updateTaskStatus: vi.fn(),
}));

describe('Schema-first supervisor loop', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(repo.getTaskRun).mockResolvedValue({ id: 'run-1', taskId: 'task-1' } as any);
    vi.mocked(repo.getTask).mockResolvedValue({
      id: 'task-1',
      objective: 'Create fizzbuzz.ts',
      acceptanceCriteria: 'File exists',
    } as any);
  });

  it('describes minor_code_edit apply_patch file creation without fragile patch formatting', () => {
    const prompt = buildRound2ToolCallPrompt({
      projectRoot: '/repo/project',
      jobType: 'minor_code_edit',
      skill: '# minor_code_edit',
      tools: getAllowedToolsForJobType('minor_code_edit'),
    });

    expect(prompt).toContain('apply_patch が成功したら次は changedFiles の対象を read_file');
    expect(prompt).not.toContain('<lineCount>');
    expect(prompt).not.toContain('READ_BEFORE_EDIT');
    expect(prompt).not.toContain('git apply');
    expect(prompt).not.toContain('- list_dir:');
    expect(prompt).not.toContain('git_status');
    expect(prompt).not.toContain('git_diff');
  });

  it('runs minor_code_edit with jobType+goal Round 1 and toolCall-only Round 2', async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'nightworkers-schema-first-'));
    await execFileAsync('git', ['init'], { cwd: repoRoot });

    vi.mocked(llm.callSupervisorLLM)
      .mockResolvedValueOnce({
        jobType: 'minor_code_edit',
        goal: 'プロジェクトルートに fizzbuzz.ts を作成する',
      })
      .mockResolvedValueOnce({
        toolCall: {
          name: 'apply_patch',
          arguments: {
            patchContent: [
              '--- /dev/null',
              '+++ b/fizzbuzz.ts',
              '@@ -0,0 +1,6 @@',
              '+for (let i = 1; i <= 100; i += 1) {',
              '+  if (i % 15 === 0) console.log("FizzBuzz");',
              '+  else if (i % 3 === 0) console.log("Fizz");',
              '+  else if (i % 5 === 0) console.log("Buzz");',
              '+  else console.log(i);',
              '+}',
              '',
            ].join('\n'),
          },
        },
      })
      .mockResolvedValueOnce({
        toolCall: {
          name: 'finalize_answer',
          arguments: { message: 'プロジェクトルートに `fizzbuzz.ts` を作成しました。' },
        },
      });

    try {
      const result = await runSupervisorLoop({
        runId: 'run-1',
        repoRoot,
        prompt: 'fizzbuzz.tsをプロジェクトルートに作ってください',
        timeoutSeconds: 60,
      });

      expect(result).toMatchObject({
        finalReport: 'プロジェクトルートに `fizzbuzz.ts` を作成しました。',
        terminalState: 'completed',
        stoppedBy: 'decision',
      });
      expect(await fs.readFile(path.join(repoRoot, 'fizzbuzz.ts'), 'utf-8')).toContain('FizzBuzz');
      expect(vi.mocked(llm.callSupervisorLLM).mock.calls.map((call) => call[2])).toEqual([
        expect.objectContaining({ round: 1, schemaFirst: true }),
        expect.objectContaining({ round: 2, schemaFirst: true }),
        expect.objectContaining({ round: 2, schemaFirst: true }),
      ]);
      expect(vi.mocked(llm.callSupervisorLLM)).toHaveBeenCalledTimes(3);
      expect(vi.mocked(llm.callSupervisorLLM).mock.calls.length).toBeLessThanOrEqual(20);
      expect(repo.updateTaskRun).toHaveBeenCalledWith('run-1', {
        finalReport: 'プロジェクトルートに `fizzbuzz.ts` を作成しました。',
        summary: 'プロジェクトルートに `fizzbuzz.ts` を作成しました。',
        status: 'completed',
      });
    } finally {
      await fs.rm(repoRoot, { recursive: true, force: true });
    }
  });

  it('persists all runtime, LLM, and tool activity as append-only events', async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'nightworkers-events-'));

    vi.mocked(llm.callSupervisorLLM)
      .mockImplementationOnce(async (_system, _user, options) => {
        await options?.emitEvent?.({
          type: 'model.request_started',
          severity: 'info',
          message: 'round1 start',
          data: { raw: 'request' },
        });
        await options?.emitEvent?.({
          type: 'model.response_finished',
          severity: 'info',
          message: 'round1 raw',
          data: { rawContent: '{"jobType":"minor_code_edit","goal":"完了する"}' },
        });
        return { jobType: 'minor_code_edit', goal: '完了する' } as any;
      })
      .mockImplementationOnce(async (_system, _user, options) => {
        await options?.emitEvent?.({
          type: 'model.response_finished',
          severity: 'info',
          message: 'round2 raw',
          data: {
            rawContent:
              '{"toolCall":{"name":"finalize_answer","arguments":{"message":"完了しました。"}}}',
          },
        });
        return {
          toolCall: {
            name: 'finalize_answer',
            arguments: { message: '完了しました。' },
          },
        } as any;
      });

    try {
      await runSupervisorLoop({
        runId: 'run-1',
        repoRoot,
        prompt: '完了して',
        timeoutSeconds: 60,
      });

      const payloads = vi
        .mocked(repo.createRunEvent)
        .mock.calls.map((call) => call[1]?.payloadJson || {});
      expect(payloads).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ agentEventType: 'run.started' }),
          expect.objectContaining({ agentEventType: 'round1.prompt_built' }),
          expect.objectContaining({ agentEventType: 'model.request_started' }),
          expect.objectContaining({
            agentEventType: 'model.response_finished',
            rawContent: '{"jobType":"minor_code_edit","goal":"完了する"}',
          }),
          expect.objectContaining({ agentEventType: 'round1.parsed' }),
          expect.objectContaining({ agentEventType: 'skill.loaded' }),
          expect.objectContaining({ agentEventType: 'round2.prompt_built' }),
          expect.objectContaining({ agentEventType: 'round2.parsed' }),
          expect.objectContaining({ agentEventType: 'finalize.received' }),
          expect.objectContaining({ agentEventType: 'run.completed' }),
        ])
      );
    } finally {
      await fs.rm(repoRoot, { recursive: true, force: true });
    }
  });

  it('records invalid tool calls and continues without old decision JSON', async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'nightworkers-invalid-tool-'));

    vi.mocked(llm.callSupervisorLLM)
      .mockResolvedValueOnce({ jobType: 'minor_code_edit', goal: 'invalid tool retry' })
      .mockResolvedValueOnce({
        toolCall: {
          name: 'unknown_tool',
          arguments: {},
        },
      })
      .mockResolvedValueOnce({
        toolCall: {
          name: 'finalize_answer',
          arguments: { message: 'invalid tool 後に完了しました。' },
        },
      });

    try {
      const result = await runSupervisorLoop({
        runId: 'run-1',
        repoRoot,
        prompt: 'invalid tool retry',
        timeoutSeconds: 60,
      });

      expect(result.finalReport).toBe('invalid tool 後に完了しました。');
      expect(
        vi
          .mocked(repo.createRunEvent)
          .mock.calls.some(
            (call) => call[1]?.payloadJson?.agentEventType === 'tool.validation_failed'
          )
      ).toBe(true);
      expect(vi.mocked(llm.callSupervisorLLM)).toHaveBeenCalledTimes(3);
    } finally {
      await fs.rm(repoRoot, { recursive: true, force: true });
    }
  });
});
