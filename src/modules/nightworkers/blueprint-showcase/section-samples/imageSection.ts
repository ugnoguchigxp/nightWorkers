import type { SectionSampleDefinition } from './types';

export const imageSectionSample: SectionSampleDefinition = {
  name: 'ImageSection',
  props: ({ base, sampleImage }) => ({
    ...base,
    caption: 'Preview media with explicit alt text.',
    imageUrl: sampleImage,
  }),
};
