import { describe, expect, it } from 'vitest';
import { buildNormalTranscriptItems } from '../src/modules/nightworkers/components/ThreadTimeline';
import { getImportProjectToolCardModel } from '../src/modules/nightworkers/components/ThreadTimelineImportProjectCard';

const importProjectPayload = {
  mode: 'template',
  template: {
    templateId: 'hono-standard',
    variant: 'sqlite',
    ref: 'main',
    commit: 'abc123',
    targetPath: '/Users/y.noguchi/Code/todolist',
    copiedFiles: 42,
    copiedDirectories: 7,
    gitOperations: [
      {
        command: 'git clone --depth 1 https://github.com/ugnoguchigxp/hono-standard.git repo',
        cwd: '/var/folders/import',
        exitCode: 0,
        stdout: '',
        stderr: 'Cloning into repo...',
      },
    ],
  },
  git: null,
  postImport: {
    targetPath: '/Users/y.noguchi/Code/todolist',
    manifest: {
      status: 'found',
      path: '/Users/y.noguchi/Code/todolist/package.json',
      rawContent: '{\n  "name": "todolist"\n}',
      packageJson: {
        name: 'todolist',
        packageManager: 'bun@1.2.0',
        scripts: {
          typecheck: 'tsc --noEmit',
        },
        dependencies: {},
        devDependencies: {},
      },
      lockfiles: ['bun.lock'],
      detectedPackageManager: 'bun',
      installCommand: ['bun', 'install'],
      recommendedVerificationCommands: ['bun run typecheck'],
    },
    llmContext: {
      status: 'found',
      path: '/Users/y.noguchi/Code/todolist/LLM_CONTEXT.md',
      rawContent: '# LLM Context\nUse Bun.',
    },
    gitInitialization: {
      status: 'passed',
      cwd: '/Users/y.noguchi/Code/todolist',
      command: ['git', 'init'],
      gitDirPath: '/Users/y.noguchi/Code/todolist/.git',
      removedExistingGitDir: true,
      startedAt: '2026-06-13T00:00:00.000Z',
      finishedAt: '2026-06-13T00:00:01.000Z',
      durationMs: 1000,
      exitCode: 0,
      signal: null,
      stdout: 'Initialized empty Git repository',
      stderr: '',
    },
    initialization: {
      status: 'failed',
      cwd: '/Users/y.noguchi/Code/todolist',
      command: ['bun', 'install'],
      startedAt: '2026-06-13T00:00:00.000Z',
      finishedAt: '2026-06-13T00:00:01.000Z',
      durationMs: 1000,
      exitCode: 1,
      signal: null,
      stdout: 'Resolving dependencies',
      stderr: 'PermissionDenied',
    },
  },
};

describe('ThreadTimeline import_project cards', () => {
  it('extracts the MCP result payload including install and LLM context output', () => {
    const card = getImportProjectToolCardModel({
      kind: 'tool.result',
      payloadJson: {
        runEvent: {
          type: 'tool.call_finished',
          data: {
            toolName: 'import_project',
            result: {
              content: [{ type: 'text', text: JSON.stringify(importProjectPayload, null, 2) }],
            },
          },
        },
      },
    });

    expect(card?.targetPath).toBe('/Users/y.noguchi/Code/todolist');
    expect(card?.packageName).toBe('todolist');
    expect(card?.packageManager).toBe('bun');
    expect(card?.installStatus).toBe('failed');
    expect(card?.installCommand).toBe('bun install');
    expect(card?.installExitCode).toBe(1);
    expect(card?.installStderr).toBe('PermissionDenied');
    expect(card?.gitInitializationStatus).toBe('passed');
    expect(card?.gitInitializationCommand).toBe('git init');
    expect(card?.gitInitializationExitCode).toBe(0);
    expect(card?.gitInitializationStdout).toContain('Initialized');
    expect(card?.llmContextRawContent).toContain('Use Bun');
    expect(card?.gitOperations[0]?.stderr).toBe('Cloning into repo...');
    expect(card?.verificationCommands).toEqual(['bun run typecheck']);
  });

  it('extracts failed import_project payloads without requiring status missing fields', () => {
    const card = getImportProjectToolCardModel({
      kind: 'tool.result',
      payloadJson: {
        runEvent: {
          type: 'tool.call_finished',
          data: {
            toolName: 'nightworkers.import_project',
            result: {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    error: {
                      code: 'TASK_REPOSITORY_NOT_FOUND',
                      message: 'Cannot resolve repository.',
                    },
                    payload: { mode: '', template: null, git: null, postImport: null },
                  }),
                },
              ],
            },
          },
        },
      },
    });

    expect(card?.errorMessage).toBe('Cannot resolve repository.');
    expect(card?.llmContextStatus).toBe('');
  });

  it('keeps import_project results visible in normal transcript mode', () => {
    const items = buildNormalTranscriptItems([
      {
        kind: 'activity',
        id: 'activity:import-project',
        event: {
          id: 'import-project',
          taskId: 'task-1',
          kind: 'tool.result',
          source: 'worker',
          status: 'completed',
          seq: 1,
          payloadJson: {
            runEvent: {
              type: 'tool.call_finished',
              data: {
                toolName: 'import_project',
                result: {
                  content: [{ type: 'text', text: JSON.stringify(importProjectPayload) }],
                },
              },
            },
          },
          createdAt: '2026-06-13T00:00:00.000Z',
          visibility: 'visible',
        } as never,
      },
    ]);

    expect(items.map((item) => item.id)).toEqual(['activity:import-project']);
  });
});
