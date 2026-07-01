import { describe, expect, it } from 'vitest';
import { parseDataModelOutput } from '../api/modules/dataModel/dataModel-generation.service';

describe('Data Model generation helpers', () => {
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
