import type { SectionSampleDefinition } from './types';

export const controlPanelSectionSample: SectionSampleDefinition = {
  name: 'ControlPanelSection',
  props: ({ base }) => ({
    ...base,
    panelTitle: 'Preview controls',
    modes: ['Preview', 'Review', 'Adopt'],
    controls: [
      { label: 'Density', value: 72, mode: 'Compact' },
      { label: 'Motion', value: 20, mode: 'Reduced' },
      { label: 'Contrast', value: 88, mode: 'High' },
    ],
  }),
};
