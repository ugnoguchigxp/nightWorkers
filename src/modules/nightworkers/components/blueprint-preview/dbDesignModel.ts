export type BlueprintDbDesignTarget =
  | { kind: 'schema' }
  | { kind: 'table'; tableName: string }
  | { kind: 'relation'; relationId: string };

export type BlueprintDbDesignRequest = {
  blueprintId: string;
  target: BlueprintDbDesignTarget;
  prompt: string;
  currentBlueprint: Record<string, unknown>;
  validationIssues: Array<Record<string, unknown>>;
};

export function targetLabel(target: BlueprintDbDesignTarget): string {
  if (target.kind === 'schema') return 'Schema';
  if (target.kind === 'table') return `Table ${target.tableName}`;
  return `Relation ${target.relationId}`;
}

export function buildBlueprintDbDesignPrompt(request: BlueprintDbDesignRequest): string {
  return [
    'Blueprint DB Design request',
    '',
    `Target: ${targetLabel(request.target)}`,
    `Instruction: ${request.prompt}`,
    '',
    '```json blueprint-db-design-request',
    JSON.stringify(request, null, 2),
    '```',
  ].join('\n');
}

export function relationsForTable(
  tableName: string,
  relations: Array<Record<string, unknown>>
): Array<Record<string, unknown>> {
  return relations.filter(
    (relation) => relation.fromTable === tableName || relation.toTable === tableName
  );
}

export function columnsForTable(table: Record<string, unknown>): Array<Record<string, unknown>> {
  return Array.isArray(table.columns)
    ? table.columns.filter((column): column is Record<string, unknown> =>
        Boolean(column && typeof column === 'object' && !Array.isArray(column))
      )
    : [];
}

export function toRecordArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> =>
        Boolean(item && typeof item === 'object' && !Array.isArray(item))
      )
    : [];
}
