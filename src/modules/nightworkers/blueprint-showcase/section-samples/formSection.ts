import type { SectionSampleDefinition } from './types';

export const formSectionSample: SectionSampleDefinition = {
  name: 'FormSection',
  props: ({ base }) => ({
    ...base,
    submitLabel: 'Save section',
    fields: [
      { key: 'name', label: 'Section name', type: 'text' },
      { key: 'source', label: 'Data source', type: 'select', value: 'Static' },
      { key: 'variant', label: 'Variant', type: 'select', value: 'Default' },
      { key: 'published', label: 'Publish after review', type: 'checkbox', checked: true },
      { key: 'notes', label: 'Review notes', type: 'textarea' },
    ],
  }),
};
