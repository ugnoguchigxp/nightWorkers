import type { SectionSampleDefinition } from './types';

export const blogPostSectionSample: SectionSampleDefinition = {
  name: 'BlogPostSection',
  props: ({ base }) => ({
    ...base,
    title: 'Designing reliable product workflows',
    dek: 'A text-forward article section with byline, body copy, pull quote, and tags.',
    author: 'Product Editorial',
    date: '2026-06-15',
    readingTime: '6 min read',
    paragraphs: [
      'Workflow screens often fail when they look like dashboards but do not respect the real sequence of work. The article surface should explain the context before asking users to act.',
      'A blog-style section is useful for announcements, release notes, editorial pages, documentation intros, and content-heavy product stories.',
      'The layout keeps typography, spacing, and byline details visible without forcing every page into cards or charts.',
    ],
    pullQuote: 'Text-heavy sections need rhythm, hierarchy, and enough room to read.',
    tags: ['Editorial', 'Workflow', 'Product'],
  }),
};
