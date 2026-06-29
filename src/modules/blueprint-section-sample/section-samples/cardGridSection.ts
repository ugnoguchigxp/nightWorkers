import type { SectionSampleDefinition } from './types';

export const cardGridSectionSample: SectionSampleDefinition = {
  name: 'CardGridSection',
  props: ({ base, sampleCards, sampleImage }) => ({
    ...base,
    cards: sampleCards().map((item) => ({ ...item, imageUrl: sampleImage })),
  }),
};
