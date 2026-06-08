import type { AppBlueprint } from '../../../shared/schemas/app-blueprint.schema';

export function renderBlueprintMarkdown(blueprint: AppBlueprint): string {
  const screens = blueprint.screens.flatMap((screen) => [
    `### ${screen.name}`,
    '',
    `- Path: \`${screen.path}\``,
    `- Component: \`${screen.componentName}\``,
    ...screen.sections.flatMap((section) => [
      `- Section: ${sectionTitle(section)} (${sectionContractLabel(section)})`,
      ...sectionIntentLines(section),
      ...summarizeProps('props' in section ? section.props : {}).map((line) => `  - ${line}`),
      ...summarizeComposition(section).map((line) => `  - ${line}`),
    ]),
    ...(screen.actions.length > 0
      ? [
          '- Screen actions:',
          ...screen.actions.map((action) => `  - ${action.label}: ${action.type}`),
        ]
      : []),
    '',
  ]);
  const tasks = blueprint.implementationTasks.map(
    (task) =>
      `- ${task.title}: ${task.description} (${task.affectedDomains.map((domain) => `\`${domain}\``).join(', ')})`
  );
  const hooks = blueprint.learningHooks.map((hook) => `- ${hook.trigger}: ${hook.note}`);
  return [
    `# ${blueprint.name}`,
    '',
    '## Blueprint Summary',
    blueprint.description || '',
    '',
    '## Design Direction',
    `- Preset: ${blueprint.designPreset.name}`,
    `- Theme: ${blueprint.designPreset.theme}`,
    `- Density: ${blueprint.designPreset.density}`,
    `- Motion: ${blueprint.designPreset.motion}`,
    '',
    '## Screen Composition',
    ...screens,
    '',
    '## Implementation Tasks',
    ...(tasks.length > 0 ? tasks : ['- No implementation tasks defined.']),
    ...(hooks.length > 0 ? ['', '## Learning Hooks', ...hooks] : []),
  ].join('\n');
}

function sectionTitle(section: AppBlueprint['screens'][number]['sections'][number]): string {
  return String(
    ('name' in section && section.name) ||
      ('title' in section && section.title) ||
      section.id ||
      'Section'
  );
}

function sectionContractLabel(
  section: AppBlueprint['screens'][number]['sections'][number]
): string {
  if (section.kind === 'preset_section') return `preset: \`${section.preset}\``;
  if (section.kind === 'custom_section') return '`custom_section`';
  return `\`${section.componentName}\`, source: \`${section.source}\`${section.dataBindingId ? `, binding: \`${section.dataBindingId}\`` : ''}`;
}

function sectionIntentLines(
  section: AppBlueprint['screens'][number]['sections'][number]
): string[] {
  if (section.kind === 'preset_section' || section.kind === 'custom_section') return [];
  return [
    ...(section.intent ? [`  - Intent: ${section.intent}`] : []),
    ...(section.visualIntent ? [`  - Visual: ${section.visualIntent}`] : []),
  ];
}

function summarizeComposition(
  section: AppBlueprint['screens'][number]['sections'][number]
): string[] {
  if (section.kind === 'preset_section') {
    return section.overrides.length > 0
      ? [
          `Overrides: ${section.overrides
            .slice(0, 4)
            .map((override) => override.target)
            .join(', ')}`,
        ]
      : [];
  }
  if (section.kind === 'custom_section') {
    return [`Root: ${summarizeNode(section.root)}`];
  }
  return [];
}

function summarizeNode(node: unknown): string {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return 'unknown';
  const record = node as Record<string, unknown>;
  const kind = stringValue(record.kind) || 'node';
  const id = stringValue(record.id);
  const component = stringValue(record.component);
  const layout = stringValue(record.layout);
  const children = arrayValue(record.children)?.length || 0;
  return [
    kind,
    id ? `#${id}` : '',
    component || layout ? `(${component || layout})` : '',
    `${children} children`,
  ]
    .filter(Boolean)
    .join(' ');
}

function summarizeProps(props: Record<string, unknown>): string[] {
  const lines: string[] = [];
  const title = stringValue(props.title);
  const description = stringValue(props.description);
  if (title) lines.push(`Preview title: ${title}`);
  if (description) lines.push(`Preview description: ${description}`);

  const list = arrayValue(props.items) || arrayValue(props.data) || arrayValue(props.rows);
  if (list?.length) {
    const sample = list
      .slice(0, 3)
      .map((item, index) => summarizePropItem(item, index))
      .filter(Boolean)
      .join(' / ');
    if (sample) lines.push(`Preview sample: ${sample}`);
  }

  const columns = arrayValue(props.columns);
  if (columns?.length) {
    const labels = columns
      .slice(0, 6)
      .map((column, index) =>
        typeof column === 'object' && column
          ? stringValue((column as Record<string, unknown>).label) ||
            stringValue((column as Record<string, unknown>).name) ||
            stringValue((column as Record<string, unknown>).key) ||
            `Column ${index + 1}`
          : String(column)
      );
    lines.push(`Preview columns: ${labels.join(', ')}`);
  }

  return lines;
}

function summarizePropItem(item: unknown, index: number): string {
  if (!item || typeof item !== 'object') return String(item || '');
  const record = item as Record<string, unknown>;
  const label =
    stringValue(record.label) ||
    stringValue(record.title) ||
    stringValue(record.name) ||
    stringValue(record.actor) ||
    `Item ${index + 1}`;
  const value =
    stringValue(record.value) ||
    stringValue(record.status) ||
    stringValue(record.action) ||
    stringValue(record.description);
  return value ? `${label}: ${value}` : label;
}

function arrayValue(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}
