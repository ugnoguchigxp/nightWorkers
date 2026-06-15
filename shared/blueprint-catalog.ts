import { blueprintSectionReference } from './blueprint-section-reference';
import type {
  BlueprintComponentDefinition,
  BlueprintComponentName,
  BlueprintDataSourceKind,
} from './schemas/blueprint-catalog.schema';

const blueprintPageCatalog: BlueprintComponentDefinition[] = [
  component('DashboardPage', 'page', ['none', 'app'], 'Dashboard page shell.'),
  component('EntityListPage', 'page', ['none', 'app'], 'Entity list page shell.'),
  component('EntityDetailPage', 'page', ['none', 'app', 'record'], 'Entity detail page shell.'),
  component('EditableFormPage', 'page', ['none', 'app'], 'Editable form page shell.'),
  component('ArticleFeedPage', 'page', ['none', 'app'], 'Article feed page shell.'),
  component('SidebarPage', 'page', ['none', 'app'], 'Page shell with persistent navigation.'),
  component('ListPage', 'page', ['none', 'app'], 'Legacy alias for entity collection browsing.'),
  component('DetailPage', 'page', ['none', 'app', 'record'], 'Legacy alias for record inspection.'),
  component('FormPage', 'page', ['none', 'app'], 'Legacy alias for create or edit flows.'),
];

const blueprintSectionCatalog: BlueprintComponentDefinition[] = blueprintSectionReference.map(
  (entry) =>
    component(entry.name, 'section', entry.allowedSources, entry.promptGuidance, entry.variants)
);

export const blueprintCatalog: BlueprintComponentDefinition[] = [
  ...blueprintPageCatalog,
  ...blueprintSectionCatalog,
];

export const blueprintCatalogByName = new Map(
  blueprintCatalog.map((definition) => [definition.name, definition])
);

export function getBlueprintComponentDefinition(name: string) {
  return blueprintCatalogByName.get(name as BlueprintComponentName) || null;
}

export function isAllowedBlueprintSource(name: string, source: BlueprintDataSourceKind): boolean {
  const definition = getBlueprintComponentDefinition(name);
  return Boolean(definition?.allowedSources.includes(source));
}

function component(
  name: BlueprintComponentName,
  placement: BlueprintComponentDefinition['placement'],
  allowedSources: BlueprintDataSourceKind[],
  promptGuidance: string,
  variants: string[] = ['default']
): BlueprintComponentDefinition {
  return {
    name,
    placement,
    allowedSources,
    variants,
    promptGuidance,
  };
}
