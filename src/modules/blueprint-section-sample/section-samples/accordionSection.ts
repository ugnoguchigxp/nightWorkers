import type { SectionSampleDefinition } from './types';

export const accordionSectionSample: SectionSampleDefinition = {
  name: 'AccordionSection',
  props: ({ base }) => ({
    ...base,
    items: [
      {
        title: 'What changes after adoption?',
        description: 'The accepted Blueprint section is included in implementation planning.',
      },
      {
        title: 'Where do data bindings appear?',
        description: 'Bindings are reviewed before physical database changes are proposed.',
      },
      {
        title: 'Who can revise it?',
        description: 'The user can ask the agent to revise section intent, props, or layout.',
      },
    ],
  }),
};
