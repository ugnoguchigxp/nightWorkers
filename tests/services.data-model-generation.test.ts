import { describe, expect, it } from 'vitest';
import {
  buildDataModelResponseJsonSchema,
  parseDataModelOutput,
} from '../api/modules/dataModel/dataModel-generation.service';
import {
  buildDataModelSystemPrompt,
  renderDataModelArtifactMarkdown,
} from '../api/services/structured-generation/prompts/data-model';

describe('Data Model generation helpers', () => {
  it('builds a structured-output compatible Data Model response schema', () => {
    const schema = buildDataModelResponseJsonSchema();
    expect(JSON.stringify(schema)).not.toContain('"$schema"');
    expect(JSON.stringify(schema)).not.toContain('"default"');
    expectAllObjectPropertiesRequired(schema);

    const root = asRecord(schema);
    expect(root.required).toContain('ddl');
    const derivedTables = asRecord(asRecord(root.properties).derivedTables);
    const table = asRecord(derivedTables.items);
    const columns = asRecord(asRecord(table.properties).columns);
    const column = asRecord(columns.items);
    expect(column.required).toEqual([
      'name',
      'type',
      'nullable',
      'primaryKey',
      'unique',
      'defaultValue',
    ]);
  });

  it('parses DDL-backed Data Model artifacts', () => {
    const artifact = parseDataModelOutput(
      JSON.stringify({
        artifactKind: 'plan_mode_dedicated_view',
        view: 'data_model',
        title: 'Todo Data Model',
        summary: 'Todo persistence model.',
        canonicalSource: 'ddl',
        ddl: 'CREATE TABLE todos (id TEXT PRIMARY KEY, title TEXT NOT NULL);',
        derivedTables: [
          {
            name: 'todos',
            purpose: 'Stores Todo records.',
            columns: [
              { name: 'id', type: 'TEXT', nullable: false, primaryKey: true },
              { name: 'title', type: 'TEXT', nullable: false },
            ],
            indexes: [],
          },
        ],
        relations: [],
        constraints: ['title is required'],
        openQuestions: [],
      })
    );

    expect(artifact.canonicalSource).toBe('ddl');
    expect(artifact.ddl).toContain('CREATE TABLE todos');
    expect(artifact.derivedTables[0]?.name).toBe('todos');
  });

  it('keeps generated Data Model Markdown focused on DDL and relations', () => {
    const markdown = renderDataModelArtifactMarkdown({
      artifactKind: 'plan_mode_dedicated_view',
      view: 'data_model',
      title: 'Todo Data Model',
      summary: 'Todo persistence model.',
      canonicalSource: 'ddl',
      ddl: 'CREATE TABLE todos (id TEXT PRIMARY KEY);',
      derivedTables: [
        {
          name: 'todos',
          purpose: 'Stores Todo records.',
          columns: [{ name: 'id', type: 'TEXT', nullable: false, primaryKey: true }],
          indexes: [],
        },
      ],
      relations: [],
      constraints: ['title is required'],
      openQuestions: ['Should title be unique?'],
    });

    expect(markdown).toContain('## DDL');
    expect(markdown).toContain('## Derived Tables');
    expect(markdown).not.toContain('## Constraints');
    expect(markdown).not.toContain('## Open Questions');
    expect(markdown).not.toContain('Should title be unique?');
  });

  it('instructs Data Model generation to avoid non-blocking open questions', () => {
    const prompt = buildDataModelSystemPrompt('{}');

    expect(prompt).toContain('SQLite trigger');
    expect(prompt).toContain('open question にしない');
    expect(prompt).toContain('Questionnaire / Decisions');
    expect(prompt).toContain('通常は空配列');
  });

  it('parses non-DB structure contracts without DDL', () => {
    const artifact = parseDataModelOutput(
      JSON.stringify({
        artifactKind: 'plan_mode_dedicated_view',
        view: 'data_model',
        title: 'Provider Payload',
        canonicalSource: 'json_shape',
        derivedTables: [],
        relations: [],
        constraints: ['No runtime DB migration is required.'],
        openQuestions: [],
      })
    );

    expect(artifact.canonicalSource).toBe('json_shape');
    expect(artifact.ddl).toBeUndefined();
  });

  it('rejects DDL-backed artifacts without DDL text', () => {
    expect(() =>
      parseDataModelOutput(
        JSON.stringify({
          artifactKind: 'plan_mode_dedicated_view',
          view: 'data_model',
          title: 'Invalid Data Model',
          canonicalSource: 'ddl',
          derivedTables: [],
          relations: [],
          constraints: [],
          openQuestions: [],
        })
      )
    ).toThrow('must include ddl');
  });
});

function expectAllObjectPropertiesRequired(schema: unknown, path = 'schema') {
  if (Array.isArray(schema)) {
    schema.forEach((item, index) => {
      expectAllObjectPropertiesRequired(item, `${path}.${index}`);
    });
    return;
  }
  if (!schema || typeof schema !== 'object') return;

  const node = schema as Record<string, unknown>;
  if (node.type === 'object' && node.properties && typeof node.properties === 'object') {
    expect(node.additionalProperties, `${path}.additionalProperties`).toBe(false);
    expect(node.required, `${path}.required`).toEqual(Object.keys(node.properties));
  }
  for (const [key, value] of Object.entries(node)) {
    expectAllObjectPropertiesRequired(value, `${path}.${key}`);
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  expect(value).toBeTruthy();
  expect(typeof value).toBe('object');
  expect(Array.isArray(value)).toBe(false);
  return value as Record<string, unknown>;
}
