import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  getMissionGoalTemplatesForStack,
  missionGoalTemplates,
} from '../shared/mission-goal-templates';
import type { ProjectStackProfile } from '../shared/schemas/project-detail.schema';
import '../src/i18n/setup';
import {
  applyMissionGoalTemplate,
  GoalEditorDialog,
  MissionGenerateTasksPanel,
  QualityReportPanel,
  toggleMissionGoalTemplate,
} from '../src/modules/nightworkers/components/ProjectDetailScreen';
import { coverageRowsFromSummary } from '../src/modules/nightworkers/qualityRows';

const baseProps = {
  rows: [],
  candidates: [],
  selectedIds: [],
  busy: false,
  isGenerating: false,
  selectedCount: 0,
  onToggleSelected: vi.fn(),
  onOpen: vi.fn(),
  onDismiss: vi.fn(),
  onGenerate: vi.fn(),
  onCreateTasks: vi.fn(),
};

const stackProfile = (technologies: ProjectStackProfile['technologies']): ProjectStackProfile => ({
  summary: technologies.map((technology) => technology.name).join(' + '),
  manifestStatus: 'found',
  manifestPath: '/tmp/package.json',
  packageManager: 'bun',
  technologies,
});

const fullTemplateStack = stackProfile([
  {
    name: 'React',
    category: 'frontend',
    packageName: 'react',
    version: '19.2.4',
    source: 'package_json',
    confidence: 'high',
  },
  {
    name: 'i18next',
    category: 'tooling',
    packageName: 'react-i18next',
    version: '17.0.8',
    source: 'package_json',
    confidence: 'high',
  },
  {
    name: 'Tailwind CSS',
    category: 'frontend',
    packageName: 'tailwindcss',
    version: '4.0.0',
    source: 'package_json',
    confidence: 'high',
  },
]);

describe('MissionGenerateTasksPanel', () => {
  it('shows a loading indicator while task candidates are being generated', () => {
    const markup = renderToStaticMarkup(
      <MissionGenerateTasksPanel {...baseProps} busy={true} isGenerating={true} />
    );

    expect(markup).toContain('animate-spin');
    expect(markup).toContain('候補を生成中');
    expect(markup).not.toContain('候補を生成</button>');
  });

  it('keeps the normal generate button when another candidate action is busy', () => {
    const markup = renderToStaticMarkup(
      <MissionGenerateTasksPanel {...baseProps} busy={true} isGenerating={false} />
    );

    expect(markup).not.toContain('animate-spin');
    expect(markup).toContain('候補を生成');
  });

  it('renders row-level delete actions for draft task candidates', () => {
    const markup = renderToStaticMarkup(
      <MissionGenerateTasksPanel
        {...baseProps}
        rows={[
          {
            id: 'mission_task_candidate:candidate-1',
            source: 'mission_task_candidate' as const,
            sourceId: 'candidate-1',
            title: '候補タスク',
            goal: 'Goal',
            signal: 'Signal',
            evaluationContribution: '+10',
            tokenSize: 'small',
            importance: 80,
            confidence: 70,
            complexity: 'simple',
            reason: 'ドラフト候補として削除できる。',
          },
        ]}
      />
    );

    expect(markup).toContain('aria-label="候補を削除"');
    expect(markup).toContain('lucide-trash-2');
  });
});

describe('QualityReportPanel', () => {
  const allRun = {
    id: '11111111-1111-4111-8111-111111111111',
    repositoryId: '22222222-2222-4222-8222-222222222222',
    runType: 'all' as const,
    status: 'completed' as const,
    command: 'bun run test && bun run test:coverage && bun run test:e2e',
    exitCode: 0,
    startedAt: new Date('2026-07-04T00:00:00.000Z'),
    completedAt: new Date('2026-07-04T00:00:02.000Z'),
    outputArtifactId: null,
    latestOutput: 'unit\ncoverage\ne2e',
    coverageSummary: {
      total: {
        statements: { pct: 88.2 },
        branches: { pct: 81.4 },
        functions: { pct: 90 },
        lines: { pct: 87.5 },
      },
      'src/checkout.ts': {
        statements: { pct: 75 },
        branches: {},
        functions: { pct: 80 },
        lines: { pct: 72 },
        uncoveredLines: [12, 18],
      },
    },
    coverageGate: {
      enabled: true,
      passed: true,
      targetPercent: 80,
      metrics: [
        {
          metric: 'lines' as const,
          actualPercent: 87.5,
          targetPercent: 80,
          deltaPercent: 7.5,
          passed: true,
        },
      ],
      failedMetrics: [],
      measuredAt: '2026-07-04T00:00:02.000Z',
    },
    e2eSummary: {
      status: 'passed' as const,
      total: 1,
      passed: 1,
      failed: 0,
      skipped: 0,
      durationMs: 120,
      suites: [
        {
          title: 'checkout.spec.ts',
          status: 'passed' as const,
          tests: 1,
          durationMs: 120,
          lastFailure: null,
        },
      ],
    },
    errorMessage: null,
    createdAt: new Date('2026-07-04T00:00:00.000Z'),
    updatedAt: new Date('2026-07-04T00:00:02.000Z'),
  };

  const runnableCapability = { runnable: true, missingCapabilities: [], command: 'bun run test' };

  it('renders all-run coverage and E2E data through explicit overview fields', () => {
    const markup = renderToStaticMarkup(
      <QualityReportPanel
        quality={{
          capabilities: {
            projectType: 'typescript',
            unit: runnableCapability,
            coverage: { ...runnableCapability, command: 'bun run test:coverage' },
            e2e: { ...runnableCapability, command: 'bun run test:e2e' },
            all: {
              ...runnableCapability,
              command: 'bun run test && bun run test:coverage && bun run test:e2e',
            },
          },
          latestUnitRun: null,
          latestE2eRun: null,
          latestCoverageRun: allRun,
          latestE2eResultRun: allRun,
          latestAllRun: allRun,
          recentRuns: [allRun],
          runningRuns: [],
        }}
        coverageRows={coverageRowsFromSummary(allRun.coverageSummary)}
        e2eRows={[
          {
            suite: 'checkout.spec.ts',
            status: 'PASS',
            tests: '1',
            duration: '0s',
            lastFailure: '—',
          },
        ]}
        busy={false}
        onRun={vi.fn()}
      />
    );

    expect(markup).toContain('src/checkout.ts');
    expect(markup).toContain('72.0');
    expect(markup).toContain('—');
    expect(markup).toContain('checkout.spec.ts');
    expect(markup).toContain('bun run test &amp;&amp; bun run test:coverage');
    expect(markup).toContain('Coverage Gate: PASS / target 80%');
    expect(markup).toContain('コマンド出力');
  });

  it('shows capability and run errors instead of an unqualified empty table', () => {
    const failedRun = { ...allRun, status: 'failed' as const, exitCode: 1, errorMessage: 'boom' };
    const markup = renderToStaticMarkup(
      <QualityReportPanel
        quality={{
          capabilities: {
            projectType: 'typescript',
            unit: runnableCapability,
            coverage: { runnable: false, missingCapabilities: ['coverage'] },
            e2e: runnableCapability,
            all: { runnable: false, missingCapabilities: ['coverage'] },
          },
          latestUnitRun: null,
          latestE2eRun: null,
          latestCoverageRun: null,
          latestE2eResultRun: failedRun,
          latestAllRun: failedRun,
          recentRuns: [failedRun],
          runningRuns: [],
        }}
        coverageRows={[]}
        e2eRows={[]}
        busy={false}
        onRun={vi.fn()}
      />
    );

    expect(markup).toContain('不足している capability: coverage');
    expect(markup).toContain('boom');
    expect(markup).toContain('exit 1');
  });
});

describe('coverageRowsFromSummary', () => {
  it('keeps total and file rows while preserving unknown metric values', () => {
    const rows = coverageRowsFromSummary({
      total: {
        statements: { pct: 90 },
        branches: { pct: 80 },
        functions: { pct: 85 },
        lines: { pct: 88 },
      },
      'src/b.ts': {
        statements: { pct: 70 },
        branches: { pct: 60 },
        functions: { pct: 75 },
        lines: { pct: 72 },
      },
      'src/a.ts': {
        statements: { pct: 71 },
        branches: {},
        functions: { pct: 76 },
        lines: { pct: 73 },
        uncoveredLines: [4, '8', { invalid: true }],
      },
    });

    expect(rows.map((row) => row.file)).toEqual(['total', 'src/a.ts', 'src/b.ts']);
    expect(rows[1].branches).toBeNull();
    expect(rows[1].uncovered).toBe('4, 8');
  });
});

describe('GoalEditorDialog', () => {
  it('renders compact single-select goal templates in the add dialog', () => {
    const markup = renderToStaticMarkup(
      <GoalEditorDialog
        draft={{ title: '', goalText: '', active: true }}
        busy={false}
        stackProfile={fullTemplateStack}
        onChange={vi.fn()}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />
    );

    for (const template of missionGoalTemplates) {
      expect(markup).toContain(template.title);
    }
    expect(markup.indexOf('テンプレート')).toBeLessThan(markup.indexOf('タイトル'));
    expect(markup).not.toContain('API Compatibility');
    expect(markup).not.toContain('Migration Safety');
    expect(markup).not.toContain('criteria');
  });

  it('shows a check icon for the selected template item', () => {
    const template = missionGoalTemplates[0];
    const markup = renderToStaticMarkup(
      <GoalEditorDialog
        draft={{ title: template.title, goalText: template.goalText, active: true }}
        busy={false}
        stackProfile={fullTemplateStack}
        onChange={vi.fn()}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />
    );

    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain('lucide-check');
  });

  it('filters templates that do not apply to the detected stack', () => {
    const backendOnlyStack = stackProfile([
      {
        name: 'Hono',
        category: 'backend',
        packageName: 'hono',
        version: '4.12.21',
        source: 'package_json',
        confidence: 'high',
      },
    ]);
    const templates = getMissionGoalTemplatesForStack(backendOnlyStack);

    expect(templates.map((template) => template.id)).toEqual([
      'coverage-budget',
      'performance-budget',
    ]);
    expect(
      templates.find((template) => template.id === 'performance-budget')?.goalText
    ).not.toContain('Web画面');
  });

  it('inserts one selected template body into the draft', () => {
    const performanceTemplate = missionGoalTemplates.find(
      (template) => template.id === 'performance-budget'
    );
    const i18nTemplate = missionGoalTemplates.find(
      (template) => template.id === 'i18n-dictionary-parity'
    );
    expect(performanceTemplate).toBeTruthy();
    expect(i18nTemplate).toBeTruthy();

    const firstDraft = applyMissionGoalTemplate(
      { title: '', goalText: '', active: true },
      performanceTemplate!
    );
    expect(firstDraft).toMatchObject({
      title: 'パフォーマンス維持',
      goalText: performanceTemplate!.goalText,
    });

    const nextDraft = applyMissionGoalTemplate(firstDraft, i18nTemplate!);
    expect(nextDraft).toMatchObject({
      title: 'i18n辞書同期',
      goalText: i18nTemplate!.goalText,
    });
  });

  it('preserves a custom title when a template body is inserted', () => {
    const template = missionGoalTemplates[0];
    const draft = applyMissionGoalTemplate(
      { title: 'Checkout Quality', goalText: '', active: true },
      template
    );

    expect(draft.title).toBe('Checkout Quality');
    expect(draft.goalText).toBe(template.goalText);
  });

  it('unselects the selected template and clears its inserted body', () => {
    const template = missionGoalTemplates[0];
    const selectedDraft = applyMissionGoalTemplate(
      { title: '', goalText: '', active: true },
      template
    );
    const clearedDraft = toggleMissionGoalTemplate(selectedDraft, template);

    expect(clearedDraft).toMatchObject({ title: '', goalText: '' });
  });

  it('keeps a custom title when unselecting an inserted template body', () => {
    const template = missionGoalTemplates[0];
    const clearedDraft = toggleMissionGoalTemplate(
      { title: 'Checkout Quality', goalText: template.goalText, active: true },
      template
    );

    expect(clearedDraft).toMatchObject({ title: 'Checkout Quality', goalText: '' });
  });
});
