import type { SectionSampleDefinition } from './types';

export const rightSidebarLinksSectionSample: SectionSampleDefinition = {
  name: 'RightSidebarLinksSection',
  props: ({ base }) => ({
    ...base,
    title: 'アクセスランキング',
    links: [
      { label: '発売日は銀座に大行列、相次ぐ転売', href: '#rank-1' },
      { label: 'トランプ氏「合意成立」と発表', href: '#rank-2' },
      { label: '自衛隊に行く子、経済的に厳しい', href: '#rank-3' },
      { label: '茨城県下妻市長が死亡、自殺の可能性', href: '#rank-4' },
      { label: 'スイスで人口上限を巡る国民投票', href: '#rank-5' },
    ],
    ads: ['広告枠', 'メールマガジン'],
    note: '本文の右列に広告、ランキング、関連リンクを配置するサイドバー。',
  }),
};
