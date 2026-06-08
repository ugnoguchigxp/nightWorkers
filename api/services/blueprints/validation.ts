import type { AppBlueprint } from '../../../shared/schemas/app-blueprint.schema';
import { appBlueprintSchema } from '../../../shared/schemas/app-blueprint.schema';
import { getBlueprintComponentDefinition, isAllowedBlueprintSource } from '../blueprint-catalog';
import { validateDesignPreset } from '../design-governance';

export type BlueprintValidationSeverity = 'error' | 'warning';

export type BlueprintValidationIssue = {
  severity: BlueprintValidationSeverity;
  path: string;
  code:
    | 'schema_invalid'
    | 'duplicate_id'
    | 'unknown_component'
    | 'invalid_component_placement'
    | 'invalid_component_source'
    | 'missing_binding'
    | 'missing_table'
    | 'missing_field'
    | 'invalid_relation'
    | 'design_governance';
  message: string;
};

export type BlueprintValidationResult = {
  valid: boolean;
  issues: BlueprintValidationIssue[];
};

export function validateAppBlueprint(input: unknown): BlueprintValidationResult {
  const parsed = appBlueprintSchema.safeParse(input);
  if (!parsed.success) {
    return {
      valid: false,
      issues: parsed.error.issues.map((issue) => ({
        severity: 'error',
        path: issue.path.length > 0 ? issue.path.join('.') : '$',
        code: 'schema_invalid',
        message: issue.message,
      })),
    };
  }

  const blueprint = parsed.data;
  const issues: BlueprintValidationIssue[] = [
    ...validateDesignPreset(blueprint.designPreset).map((issue) => ({
      severity: 'error' as const,
      path: issue.path,
      code: 'design_governance' as const,
      message: issue.message,
    })),
    ...validateScreens(blueprint),
    ...validateDataModel(blueprint),
    ...validateBindings(blueprint),
  ];

  return {
    valid: issues.every((issue) => issue.severity !== 'error'),
    issues: issues.sort((a, b) => a.path.localeCompare(b.path) || a.code.localeCompare(b.code)),
  };
}

function validateScreens(blueprint: AppBlueprint): BlueprintValidationIssue[] {
  const issues: BlueprintValidationIssue[] = [];
  const bindingIds = new Set(blueprint.dataBindings.map((binding) => binding.id));
  collectDuplicateIds(
    blueprint.screens.map((screen) => screen.id),
    'screens',
    issues
  );

  blueprint.screens.forEach((screen, screenIndex) => {
    const screenPath = `screens.${screenIndex}`;
    const screenDefinition = getBlueprintComponentDefinition(screen.componentName);
    if (!screenDefinition) {
      issues.push(issue(`${screenPath}.componentName`, 'unknown_component', screen.componentName));
    } else if (screenDefinition.placement !== 'page') {
      issues.push(
        issue(
          `${screenPath}.componentName`,
          'invalid_component_placement',
          `${screen.componentName} is not a page component.`
        )
      );
    }
    collectDuplicateIds(
      screen.sections.map((section) => section.id),
      `${screenPath}.sections`,
      issues
    );

    screen.sections.forEach((section, sectionIndex) => {
      const sectionPath = `${screenPath}.sections.${sectionIndex}`;
      if (section.kind === 'preset_section' || section.kind === 'custom_section') return;
      const definition = getBlueprintComponentDefinition(section.componentName);
      if (!definition) {
        issues.push(
          issue(`${sectionPath}.componentName`, 'unknown_component', section.componentName)
        );
      } else if (definition.placement !== 'section') {
        issues.push(
          issue(
            `${sectionPath}.componentName`,
            'invalid_component_placement',
            `${section.componentName} is not a section component.`
          )
        );
      } else if (!isAllowedBlueprintSource(section.componentName, section.source)) {
        issues.push(
          issue(
            `${sectionPath}.source`,
            'invalid_component_source',
            `${section.componentName} does not allow source "${section.source}".`
          )
        );
      }
      if (section.dataBindingId && !bindingIds.has(section.dataBindingId)) {
        issues.push(
          issue(
            `${sectionPath}.dataBindingId`,
            'missing_binding',
            `Binding "${section.dataBindingId}" does not exist.`
          )
        );
      }
    });
  });
  return issues;
}

function validateDataModel(blueprint: AppBlueprint): BlueprintValidationIssue[] {
  const issues: BlueprintValidationIssue[] = [];
  const tables = blueprint.databaseSchema.tables;
  const tableNames = new Set(tables.map((table) => table.name));
  collectDuplicateIds(
    tables.map((table) => table.name),
    'databaseSchema.tables',
    issues
  );
  tables.forEach((table, tableIndex) => {
    collectDuplicateIds(
      table.columns.map((column) => column.name),
      `databaseSchema.tables.${tableIndex}.columns`,
      issues
    );
  });

  blueprint.databaseSchema.relations.forEach((relation, relationIndex) => {
    const relationPath = `databaseSchema.relations.${relationIndex}`;
    if (!tableNames.has(relation.fromTable)) {
      issues.push(
        issue(`${relationPath}.fromTable`, 'invalid_relation', 'Source table is missing.')
      );
    }
    if (!tableNames.has(relation.toTable)) {
      issues.push(issue(`${relationPath}.toTable`, 'invalid_relation', 'Target table is missing.'));
    }
    if (!tableHasColumn(blueprint, relation.fromTable, relation.fromColumn)) {
      issues.push(
        issue(`${relationPath}.fromColumn`, 'invalid_relation', 'Source column is missing.')
      );
    }
    if (!tableHasColumn(blueprint, relation.toTable, relation.toColumn)) {
      issues.push(
        issue(`${relationPath}.toColumn`, 'invalid_relation', 'Target column is missing.')
      );
    }
  });
  return issues;
}

function validateBindings(blueprint: AppBlueprint): BlueprintValidationIssue[] {
  const issues: BlueprintValidationIssue[] = [];
  collectDuplicateIds(
    blueprint.dataBindings.map((binding) => binding.id),
    'dataBindings',
    issues
  );
  blueprint.dataBindings.forEach((binding, bindingIndex) => {
    const bindingPath = `dataBindings.${bindingIndex}`;
    const table = blueprint.databaseSchema.tables.find(
      (candidate) => candidate.name === binding.table
    );
    if (!table) {
      issues.push(
        issue(`${bindingPath}.table`, 'missing_table', `Table "${binding.table}" does not exist.`)
      );
      return;
    }
    const columns = new Set(table.columns.map((column) => column.name));
    binding.fields.forEach((field, fieldIndex) => {
      if (!columns.has(field)) {
        issues.push(
          issue(
            `${bindingPath}.fields.${fieldIndex}`,
            'missing_field',
            `Field "${field}" does not exist on table "${binding.table}".`
          )
        );
      }
    });
  });
  return issues;
}

function collectDuplicateIds(values: string[], path: string, issues: BlueprintValidationIssue[]) {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      issues.push(issue(path, 'duplicate_id', `Duplicate id "${value}".`));
    }
    seen.add(value);
  }
}

function tableHasColumn(blueprint: AppBlueprint, tableName: string, columnName: string): boolean {
  return Boolean(
    blueprint.databaseSchema.tables
      .find((table) => table.name === tableName)
      ?.columns.some((column) => column.name === columnName)
  );
}

function issue(
  path: string,
  code: BlueprintValidationIssue['code'],
  message: string
): BlueprintValidationIssue {
  return { severity: 'error', path, code, message };
}
