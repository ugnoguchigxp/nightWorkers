import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { WorkbenchStateBanner } from '../src/modules/nightworkers/components/ThreadWorkspaceBanner';
import type { WorkbenchSessionView } from '../src/modules/nightworkers/types';
import { buildTask, buildTaskRun } from './helpers/nightworkers-fixtures';

const baseSessionView: WorkbenchSessionView = {
  task: buildTask({ status: 'running' }),
  group: 'processing',
  emailState: 'running',
  primaryAction: 'open_run',
  phase: 'Implementing',
  progress: { percent: 65, phase: 'Implementing', basis: [], blockers: [] },
  latestRun: buildTaskRun({ status: 'running' }),
  artifactCounts: {},
  badges: [],
};

describe('WorkbenchStateBanner Codex diagnostics', () => {
  it('renders contract warning and MCP diagnostics as read-only badges', () => {
    const markup = renderToStaticMarkup(
      <WorkbenchStateBanner
        sessionView={{
          ...baseSessionView,
          codexContractWarnings: {
            totalCount: 3,
            warningCount: 2,
            errorCount: 1,
            items: [
              {
                code: 'codex_open_todos_before_completion',
                severity: 'error',
                count: 1,
                changedFiles: [],
              },
              {
                code: 'codex_file_change_before_todo_replace',
                severity: 'warning',
                count: 2,
                changedFiles: ['src/app.ts'],
              },
            ],
          },
          codexMcpDiagnostics: {
            configSource: 'inline_configured',
            observedNightWorkersTools: ['nightworkers.todo_list'],
            expectedTools: ['nightworkers.todo_list', 'nightworkers.import_project'],
            degraded: true,
            tone: 'warning',
            label: 'MCP degraded',
          },
        }}
        model="test-model"
        onRemoveQueueEntry={vi.fn()}
        onSubmitReview={vi.fn()}
        onRequeueQueueEntry={vi.fn()}
        onArchiveQueueExecution={vi.fn()}
        onOpenDiff={vi.fn()}
        hasDiff={false}
      />
    );

    expect(markup).toContain('Contract warnings: 2 warning / 1 error');
    expect(markup).toContain('codex_open_todos_before_completion x1');
    expect(markup).toContain('MCP degraded');
    expect(markup).toContain('observed 1');
    expect(markup).not.toContain('<button');
  });
});
