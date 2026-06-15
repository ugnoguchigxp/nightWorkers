import type { SectionSampleDefinition } from './types';

export const chartSectionSample: SectionSampleDefinition = {
  name: 'ChartSection',
  props: ({ base }) => ({
    ...base,
    data: [
      { label: 'Scope', value: 40 },
      { label: 'Design', value: 64 },
      { label: 'Build', value: 82 },
      { label: 'Review', value: 74 },
      { label: 'Ship', value: 91 },
    ],
    insight: 'Use chart sections for comparison, trend, or progress signals.',
  }),
};
