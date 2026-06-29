import type { SectionSampleDefinition } from './types';

export const scheduleSectionSample: SectionSampleDefinition = {
  name: 'ScheduleSection',
  props: ({ base }) => ({
    ...base,
    title: 'Blueprint week',
    entries: [
      { title: 'Blueprint review', date: 'Mon 15', time: '09:00', owner: 'Reviewer' },
      { title: 'Implementation pass', date: 'Tue 16', time: '13:30', owner: 'Agent' },
      { title: 'Validation', date: 'Wed 17', time: '16:00', owner: 'System' },
    ],
  }),
};
