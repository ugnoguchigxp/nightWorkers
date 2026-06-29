import type { SectionSampleDefinition } from './types';

export const leftSidebarSectionSample: SectionSampleDefinition = {
  name: 'LeftSidebarSection',
  props: ({ base }) => ({
    ...base,
    title: '注目コンテンツ',
    links: [
      { label: '前立腺がん、治療法の選び方', href: '#feature-1' },
      { label: 'インタビュー特集', href: '#interview' },
      { label: 'アクセスランキング', href: '#ranking' },
      { label: '医師に聞くQ&A', href: '#qa' },
      { label: '関連リンク集', href: '#links' },
    ],
    ads: ['広告枠', 'イベント告知', '資料請求'],
  }),
};
