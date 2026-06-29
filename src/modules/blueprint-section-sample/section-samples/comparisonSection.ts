import type { SectionSampleDefinition } from './types';

export const comparisonSectionSample: SectionSampleDefinition = {
  name: 'ComparisonSection',
  props: ({ base }) => ({
    ...base,
    options: [
      {
        title: 'Current screen',
        badge: 'baseline',
        points: ['Manual review', 'No section contract', 'Faster to start'],
      },
      {
        title: 'Blueprint screen',
        badge: 'recommended',
        points: ['Named sections', 'Traceable data bindings', 'Better implementation handoff'],
      },
    ],
  }),
};
