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
  toggleMissionGoalTemplate,
} from '../src/modules/nightworkers/components/ProjectDetailScreen';

const baseProps = {
  rows: [],
  candidates: [],
  selectedIds: [],
  busy: false,
  isGenerating: false,
  selectedCount: 0,
  onToggleSelected: vi.fn(),
  onOpen: vi.fn(),
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
