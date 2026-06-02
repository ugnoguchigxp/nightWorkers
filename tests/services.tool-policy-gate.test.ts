import { describe, expect, it } from 'vitest';
import { buildBlockedToolResult } from '../api/services/tool-policy/blocked-result';
import { DefaultToolPolicyGate } from '../api/services/tool-policy/tool-policy-gate';

const gate = new DefaultToolPolicyGate();
const repoRoot = '/tmp/repo';

describe('ToolPolicyGate', () => {
  it('blocks unknown commands before execution', async () => {
    const decision = await gate.beforeToolCall({
      runId: 'run-1',
      iteration: 1,
      toolName: 'run_command',
      args: { command: 'curl https://example.com' },
      repoRoot,
      readFiles: [],
    });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(['UNKNOWN_COMMAND', 'COMMAND_BLOCKED']).toContain(decision.code);
  });

  it('blocks replace_content when read-before-edit is required', async () => {
    const decision = await gate.beforeToolCall({
      runId: 'run-1',
      iteration: 1,
      toolName: 'replace_content',
      args: { filePath: 'src/main.ts', needle: 'a', replacement: 'b', mode: 'literal' },
      repoRoot,
      readFiles: [],
      safetyPolicy: { requireReadBeforeEdit: true },
    });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.code).toBe('READ_BEFORE_EDIT_REQUIRED');
  });

  it('caps command timeout with safety policy', async () => {
    const decision = await gate.beforeToolCall({
      runId: 'run-1',
      iteration: 1,
      toolName: 'run_command',
      args: { command: 'echo ok', timeoutSeconds: 120 },
      repoRoot,
      readFiles: [],
      safetyPolicy: { maxCommandSeconds: 30 },
    });
    expect(decision.allowed).toBe(true);
    if (decision.allowed) {
      expect(decision.effectiveLimits?.timeoutSeconds).toBe(30);
      expect(decision.normalizedArgs.timeoutSeconds).toBe(30);
    }
  });

  it('reports postflight violation if apply_patch changed files differ from preflight', async () => {
    const result = await gate.afterToolCall(
      {
        runId: 'run-1',
        iteration: 1,
        toolName: 'apply_patch',
        args: {},
        repoRoot,
        readFiles: [],
      },
      {
        ok: true,
        toolName: 'apply_patch',
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        payload: { changedFiles: ['a.ts'] },
      },
      { patchTargets: ['b.ts'] }
    );

    expect(result.policyViolation?.allowed).toBe(false);
    if (result.policyViolation && !result.policyViolation.allowed) {
      expect(result.policyViolation.code).toBe('POLICY_VIOLATION');
    }
  });

  it('allows apply_patch new file creation without read-before-edit', async () => {
    const decision = await gate.beforeToolCall({
      runId: 'run-1',
      iteration: 1,
      toolName: 'apply_patch',
      args: {
        patchContent: [
          'diff --git a/new-file.ts b/new-file.ts',
          'new file mode 100644',
          'index 0000000..1111111',
          '--- /dev/null',
          '+++ b/new-file.ts',
          '@@ -0,0 +1 @@',
          '+export const value = 1;',
        ].join('\n'),
      },
      repoRoot,
      readFiles: [],
      safetyPolicy: { requireReadBeforeEdit: true },
    });

    expect(decision.allowed).toBe(true);
  });

  it('returns an inspect_structure-shaped payload for blocked structure inspection', async () => {
    const decision = await gate.beforeToolCall({
      runId: 'run-1',
      iteration: 1,
      toolName: 'inspect_structure',
      args: { filePath: '../secret.json' },
      repoRoot,
      readFiles: [],
    });

    expect(decision.allowed).toBe(false);
    if (decision.allowed) throw new Error('expected policy block');

    const result = buildBlockedToolResult(
      {
        runId: 'run-1',
        iteration: 1,
        toolName: 'inspect_structure',
        args: { filePath: '../secret.json' },
        repoRoot,
        readFiles: [],
      },
      decision
    );

    expect(result.payload).toEqual({
      kind: 'json',
      filePath: '',
      paths: [],
      truncated: false,
    });
  });
});
