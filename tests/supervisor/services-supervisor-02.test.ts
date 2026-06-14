import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as repo from '../../api/modules/nightworkers/nightworkers.repository';
import * as llm from '../../api/services/structured-llm';
import { runSupervisorLoop } from '../../api/services/supervisor/supervisor-loop';
import { parseRound2UserContextJsonSection } from '../../api/services/supervisor/user-context';

const _execFileAsync = promisify(execFile);

vi.mock('../../api/services/structured-llm', () => ({
  callSupervisorLLM: vi.fn(),
}));

vi.mock('../../api/modules/nightworkers/nightworkers.repository', () => ({
  getTaskRun: vi.fn(),
  getTask: vi.fn(),
  createRunEvent: vi.fn(),
  createTaskMessage: vi.fn(),
  updateTaskRun: vi.fn(),
  updateTaskStatus: vi.fn(),
  listTaskRunTodosForRun: vi.fn(),
  replaceTaskRunTodosForRun: vi.fn(),
  updateTaskRunTodo: vi.fn(),
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
    vi.mocked(repo.listTaskRunTodosForRun).mockResolvedValue([]);
  });

  it('handles search_procedure without dispatching it to worker tools', async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'nightworkers-search-procedure-'));

    vi.mocked(llm.callSupervisorLLM)
      .mockResolvedValueOnce({ jobType: 'minor_code_edit', goal: 'procedure 検索後に完了する' })
      .mockResolvedValueOnce({
        toolCall: {
          name: 'search_procedure',
          arguments: { query: 'minor code edit target path known', maxResults: 3 },
        },
      })
      .mockResolvedValueOnce({
        toolCall: {
          name: 'finalize_answer',
          arguments: { message: '検索しました。' },
        },
      });

    try {
      const result = await runSupervisorLoop({
        runId: 'run-1',
        repoRoot,
        prompt: 'procedure を検索して',
        timeoutSeconds: 60,
      });

      expect(result.finalReport).toBe('検索しました。');
      const secondRound2ToolEvidence = parseRound2UserContextJsonSection<any[]>(
        vi.mocked(llm.callSupervisorLLM).mock.calls[2]?.[1] as string,
        'Recent Tool Evidence'
      );
      expect(secondRound2ToolEvidence[0]).toMatchObject({
        toolName: 'search_procedure',
        ok: true,
      });
      expect(secondRound2ToolEvidence[0].payload.matches).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            jobType: 'minor_code_edit',
            path: 'procedures/minor_code_edit.md',
          }),
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
