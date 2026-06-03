import type { AppBlueprint } from '../../shared/schemas/app-blueprint.schema';

export const representativeAppBlueprint: AppBlueprint = {
  id: 'bp-fixture',
  name: 'Operations Console',
  version: 1,
  description: 'A compact operational console for reviewing work items.',
  designPreset: {
    id: 'nightworkers-default',
    name: 'NightWorkers Default',
    mode: 'hybrid',
    theme: 'nightworkers-dark',
    density: 'compact',
    radius: 'default',
    shadow: 'subtle',
    fontScale: 'default',
    contrast: 'standard',
    motion: 'standard',
  },
  screens: [
    {
      id: 'overview',
      name: 'Overview',
      path: '/',
      componentName: 'DashboardPage',
      sections: [
        {
          id: 'summary',
          name: 'Summary',
          componentName: 'KpiSummarySection',
          source: 'computed',
          dataBindingId: 'work-items-summary',
          props: {},
          actions: [],
        },
        {
          id: 'work-items',
          name: 'Work Items',
          componentName: 'DataTableSection',
          source: 'table',
          dataBindingId: 'work-items-list',
          props: {},
          actions: [],
        },
      ],
      actions: [],
    },
  ],
  databaseSchema: {
    tables: [
      {
        name: 'work-items',
        label: 'Work Items',
        columns: [
          { name: 'id', type: 'string', nullable: false, primaryKey: true, unique: true },
          { name: 'title', type: 'string', nullable: false, primaryKey: false, unique: false },
          { name: 'status', type: 'string', nullable: false, primaryKey: false, unique: false },
        ],
        indexes: [['status']],
      },
    ],
    relations: [],
  },
  dataBindings: [
    {
      id: 'work-items-summary',
      name: 'Work Items Summary',
      table: 'work-items',
      mode: 'summary',
      fields: ['id', 'status'],
      filters: [],
      sort: [],
    },
    {
      id: 'work-items-list',
      name: 'Work Items List',
      table: 'work-items',
      mode: 'list',
      fields: ['title', 'status'],
      filters: [],
      sort: ['status'],
    },
  ],
  implementationTasks: [
    {
      id: 'implement-overview',
      title: 'Implement overview',
      description: 'Build the overview screen and wire data bindings.',
      affectedDomains: ['blueprint-ui', 'blueprint-data', 'blueprint-binding'],
    },
  ],
  learningHooks: [],
};
