export type BlueprintDbDesignTarget =
  | { kind: 'schema' }
  | { kind: 'table'; tableName: string }
  | { kind: 'relation'; relationId: string }
  | { kind: 'binding'; bindingId: string }
  | { kind: 'screen'; screenId: string; sectionId?: string };

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
  if (target.kind === 'relation') return `Relation ${target.relationId}`;
  if (target.kind === 'binding') return `Binding ${target.bindingId}`;
  if (target.sectionId) return `Screen ${target.screenId} / section ${target.sectionId}`;
  return `Screen ${target.screenId}`;
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

export function bindingCountForTable(
  tableName: string,
  bindings: Array<Record<string, unknown>>
): number {
  return bindings.filter((binding) => binding.table === tableName).length;
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
