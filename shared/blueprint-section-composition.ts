import { legacyBlueprintSectionPresetMap } from './blueprint-composition-catalog';
import type { AppBlueprint } from './schemas/app-blueprint.schema';
import type {
  BlueprintNode,
  BlueprintSection,
  BlueprintSectionOverride,
  BlueprintSectionPatch,
  CustomBlueprintSection,
  LegacyBlueprintSection,
  PresetBlueprintSection,
} from './schemas/app-blueprint-ui.schema';

type AnyRecord = Record<string, unknown>;
type PatchInsertPosition = 'start' | 'end' | 'before' | 'after' | undefined;

export function normalizeBlueprintSectionForPreview(section: BlueprintSection): BlueprintSection {
  if (section.kind === 'preset_section' || section.kind === 'custom_section') return section;
  return legacyBlueprintSectionToPreset(section) || section;
}

export function legacyBlueprintSectionToPreset(
  section: LegacyBlueprintSection
): PresetBlueprintSection | null {
  const preset = legacyBlueprintSectionPresetMap[section.componentName];
  if (!preset) return null;
  return {
    kind: 'preset_section',
    id: section.id,
    name: section.name,
    preset,
    props: {
      ...section.props,
      title: section.props.title || section.name,
      description: section.props.description || section.intent || section.visualIntent,
      actions: section.props.actions || section.actions,
    },
    overrides: [],
    actions: section.actions,
  };
}

export function applyBlueprintSectionPatches(
  section: BlueprintSection,
  patches: BlueprintSectionPatch[]
): BlueprintSection {
  return patches.reduce(applyBlueprintSectionPatch, section);
}

export function applyBlueprintSectionPatchesToScreen(
  screen: AppBlueprint['screens'][number],
  sectionId: string,
  patches: BlueprintSectionPatch[]
): AppBlueprint['screens'][number] {
  return {
    ...screen,
    sections: screen.sections.map((section) =>
      section.id === sectionId ? applyBlueprintSectionPatches(section, patches) : section
    ),
  };
}

export function applyBlueprintSectionPatchesToBlueprint(
  blueprint: AppBlueprint,
  input: { screenId: string; sectionId: string; patches: BlueprintSectionPatch[] }
): AppBlueprint {
  return {
    ...blueprint,
    screens: blueprint.screens.map((screen) =>
      screen.id === input.screenId
        ? applyBlueprintSectionPatchesToScreen(screen, input.sectionId, input.patches)
        : screen
    ),
  };
}

export function applyBlueprintSectionPatch(
  section: BlueprintSection,
  patch: BlueprintSectionPatch
): BlueprintSection {
  const normalized = normalizeBlueprintSectionForPreview(section);
  if (normalized.kind === 'preset_section') {
    return {
      ...normalized,
      overrides: [...normalized.overrides, blueprintSectionPatchToOverride(patch)],
    };
  }
  if (normalized.kind === 'custom_section') {
    return {
      ...normalized,
      root: applyPatchToNode(normalized.root as AnyRecord, patch) || normalized.root,
    } as CustomBlueprintSection;
  }
  return normalized;
}

export function blueprintSectionPatchToOverride(
  patch: BlueprintSectionPatch
): PresetBlueprintSection['overrides'][number] {
  if (patch.op === 'insert') {
    return { target: patch.target, insert: patch.node, position: patch.position };
  }
  if (patch.op === 'remove') {
    return { target: patch.target, remove: true };
  }
  if (patch.op === 'replace') {
    return { target: patch.target, replace: patch.node };
  }

  const layoutKey = stripPathPrefix(patch.path, 'layout.');
  if (layoutKey) {
    return {
      target: patch.target,
      set: { layout: { [layoutKey]: patch.value } },
    };
  }
  const propsKey = stripPathPrefix(patch.path, 'props.') || patch.path;
  return {
    target: patch.target,
    set: { props: { [propsKey]: patch.value } },
  };
}

export function applyBlueprintSectionOverridesToNode(
  node: BlueprintNode,
  overrides: BlueprintSectionOverride[]
): BlueprintNode | null {
  return overrides.reduce<AnyRecord | null>(
    (current, override) => (current ? applyOverrideToNode(current, override) : null),
    node as AnyRecord
  ) as BlueprintNode | null;
}

function applyOverrideToNode(
  node: AnyRecord,
  override: BlueprintSectionOverride
): AnyRecord | null {
  const target = override.target;
  const isTarget = node.id === target;
  if (isTarget && override.remove) return null;
  if (isTarget && isRecord(override.replace)) return override.replace;

  const next = { ...node };
  if (isTarget && isRecord(override.set)) {
    if (isRecord(override.set.props)) {
      next.props = { ...(isRecord(next.props) ? next.props : {}), ...override.set.props };
    }
    if (isRecord(override.set.layout)) {
      next.layout =
        typeof next.layout === 'string'
          ? next.layout
          : { ...(isRecord(next.layout) ? next.layout : {}), ...override.set.layout };
    }
  }

  if (Array.isArray(next.children)) {
    let children = applyOverrideToChildren(next.children, override);
    if (isTarget && isRecord(override.insert)) {
      children = insertIntoChildren(children, override.insert, override.position);
    }
    next.children = children;
  }

  return next;
}

function applyOverrideToChildren(
  children: unknown[],
  override: BlueprintSectionOverride
): AnyRecord[] {
  const nextChildren: AnyRecord[] = [];
  for (const child of children) {
    if (!isRecord(child)) continue;
    if (
      override.position === 'before' &&
      child.id === override.target &&
      isRecord(override.insert)
    ) {
      nextChildren.push(override.insert);
    }
    const nextChild = applyOverrideToNode(child, override);
    if (nextChild) nextChildren.push(nextChild);
    if (
      override.position === 'after' &&
      child.id === override.target &&
      isRecord(override.insert)
    ) {
      nextChildren.push(override.insert);
    }
  }
  return nextChildren;
}

function applyPatchToNode(node: AnyRecord, patch: BlueprintSectionPatch): AnyRecord | null {
  const isTarget = node.id === patch.target;
  if (isTarget && patch.op === 'remove') return null;
  if (isTarget && patch.op === 'replace') return patch.node as AnyRecord;

  const next = { ...node };
  if (isTarget && patch.op === 'set') {
    next[patch.path.startsWith('layout.') ? 'layout' : 'props'] = setNestedValue(
      patch.path.startsWith('layout.') ? next.layout : next.props,
      patch.path.startsWith('layout.')
        ? patch.path.slice('layout.'.length)
        : stripPathPrefix(patch.path, 'props.') || patch.path,
      patch.value
    );
  }

  if (Array.isArray(next.children)) {
    let children = applyPatchToChildren(next.children, patch);
    if (isTarget && patch.op === 'insert') {
      children = insertIntoChildren(children, patch.node as AnyRecord, patch.position);
    }
    next.children = children;
  }
  return next;
}

function applyPatchToChildren(children: unknown[], patch: BlueprintSectionPatch): AnyRecord[] {
  const nextChildren: AnyRecord[] = [];
  for (const child of children) {
    if (!isRecord(child)) continue;
    if (patch.op === 'insert' && patch.position === 'before' && child.id === patch.target) {
      nextChildren.push(patch.node as AnyRecord);
    }
    const nextChild = applyPatchToNode(child, patch);
    if (nextChild) nextChildren.push(nextChild);
    if (patch.op === 'insert' && patch.position === 'after' && child.id === patch.target) {
      nextChildren.push(patch.node as AnyRecord);
    }
  }
  return nextChildren;
}

function insertIntoChildren(
  children: AnyRecord[],
  node: AnyRecord,
  position: PatchInsertPosition
): AnyRecord[] {
  if (position === 'start') return [node, ...children];
  if (position === 'before' || position === 'after') return children;
  return [...children, node];
}

function setNestedValue(value: unknown, path: string, nextValue: unknown): AnyRecord {
  const root = isRecord(value) ? { ...value } : {};
  const parts = path.split('.').filter(Boolean);
  if (parts.length === 0) return root;
  let cursor = root;
  for (const part of parts.slice(0, -1)) {
    const child = cursor[part];
    cursor[part] = isRecord(child) ? { ...child } : {};
    cursor = cursor[part] as AnyRecord;
  }
  cursor[parts[parts.length - 1]] = nextValue;
  return root;
}

function stripPathPrefix(path: string, prefix: string) {
  return path.startsWith(prefix) ? path.slice(prefix.length) : '';
}

function isRecord(value: unknown): value is AnyRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
