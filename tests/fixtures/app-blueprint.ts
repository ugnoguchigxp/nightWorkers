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
      id: 'operations-command-center',
      name: 'Operations Command Center',
      path: '/',
      componentName: 'DashboardPage',
      sections: [
        {
          kind: 'component_section',
          id: 'priority-signals',
          name: 'Priority Signals',
          componentName: 'AnalyticsDashboardSection',
          source: 'computed',
          dataBindingId: 'signals-summary',
          props: {
            title: 'Priority Signals',
            description: 'Highlights the strongest operational cues before opening a task.',
            items: [
              { label: 'Ready to review', value: '12' },
              { label: 'Needs decision', value: '4' },
              { label: 'Blocked paths', value: '2' },
            ],
          },
          actions: [],
        },
        {
          kind: 'component_section',
          id: 'decision-queue',
          name: 'Decision Queue',
          componentName: 'DataTableSection',
          source: 'table',
          dataBindingId: 'decision-queue-list',
          props: {
            title: 'Decision Queue',
            description: 'Keeps the next review action visible in a compact work surface.',
            columns: [
              { key: 'title', label: 'Decision' },
              { key: 'status', label: 'State' },
            ],
            rows: [
              { title: 'Approve launch copy', status: 'Ready' },
              { title: 'Resolve intake ambiguity', status: 'Needs decision' },
            ],
          },
          actions: [],
        },
      ],
      actions: [],
    },
  ],
  databaseSchema: {
    tables: [
      {
        name: 'decision-items',
        label: 'Decision Items',
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
      id: 'signals-summary',
      name: 'Signals Snapshot',
      table: 'decision-items',
      mode: 'summary',
      fields: ['id', 'status'],
      filters: [],
      sort: [],
    },
    {
      id: 'decision-queue-list',
      name: 'Decision Queue List',
      table: 'decision-items',
      mode: 'list',
      fields: ['title', 'status'],
      filters: [],
      sort: ['status'],
    },
  ],
  implementationTasks: [
    {
      id: 'implement-command-center',
      title: 'Implement command center',
      description: 'Build the designed command center screen and preview states.',
      affectedDomains: ['blueprint-ui', 'blueprints'],
    },
  ],
  learningHooks: [],
};
