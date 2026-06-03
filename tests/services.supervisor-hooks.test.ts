import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as repo from '../api/modules/nightworkers/nightworkers.repository';
import { createAgentHook } from '../api/services/hooks/hooks-settings';
import * as llm from '../api/services/supervisor/llm-provider';
import { runSupervisorLoop } from '../api/services/supervisor/supervisor-loop';

vi.mock('../api/services/supervisor/llm-provider', () => ({
  callSupervisorLLM: vi.fn(),
}));

vi.mock('../api/modules/nightworkers/nightworkers.repository', () => ({
  getTaskRun: vi.fn(),
  getTask: vi.fn(),
  createRunEvent: vi.fn(),
  updateTaskRun: vi.fn(),
  updateTaskStatus: vi.fn(),
}));

let tempDir: string;

beforeEach(() => {
  vi.resetAllMocks();
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nightworkers-supervisor-hooks-'));
  process.env.NIGHTWORKERS_HOOKS_SETTINGS_PATH = path.join(tempDir, 'agent-hooks.json');
});

afterEach(() => {
  delete process.env.NIGHTWORKERS_HOOKS_SETTINGS_PATH;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('Supervisor Agent Hooks integration', () => {
  it('blocks PreToolUse separately from fixed policy blocks', async () => {
    createAgentHook({
      name: 'Deny commands',
      enabled: true,
      event: 'PreToolUse',
      matcher: 'run_command',
      handler: {
        type: 'command',
        command: process.execPath,
        args: [
          '-e',
          'console.log(JSON.stringify({hookSpecificOutput:{permissionDecision:"deny",permissionDecisionReason:"blocked by hook"}}))',
        ],
      },
    });
    vi.mocked(repo.getTaskRun).mockResolvedValue({
      id: 'run-1',
      taskId: 'task-1',
      repositoryId: 'repo-1',
    } as any);
    vi.mocked(repo.getTask).mockResolvedValue({
      id: 'task-1',
      objective: 'Run commands',
      acceptanceCriteria: 'Done',
    } as any);
    vi.mocked(llm.callSupervisorLLM)
      .mockResolvedValueOnce({
        phase: 'plan',
        workflow: 'general',
        instruction: 'Use tools',
        rationale: 'Need shell command',
        expectedEvidence: ['command output'],
        riskLevel: 'low',
        toolCall: null,
      })
      .mockResolvedValueOnce({
        phase: 'execute',
        workflow: 'general',
        instruction: 'Run command a',
        rationale: 'Need shell command',
        expectedEvidence: ['command output'],
        riskLevel: 'low',
        toolCall: { name: 'run_command', arguments: { command: 'echo a' } },
      })
      .mockResolvedValueOnce({
        phase: 'execute',
        workflow: 'general',
        instruction: 'Run command b',
        rationale: 'Need shell command',
        expectedEvidence: ['command output'],
        riskLevel: 'low',
        toolCall: { name: 'run_command', arguments: { command: 'echo b' } },
      })
      .mockResolvedValueOnce({
        phase: 'execute',
        workflow: 'general',
        instruction: 'Run command c',
        rationale: 'Need shell command',
        expectedEvidence: ['command output'],
        riskLevel: 'low',
        toolCall: { name: 'run_command', arguments: { command: 'echo c' } },
      });

    const result = await runSupervisorLoop({
      runId: 'run-1',
      repoRoot: process.cwd(),
      prompt: 'Run a command',
      timeoutSeconds: 60,
      maxRepeatedToolPattern: 3,
    });

    expect(result.terminalState).toBe('blocked');
    expect(result.stoppedBy).toBe('hook');
    expect(result.finalReport).toBe('blocked by hook');
    expect(repo.createRunEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'hook.blocked' }),
      expect.anything()
    );
    expect(repo.createRunEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'tool.policy_blocked' }),
      expect.anything()
    );
  });
});
