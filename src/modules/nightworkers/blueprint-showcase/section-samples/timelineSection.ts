import type { SectionSampleDefinition } from './types';

export const timelineSectionSample: SectionSampleDefinition = {
  name: 'TimelineSection',
  props: ({ base }) => ({
    ...base,
    steps: [
      {
        title: 'Blueprint drafted',
        description: 'Agent generated the first section proposal.',
        time: '09:10',
        status: 'Draft',
        owner: 'Agent',
      },
      {
        title: 'Section reviewed',
        description: 'Reviewer checked layout, data contract, and preview behavior.',
        time: '10:35',
        status: 'Review',
        owner: 'Reviewer',
      },
      {
        title: 'Adopted for planning',
        description: 'Approved section is ready for implementation planning.',
        time: '11:20',
        status: 'Adopted',
        owner: 'System',
      },
    ],
  }),
};
