import type { AppBlueprint } from '../../../shared/schemas/app-blueprint.schema';

export function renderBlueprintMarkdown(blueprint: AppBlueprint): string {
  const sections = blueprint.screens.flatMap((screen) =>
    screen.sections.map((section) => `- ${screen.name} / ${section.name}: ${section.componentName}`)
  );
  const tables = blueprint.databaseSchema.tables.map(
    (table) => `- ${table.name}: ${table.columns.map((column) => column.name).join(', ')}`
  );
  return [
    `# ${blueprint.name}`,
    '',
    '## Blueprint Summary',
    blueprint.description || '',
    '',
    '## Screens',
    ...sections,
    '',
    '## Data Model',
    ...tables,
  ].join('\n');
}
