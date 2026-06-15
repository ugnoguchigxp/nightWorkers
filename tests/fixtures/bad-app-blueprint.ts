import type { AppBlueprint } from '../../shared/schemas/app-blueprint.schema';
import { representativeAppBlueprint } from './app-blueprint';

export const canonicalBadAppBlueprint: AppBlueprint = {
  ...representativeAppBlueprint,
  screens: [
    {
      ...representativeAppBlueprint.screens[0],
      id: 'operations-command-center',
      componentName: 'AnalyticsDashboardSection',
      sections: [
        {
          ...representativeAppBlueprint.screens[0].sections[0],
          id: 'priority-signals',
          dataBindingId: 'missing-binding',
        },
        {
          ...representativeAppBlueprint.screens[0].sections[1],
          id: 'priority-signals',
          componentName: 'DashboardPage',
        },
      ],
    },
    {
      ...representativeAppBlueprint.screens[0],
      id: 'operations-command-center',
    },
  ],
  databaseSchema: {
    tables: [
      {
        ...representativeAppBlueprint.databaseSchema.tables[0],
        columns: representativeAppBlueprint.databaseSchema.tables[0].columns,
      },
    ],
    relations: [
      {
        id: 'missing-relation',
        fromTable: 'decision-items',
        fromColumn: 'missing-column',
        toTable: 'missing-table',
        toColumn: 'id',
        cardinality: 'many_to_one',
      },
    ],
  },
  dataBindings: [
    {
      ...representativeAppBlueprint.dataBindings[0],
      table: 'missing-table',
    },
    {
      ...representativeAppBlueprint.dataBindings[1],
      fields: ['title', 'missing-field'],
    },
  ],
};
