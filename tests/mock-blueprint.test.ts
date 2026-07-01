import crypto from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { ensureNightWorkersSchema } from '../api/db/bootstrap';
import * as repo from '../api/modules/nightworkers/nightworkers.repository';
import { renderMockBlueprintMarkdown } from '../api/services/blueprints/mock-draft';
import { generatePlanModeMockBlueprintDraft } from '../api/services/blueprints/mock-llm-draft';
import {
  buildMockBlueprintSectionCatalog,
  buildMockBlueprintStructuredOutputJsonSchema,
  buildMockBlueprintSystemPrompt,
} from '../api/services/structured-generation/prompts/mock-blueprint';
import {
  getMockBlueprintDatasetKindsForSection,
  mockBlueprintSchema,
  renderableMockBlueprintSectionNames,
} from '../shared/schemas/mock-blueprint.schema';
import {
  mockBlueprintToPreviewBlueprint,
  mockBlueprintToPreviewBlueprintSafely,
} from '../src/modules/blueprint-preview/mockBlueprintAdapter';
import { representativeMockBlueprint } from './fixtures/mock-blueprint';

beforeAll(async () => {
  await ensureNightWorkersSchema();
});

describe('Mock Blueprint', () => {
  it('validates renderable section selections and compatible mock datasets', () => {
    const parsed = mockBlueprintSchema.parse(representativeMockBlueprint);

    expect(parsed.artifactKind).toBe('mock_blueprint');
    for (const screen of parsed.screens) {
      for (const section of screen.sections) {
        expect(renderableMockBlueprintSectionNames).toContain(section.componentName);
        expect(getMockBlueprintDatasetKindsForSection(section.componentName)).toContain(
          section.dataset.kind
        );
      }
    }
  });

  it('rejects incompatible section and dataset combinations', () => {
    expect(() =>
      mockBlueprintSchema.parse({
        ...representativeMockBlueprint,
        screens: [
          {
            ...representativeMockBlueprint.screens[0],
            sections: [
              {
                ...representativeMockBlueprint.screens[0].sections[0],
                componentName: 'DataTableSection',
                dataset: { kind: 'navigation', items: [{ label: 'Queue' }] },
              },
            ],
          },
        ],
      })
    ).toThrow(/does not support navigation/);
  });

  it('accepts natural mock data keys and scalar row values', () => {
    const parsed = mockBlueprintSchema.parse({
      ...representativeMockBlueprint,
      screens: [
        {
          ...representativeMockBlueprint.screens[0],
          sections: [
            {
              ...representativeMockBlueprint.screens[0].sections[2],
              dataset: {
                kind: 'table',
                columns: [
                  { key: 'due_date', label: 'Due Date' },
                  { key: 'riskScore', label: 'Risk Score' },
                  { key: 'blocked', label: 'Blocked' },
                ],
                rows: [{ due_date: '2026-07-02', riskScore: 7, blocked: false }],
              },
            },
          ],
        },
      ],
    });

    expect(parsed.screens[0].sections[0].dataset).toMatchObject({
      kind: 'table',
      rows: [expect.objectContaining({ riskScore: 7, blocked: false })],
    });
  });

  it('adapts mock datasets into the existing Blueprint preview model', () => {
    const preview = mockBlueprintToPreviewBlueprint(representativeMockBlueprint);
    const screen = preview.screens[0];
    const sections = Array.isArray(screen.sections) ? screen.sections : [];

    expect(preview).toMatchObject({
      id: representativeMockBlueprint.id,
      name: representativeMockBlueprint.name,
      version: 1,
    });
    expect(sections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          componentName: 'DataTableSection',
          props: expect.objectContaining({
            columns: expect.any(Array),
            rows: expect.any(Array),
          }),
        }),
      ])
    );
  });

  it('drops empty sidebar layouts when mock sections do not need side columns', () => {
    const preview = mockBlueprintToPreviewBlueprint({
      ...representativeMockBlueprint,
      screens: [
        {
          ...representativeMockBlueprint.screens[0],
          layout: { template: 'sidebar_right' },
          sections: representativeMockBlueprint.screens[0].sections
            .filter((section) => section.region !== 'sidebar')
            .map((section) => ({ ...section, region: 'main' })),
        },
      ],
    });

    expect(preview.screens[0].layout).toEqual({ template: 'single_column' });
  });

  it('returns null instead of throwing for invalid preview input', () => {
    expect(
      mockBlueprintToPreviewBlueprintSafely({
        artifactKind: 'mock_blueprint',
        id: 'broken',
        name: 'Broken',
        version: 1,
      })
    ).toBeNull();
  });

  it('renders markdown without AppBlueprint implementation-heavy sections', () => {
    const markdown = renderMockBlueprintMarkdown(representativeMockBlueprint);

    expect(markdown).toContain('# Operations Mock Console');
    expect(markdown).toContain('DataTableSection');
    expect(markdown).toContain('Dataset: `table`');
    expect(markdown).not.toContain('## Data Model');
    expect(markdown).not.toContain('## Implementation Tasks');
  });

  it('keeps the prompt schema compact while exposing the section allowlist', () => {
    const schema = buildMockBlueprintStructuredOutputJsonSchema();
    const prompt = buildMockBlueprintSystemPrompt({
      jsonSchema: schema,
      sectionCatalog: buildMockBlueprintSectionCatalog(),
    });

    expect(prompt).toContain('DataTableSection');
    expect(prompt).toContain('dataset.kind');
    expect(Buffer.byteLength(JSON.stringify(schema), 'utf8')).toBeLessThan(10_000);
  });

  it('discourages generic sidebar placeholders in mock blueprint selection', () => {
    const prompt = buildMockBlueprintSystemPrompt({
      jsonSchema: buildMockBlueprintStructuredOutputJsonSchema(),
      sectionCatalog: buildMockBlueprintSectionCatalog(),
    });

    expect(prompt).toContain('BBS');
    expect(prompt).toContain('明示要求がない限り右/左 sidebar は使わない');
    expect(prompt).toContain('ads、sponsored、newsletter');
  });

  it('lists every strict object property in required for structured output compatibility', () => {
    const schema = buildMockBlueprintStructuredOutputJsonSchema();

    expectStrictRequiredProperties(schema);
  });

  it('uses the fixture LLM provider to build and validate mock JSON', async () => {
    const originalProvider = process.env.ACTIVE_LLM_PROVIDER;
    const originalFixture = process.env.SUPERVISOR_FIXTURE_OUTPUT;
    const originalSettingsPath = process.env.NIGHTWORKERS_LLM_SETTINGS_PATH;
    process.env.NIGHTWORKERS_LLM_SETTINGS_PATH = `/tmp/nightworkers-test-llm-settings-${crypto.randomUUID()}.json`;
    process.env.ACTIVE_LLM_PROVIDER = 'fixture';
    process.env.SUPERVISOR_FIXTURE_OUTPUT = JSON.stringify(representativeMockBlueprint);

    try {
      const repository = await repo.createRepository({
        name: `TEST: Mock Blueprint ${crypto.randomUUID()}`,
        localPath: '/Users/y.noguchi/Code/nightWorkers',
        branch: 'main',
      });
      const task = await repo.createTask({
        repositoryId: repository.id,
        title: 'TEST: Mock Blueprint fixture task',
        description: 'Validate mock blueprint fixture generation.',
        status: 'draft',
      });
      const result = await generatePlanModeMockBlueprintDraft({
        taskId: task.id,
        title: 'Operations Mock',
        prompt: '運用レビュー用の軽量 mock を作る',
      });

      expect(result.mockBlueprint).toMatchObject({
        artifactKind: 'mock_blueprint',
        name: representativeMockBlueprint.name,
      });
      expect(result.generation.promptDiagnostics.schemaName).toBe('mock_blueprint');
      expect(result.generation.promptDiagnostics.sectionAllowlistCount).toBeGreaterThan(10);
    } finally {
      if (originalProvider === undefined) delete process.env.ACTIVE_LLM_PROVIDER;
      else process.env.ACTIVE_LLM_PROVIDER = originalProvider;
      if (originalFixture === undefined) delete process.env.SUPERVISOR_FIXTURE_OUTPUT;
      else process.env.SUPERVISOR_FIXTURE_OUTPUT = originalFixture;
      if (originalSettingsPath === undefined) delete process.env.NIGHTWORKERS_LLM_SETTINGS_PATH;
      else process.env.NIGHTWORKERS_LLM_SETTINGS_PATH = originalSettingsPath;
    }
  });

  it('normalizes common LLM dataset aliases before schema validation', async () => {
    const originalProvider = process.env.ACTIVE_LLM_PROVIDER;
    const originalFixture = process.env.SUPERVISOR_FIXTURE_OUTPUT;
    const originalSettingsPath = process.env.NIGHTWORKERS_LLM_SETTINGS_PATH;
    process.env.NIGHTWORKERS_LLM_SETTINGS_PATH = `/tmp/nightworkers-test-llm-settings-${crypto.randomUUID()}.json`;
    process.env.ACTIVE_LLM_PROVIDER = 'fixture';
    process.env.SUPERVISOR_FIXTURE_OUTPUT = JSON.stringify({
      ...representativeMockBlueprint,
      screens: [
        {
          ...representativeMockBlueprint.screens[0],
          sections: [
            {
              ...representativeMockBlueprint.screens[0].sections[1],
              componentName: 'ControlPanelSection',
              dataset: {
                kind: 'cards',
                items: [
                  { title: '検索', summary: 'キーワードで探す', meta: '全文検索' },
                  { title: '状態', summary: '公開中・削除済みを確認', meta: 'status' },
                ],
              },
            },
            {
              ...representativeMockBlueprint.screens[0].sections[2],
              componentName: 'FormSection',
              dataset: {
                kind: 'form',
                fields: [
                  {
                    name: 'body',
                    label: '本文',
                    type: 'textarea',
                    required: true,
                    placeholder: '返信内容を入力',
                  },
                ],
                submitLabel: '返信を投稿',
              },
            },
            {
              id: 'activity',
              name: '返信履歴',
              componentName: 'TimelineSection',
              region: 'main',
              selectionReason: '時系列の返信を確認するため。',
              copy: {
                title: '返信履歴',
                description: '返信を時系列で確認します。',
              },
              dataset: {
                kind: 'timeline',
                items: [
                  {
                    title: '返信 #1',
                    timestamp: '2026-07-02 09:30',
                    status: 'active',
                    summary: '最初の返信です。',
                  },
                ],
              },
            },
            {
              id: 'article',
              name: 'スレッド本文',
              componentName: 'BlogPostSection',
              region: 'main',
              selectionReason: '本文を読むため。',
              copy: {
                title: 'お知らせ',
                description: '本文を表示します。',
              },
              dataset: {
                kind: 'article',
                title: 'お知らせ',
                author: 'admin',
                publishedAt: '2026-07-02 09:10',
                body: 'このBBSは最小構成で運用します。',
              },
            },
          ],
        },
      ],
    });

    try {
      const repository = await repo.createRepository({
        name: `TEST: Mock Blueprint Alias ${crypto.randomUUID()}`,
        localPath: '/Users/y.noguchi/Code/nightWorkers',
        branch: 'main',
      });
      const task = await repo.createTask({
        repositoryId: repository.id,
        title: 'TEST: Mock Blueprint alias task',
        description: 'Validate mock blueprint alias normalization.',
        status: 'draft',
      });
      const result = await generatePlanModeMockBlueprintDraft({
        taskId: task.id,
        title: 'Operations Mock',
        prompt: 'BBS の軽量 mock を作る',
      });
      const sections = result.mockBlueprint.screens[0].sections;

      expect(sections[0].dataset).toMatchObject({
        kind: 'cards',
        cards: expect.arrayContaining([
          expect.objectContaining({ description: 'キーワードで探す' }),
        ]),
      });
      expect(sections[1].dataset).toMatchObject({
        kind: 'form',
        fields: [expect.not.objectContaining({ required: true })],
      });
      expect(sections[2].dataset).toMatchObject({
        kind: 'timeline',
        items: [expect.objectContaining({ description: '最初の返信です。' })],
      });
      expect(sections[3].dataset).toMatchObject({
        kind: 'article',
        meta: expect.arrayContaining([
          expect.objectContaining({ label: 'author', value: 'admin' }),
        ]),
      });
    } finally {
      if (originalProvider === undefined) delete process.env.ACTIVE_LLM_PROVIDER;
      else process.env.ACTIVE_LLM_PROVIDER = originalProvider;
      if (originalFixture === undefined) delete process.env.SUPERVISOR_FIXTURE_OUTPUT;
      else process.env.SUPERVISOR_FIXTURE_OUTPUT = originalFixture;
      if (originalSettingsPath === undefined) delete process.env.NIGHTWORKERS_LLM_SETTINGS_PATH;
      else process.env.NIGHTWORKERS_LLM_SETTINGS_PATH = originalSettingsPath;
    }
  });
});

function expectStrictRequiredProperties(schema: unknown) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return;
  const record = schema as Record<string, unknown>;
  if (record.additionalProperties === false && isRecord(record.properties)) {
    const required = Array.isArray(record.required) ? record.required.map(String) : [];
    expect(required.sort()).toEqual(Object.keys(record.properties).sort());
  }
  for (const value of Object.values(record)) {
    if (Array.isArray(value)) {
      for (const item of value) expectStrictRequiredProperties(item);
    } else {
      expectStrictRequiredProperties(value);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
