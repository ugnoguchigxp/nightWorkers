import { stringValue, toRecordArray } from './record-utils';

type RelationEdge = {
  from: string;
  to: string;
  cardinality: string;
  reason: string;
};

export function buildMermaidErDiagram(
  tables: Array<Record<string, unknown>>,
  relations: Array<Record<string, unknown>>
) {
  const relationEdges = relations
    .map(toRelationEdge)
    .filter((edge): edge is RelationEdge => Boolean(edge));
  const tableNames = tables.map((table, index) => stringValue(table.name) || `table_${index + 1}`);
  const entityByTableName = new Map(
    tableNames.map((tableName) => [tableName, sanitizeMermaidIdentifier(tableName)])
  );
  const lines = ['erDiagram'];

  tables.forEach((table, index) => {
    const tableName = tableNames[index] || `table_${index + 1}`;
    const entityName = entityByTableName.get(tableName) || sanitizeMermaidIdentifier(tableName);
    const columns = toRecordArray(table.columns);
    lines.push(`  ${entityName} {`);
    if (columns.length === 0) {
      lines.push('    string no_columns');
    }
    columns.forEach((column, columnIndex) => {
      const columnName = stringValue(column.name) || `column_${columnIndex + 1}`;
      const type = sanitizeMermaidType(stringValue(column.type) || 'string');
      const keys = mermaidColumnKeys(tableName, column, relationEdges);
      const comment = mermaidColumnComment(column);
      lines.push(
        `    ${sanitizeMermaidIdentifier(columnName)} ${type}${keys ? ` ${keys}` : ''}${
          comment ? ` "${comment}"` : ''
        }`
      );
    });
    lines.push('  }');
  });

  relationEdges.forEach((relation) => {
    const fromTable = splitRelationEndpoint(relation.from)[0];
    const toTable = splitRelationEndpoint(relation.to)[0];
    const fromEntity = entityByTableName.get(fromTable) || sanitizeMermaidIdentifier(fromTable);
    const toEntity = entityByTableName.get(toTable) || sanitizeMermaidIdentifier(toTable);
    if (!fromEntity || !toEntity) return;
    lines.push(
      `  ${fromEntity} ${mermaidCardinality(relation.cardinality)} ${toEntity} : ${sanitizeMermaidLabel(
        relation.reason || 'relates'
      )}`
    );
  });

  return lines.join('\n');
}

function toRelationEdge(relation: Record<string, unknown>): RelationEdge | null {
  const from = stringValue(relation.from);
  const to = stringValue(relation.to);
  if (!from || !to) return null;
  return {
    from,
    to,
    cardinality: stringValue(relation.cardinality),
    reason: stringValue(relation.reason),
  };
}

function mermaidColumnKeys(
  tableName: string,
  column: Record<string, unknown>,
  relations: RelationEdge[]
) {
  const flags = [];
  const columnName = stringValue(column.name);
  if (column.primaryKey === true) flags.push('PK');
  if (isForeignKeyColumn(tableName, columnName, relations)) flags.push('FK');
  if (column.unique === true) flags.push('UK');
  return flags.join(', ');
}

function mermaidColumnComment(column: Record<string, unknown>) {
  const notes = [];
  if (column.nullable === false) notes.push('not null');
  const defaultValue = stringValue(column.defaultValue);
  if (defaultValue) notes.push(`default ${defaultValue}`);
  return notes.join(', ');
}

function isForeignKeyColumn(tableName: string, columnName: string, relations: RelationEdge[]) {
  if (!columnName) return false;
  return relations.some((relation) => {
    return endpointMatchesColumn(relation.from, tableName, columnName);
  });
}

function endpointMatchesColumn(endpoint: string, tableName: string, columnName: string) {
  const [endpointTable, endpointColumn] = splitRelationEndpoint(endpoint);
  if (!endpointColumn) return false;
  return endpointTable === tableName && endpointColumn === columnName;
}

function splitRelationEndpoint(endpoint: string) {
  const trimmed = endpoint.trim();
  const dotIndex = trimmed.lastIndexOf('.');
  if (dotIndex > 0 && dotIndex < trimmed.length - 1) {
    return [trimmed.slice(0, dotIndex), trimmed.slice(dotIndex + 1)] as const;
  }
  return [trimmed, ''] as const;
}

function mermaidCardinality(value: string) {
  const labels: Record<string, string> = {
    one_to_one: '||--||',
    one_to_many: '||--o{',
    many_to_one: '}o--||',
    many_to_many: '}o--o{',
  };
  return labels[value] || '--';
}

function sanitizeMermaidIdentifier(value: string) {
  const sanitized = value
    .trim()
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/^([0-9])/, '_$1')
    .replace(/_+/g, '_');
  return sanitized || 'unnamed';
}

function sanitizeMermaidType(value: string) {
  const sanitized = value
    .trim()
    .split(/\s+/)[0]
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/^([0-9])/, 't_$1')
    .replace(/_+/g, '_');
  return sanitized || 'string';
}

function sanitizeMermaidLabel(value: string) {
  const label =
    value.replace(/["`:]/g, ' ').replace(/\s+/g, ' ').trim().split(' ').slice(0, 10).join(' ') ||
    'relates';
  return `"${label}"`;
}
