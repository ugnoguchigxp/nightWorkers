import type { SectionSampleDefinition } from './types';

export const videoSectionSample: SectionSampleDefinition = {
  name: 'VideoSection',
  props: ({ base, sampleImage }) => ({
    ...base,
    title: 'Product walkthrough',
    description: 'A video player preview with poster frame, controls, and duration metadata.',
    duration: '03:24',
    posterUrl: sampleImage,
    caption: 'Video player preview',
  }),
};
