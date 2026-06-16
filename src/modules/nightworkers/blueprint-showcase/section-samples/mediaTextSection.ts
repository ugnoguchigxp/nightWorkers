import type { SectionSampleDefinition } from './types';

export const mediaTextSectionSample: SectionSampleDefinition = {
  name: 'MediaTextSection',
  props: ({ base, sampleImage }) => ({
    ...base,
    eyebrow: 'Feature',
    title: 'Bring the product story into view',
    description:
      'A media and text section works for article promos, product explainers, feature stories, or editorial blocks where the image supports the copy.',
    imageUrl: sampleImage,
    caption: 'Representative product or editorial media.',
    imagePosition: 'left',
    highlights: [
      {
        title: 'Editorial copy',
        description: 'Enough text to explain why the visual matters.',
      },
      {
        title: 'Supporting media',
        description: 'Image remains part of the content, not a decorative hero.',
      },
    ],
    primaryCta: { label: 'Read more' },
  }),
};
