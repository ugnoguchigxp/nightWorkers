import type { DataModelArtifact } from '../../../../shared/schemas/plan-mode-artifact.schema';

export const DATA_MODEL_PROMPT_VERSION = 'plan-mode-data-model-v1';

export function buildDataModelSystemPrompt(dataModelJsonSchema: string): string {
  return [
    '[SystemContext]',
    'あなたは NightWorkers の Data Model dedicated design view generator です。',
    'data_model は data structure view であり、Blueprint の一部ではありません。',
    'DB が実装対象なら DDL を canonicalSource として出力してください。',
    'DDL は実行指示ではなく設計 artifact です。migration 実行、runtime DB call、seed data 作成はしません。',
    'DDL から table / column / relation / index summary を派生させ、別正本を作らないでください。',
    'DB が実装対象でないなら JSON shape、TypeScript type、Zod schema、storage contract など最も近い正本を canonicalSource にしてください。',
    'AppBlueprint JSON は返さないでください。',
    '',
    '[Output Contract]',
    'JSON object だけを返してください。markdown、説明文、コードフェンスは不要です。',
    'JSON は下の [Data Model JSON Schema] に厳密に従ってください。',
    '',
    '[Data Model JSON Schema]',
    dataModelJsonSchema,
  ].join('\n');
}

export function buildDataModelUserPrompt(input: {
  task: string;
  featurePlan: string;
  questionnaire: string;
  blueprint: string;
  prompt: string;
}) {
  return [
    '次の context から data_model dedicated design view を1つ生成してください。',
    '',
    '## Task',
    input.task,
    '',
    '## Feature Plan',
    input.featurePlan,
    '',
    '## Questionnaire / Decisions',
    input.questionnaire,
    '',
    '## Blueprint Context',
    input.blueprint,
    '',
    '## User Prompt',
    input.prompt,
  ].join('\n');
}

export function renderDataModelArtifactMarkdown(artifact: DataModelArtifact) {
  const lines = [`# ${artifact.title}`, '', artifact.summary || 'Data Model artifact.', ''];
  lines.push(`Canonical source: \`${artifact.canonicalSource}\``);
  if (artifact.ddl?.trim()) {
    lines.push('', '## DDL', '', '```sql', artifact.ddl.trim(), '```');
  }
  lines.push('', '## Derived Tables');
  if (artifact.derivedTables.length === 0) lines.push('- None.');
  for (const table of artifact.derivedTables) {
    lines.push(`- ${table.name}: ${table.purpose}`);
    for (const column of table.columns) {
      const flags = [
        column.nullable ? 'nullable' : 'not null',
        column.primaryKey ? 'primary key' : null,
        column.unique ? 'unique' : null,
        column.defaultValue ? `default ${column.defaultValue}` : null,
      ].filter(Boolean);
      lines.push(
        `  - ${column.name}: ${column.type}${flags.length ? ` (${flags.join(', ')})` : ''}`
      );
    }
    if (table.indexes.length > 0) lines.push(`  - indexes: ${table.indexes.join('; ')}`);
  }
  lines.push('', '## Relations');
  if (artifact.relations.length === 0) lines.push('- None.');
  for (const relation of artifact.relations) {
    lines.push(
      `- ${relation.from} -> ${relation.to} (${relation.cardinality}): ${relation.reason}`
    );
  }
  lines.push('', '## Constraints');
  if (artifact.constraints.length === 0) lines.push('- None.');
  for (const constraint of artifact.constraints) lines.push(`- ${constraint}`);
  lines.push('', '## Open Questions');
  if (artifact.openQuestions.length === 0) lines.push('- None.');
  for (const question of artifact.openQuestions) lines.push(`- ${question}`);
  return lines.join('\n');
}
