import type { SectionSampleDefinition } from './types';

export const dataTableSectionSample: SectionSampleDefinition = {
  name: 'DataTableSection',
  props: ({ base, sampleColumns, sampleRows }) => ({
    ...base,
    columns: sampleColumns(),
    rows: sampleRows(),
  }),
};
