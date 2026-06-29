import type { SectionSampleDefinition } from './types';

export const fullBleedHeroSectionSample: SectionSampleDefinition = {
  name: 'FullBleedHeroSection',
  props: ({ base, sampleImage }) => ({
    ...base,
    headline: 'Bring the launch into focus',
    description:
      'A full-width image hero for campaign, product, or service pages that need a strong first impression.',
    highlights: ['Full background image', 'Readable overlay copy', 'Primary action path'],
    primaryCta: { label: 'Explore' },
    secondaryCta: { label: 'Learn more' },
    imageUrl: sampleImage,
  }),
};
