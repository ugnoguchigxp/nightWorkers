import { blueprintSectionReference } from './blueprint-section-reference';
import type {
  BlueprintComponentDefinition,
  BlueprintComponentName,
  BlueprintDataSourceKind,
} from './schemas/blueprint-catalog.schema';

const blueprintPageCatalog: BlueprintComponentDefinition[] = [
  component('DashboardPage', 'page', ['none', 'app']),
  component('EntityListPage', 'page', ['none', 'app']),
  component('EntityDetailPage', 'page', ['none', 'app', 'record']),
  component('EditableFormPage', 'page', ['none', 'app']),
  component('ArticleFeedPage', 'page', ['none', 'app']),
  component('SidebarPage', 'page', ['none', 'app']),
  component('ListPage', 'page', ['none', 'app']),
  component('DetailPage', 'page', ['none', 'app', 'record']),
  component('FormPage', 'page', ['none', 'app']),
];

const blueprintSectionCatalog: BlueprintComponentDefinition[] = blueprintSectionReference.map(
  (entry) => component(entry.name, 'section', entry.allowedSources, entry.variants)
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
  variants: string[] = ['default']
): BlueprintComponentDefinition {
  return {
    name,
    placement,
    allowedSources,
    variants,
  };
}
