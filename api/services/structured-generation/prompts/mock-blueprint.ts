import { createHash } from 'node:crypto';
import type {
  MockBlueprint,
  RenderableMockBlueprintSectionName,
} from '../../../../shared/schemas/mock-blueprint.schema';
import {
  getMockBlueprintDatasetKindsForSection,
  renderableMockBlueprintSectionNames,
} from '../../../../shared/schemas/mock-blueprint.schema';

export const MOCK_BLUEPRINT_PROMPT_VERSION = 'mock-blueprint-v3';

type SectionCatalogEntry = {
  componentName: RenderableMockBlueprintSectionName;
  usage: string;
  datasetKinds: readonly string[];
};

export function buildMockBlueprintSectionCatalog(): SectionCatalogEntry[] {
  return renderableMockBlueprintSectionNames.map((componentName) => ({
    componentName,
    usage: sectionUsage(componentName),
    datasetKinds: getMockBlueprintDatasetKindsForSection(componentName),
  }));
}

export function buildMockBlueprintSystemPrompt(input: {
  sectionCatalog?: SectionCatalogEntry[];
  jsonSchema: unknown;
}): string {
  const sectionCatalog = input.sectionCatalog || buildMockBlueprintSectionCatalog();
  return [
    '[SystemContext]',
    'あなたは NightWorkers の Mock Blueprint JSON generator です。',
    '目的は、実装前に確認できる軽量な Mock 表示用 JSON を作ることです。',
    'LLM は Section 選択、画面に出す文言、サンプルデータセットを JSON で構築してください。',
    '',
    '[Output Contract]',
    'JSON object だけを返してください。markdown、説明文、コードフェンスは不要です。',
    'JSON は [MockBlueprint JSON Schema] に従ってください。',
    'artifactKind は "mock_blueprint"、version は 1 にしてください。',
    '',
    '[Selection Rules]',
    '- componentName は [Section Catalog] の名前だけを使う。',
    '- dataset.kind は、その Section に許可された kind だけを使う。',
    '- 通常は 1-3 screens、screen ごとに 1-6 sections に抑える。',
    '- Mock は「実装後にユーザーが触るプロダクト画面」を描く。仕様書（Spec）、仕様確認、進行メモ、実装手順、決定事項サマリー、確認用ノートを画面化しない。',
    '- 技術スタック、保存先、認証方針、実装範囲、ライブラリ、DB 種別、開発方針は制約としてだけ使う。これらを CardGridSection / BlogPostSection / DataTableSection の表示データにしない。',
    '- Questionnaire / Decisions に明示された方針は、meta.intent、screen.purpose、section.selectionReason、section.copy、dataset に反映する。特に thread、投稿、編集、削除、返信なし、認証不要などの決定は無視しない。',
    '- meta.intent は「何の実装前確認か」ではなく、作るプロダクト画面そのものの目的を書く。例: thread ベースの投稿画面で、投稿一覧、本文詳細、作成、編集、削除を確認する、のように主要 entity と workflow を含める。',
    '- meta.selectedSections は実際の screens[].sections[] と同じ順序、同じ sectionType で記録する。実画面に出さない候補や不採用 section は selectedSections に入れない。',
    '- 依頼文から主要ユーザー、主要エンティティ、主要ワークフロー、最も確認したい状態を読み取り、それに必要な Section を選ぶ。',
    '- Section は用途で選ぶ。レコード一覧や比較は DataTableSection、作成・編集は FormSection、本文や詳細閲覧は BlogPostSection、会話やコメントは ChatPanelSection、状態遷移は KanbanSection、操作・設定は ControlPanelSection、グローバル導線は TopMenuSection / TabNavigationSection / FooterNavigationSection を使う。',
    '- ControlPanelSection や Display controls は、表示モード切替、運用スイッチ、設定、フィルタ操作そのものが画面の主目的の場合だけ使う。',
    '- 分析、KPI、レポート、監視が主目的ではない依頼では、AnalyticsDashboardSection / ChartSection を埋め草として追加しない。',
    '- CRUD / list workflow は、多くの場合 DataTableSection と FormSection の組み合わせが自然です。thread / 投稿 / 掲示板系 workflow は、一覧は DataTableSection、本文詳細は BlogPostSection、作成・編集は FormSection、返信やコメント表示が仕様に含まれる場合だけ ChatPanelSection を使う。',
    '- TabNavigationSection は、ユーザーが同格の複数 view や mode を切り替えること自体が必要な画面だけで使う。投稿一覧、新規投稿、詳細、編集、削除の通常導線は TopMenuSection、表の操作、フォーム、行アクションで表現し、タブを追加しない。',
    '- CardGridSection / TimelineSection は、対象プロダクト自体がカード閲覧や時系列活動を中心にする場合だけ使う。小規模掲示板、thread CRUD、投稿一覧、仕様項目、実装工程、決定事項の要約には使わない。',
    '- screen.layout.template は通常 single_column を使う。two_column / three_column / sidebar_left / sidebar_right / article_with_sidebar は、sidebar / aside に置く Section が必要な場合だけ使う。',
    '- 左右横の side column に置いてよいのは、SidebarMenuSection / LeftSidebarSection / ExplorerSidebarSection / RightSidebarLinksSection、または componentName / name / id に sidebar / サイドバー / サイドメニューを含む Section だけ。該当しない通常コンテンツ、カード、フォーム、表、記事、指標、optional view は main / full_width に置き、横並びにしない。',
    '- RightSidebarLinksSection / LeftSidebarSection は、画面に独立した補助カラムが明示的に必要な場合だけ使う。通常の関連リンクやページ遷移は TopMenuSection / TabNavigationSection / FooterNavigationSection / SidebarMenuSection で表現する。',
    '- ads、sponsored、newsletter などの汎用 placeholder は依頼に明示されていない限り dataset や copy に入れない。',
    '- landing、article、media、campaign が明示されていない場合、hero/media 系を主役にしない。',
    '- section.copy と dataset の文言は、依頼テーマ、業務、利用者、画面の用途に合わせる。',
    '- BlogPostSection を使う場合、dataset.body は実際にユーザーが読む本文として十分な量にする。掲示板や記事の本文なら 180 文字以上を目安にし、技術方針や実装メモの短文にしない。',
    '- CardGridSection を使う場合、cards は product item、投稿カテゴリ、スレッド、ユーザーが選ぶ対象などに限定する。Spec の決定事項や技術要素をカード化しない。',
    '- DB schema、data binding、API contract、Zod schema、implementation task、CSS、HTML、任意 component tree は生成しない。',
    '',
    '[Section Catalog]',
    renderSectionCatalog(sectionCatalog),
    '',
    '[Dataset Guide]',
    renderDatasetGuide(),
    '',
    '[MockBlueprint JSON Schema]',
    JSON.stringify(input.jsonSchema, null, 2),
  ].join('\n');
}

export function buildMockBlueprintUserPrompt(input: {
  task: { id: string; title: string; description?: string | null; objective?: string | null };
  questionnaireMarkdown?: string | null;
  specContext?: string | null;
  prompt?: string | null;
}) {
  return [
    '次の context から Mock Blueprint JSON を1つ生成してください。',
    '生成する screens は、作ろうとしているアプリそのものの画面です。',
    'Plan Mode、仕様書（Spec）、仕様レビュー、進行管理、確認メモを表示する NightWorkers 内部画面にはしないでください。',
    'サンプルデータは task domain の実データ風に作り、仕様項目や実装工程をデータ化しないでください。',
    '技術スタック、保存先、認証方針、実装範囲などは制約であり、画面上のカードや本文として表示しないでください。',
    '',
    '## Task',
    `Task ID: ${input.task.id}`,
    `Title: ${input.task.title || 'Untitled'}`,
    input.task.description ? `Description: ${input.task.description}` : '',
    input.task.objective ? `Objective: ${input.task.objective}` : '',
    '',
    '## Questionnaire / Decisions',
    input.questionnaireMarkdown?.trim() || 'Questionnaire は未生成です。',
    '',
    '## 仕様書 / Spec（制約として参照）',
    'この内容は画面に出す題材ではなく、Mock の制約としてだけ使ってください。',
    '仕様書（Spec）、仕様確認、進行メモ、実装手順、確認ノートの画面は生成しないでください。',
    input.specContext?.trim() || '仕様書（Spec）は未生成です。',
    '',
    '## User Prompt',
    input.prompt?.trim() || input.task.objective || input.task.description || input.task.title,
  ]
    .filter(Boolean)
    .join('\n');
}

export function buildMockBlueprintStructuredOutputJsonSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: [
      'artifactKind',
      'id',
      'name',
      'version',
      'summary',
      'tone',
      'meta',
      'screens',
      'generationNotes',
    ],
    properties: {
      artifactKind: { type: 'string', const: 'mock_blueprint' },
      id: { type: 'string' },
      name: { type: 'string' },
      version: { type: 'integer', const: 1 },
      summary: { type: 'string' },
      tone: { type: 'string' },
      meta: {
        type: 'object',
        additionalProperties: false,
        required: ['intent', 'selectedSections'],
        properties: {
          intent: { type: 'string' },
          selectedSections: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['sectionType', 'selectionReason'],
              properties: {
                sectionType: {
                  type: 'string',
                  enum: [...renderableMockBlueprintSectionNames],
                },
                selectionReason: { type: 'string' },
              },
            },
          },
        },
      },
      screens: {
        type: 'array',
        minItems: 1,
        maxItems: 3,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'name', 'path', 'purpose', 'layout', 'sections'],
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            path: { type: 'string' },
            purpose: { type: 'string' },
            layout: {
              type: 'object',
              additionalProperties: false,
              required: ['template'],
              properties: {
                template: {
                  type: 'string',
                  enum: [
                    'single_column',
                    'two_column',
                    'three_column',
                    'sidebar_left',
                    'sidebar_right',
                    'article_with_sidebar',
                  ],
                },
              },
            },
            sections: {
              type: 'array',
              minItems: 1,
              maxItems: 6,
              items: {
                type: 'object',
                additionalProperties: false,
                required: [
                  'id',
                  'name',
                  'componentName',
                  'region',
                  'selectionReason',
                  'copy',
                  'dataset',
                ],
                properties: {
                  id: { type: 'string' },
                  name: { type: 'string' },
                  componentName: {
                    type: 'string',
                    enum: [...renderableMockBlueprintSectionNames],
                  },
                  region: {
                    type: ['string', 'null'],
                    enum: ['header', 'main', 'sidebar', 'aside', 'full_width', 'footer', null],
                  },
                  selectionReason: { type: 'string' },
                  copy: {
                    type: 'object',
                    additionalProperties: false,
                    required: [
                      'title',
                      'description',
                      'primaryActionLabel',
                      'secondaryActionLabel',
                      'emptyStateTitle',
                      'emptyStateDescription',
                    ],
                    properties: {
                      title: { type: 'string' },
                      description: { type: ['string', 'null'] },
                      primaryActionLabel: { type: ['string', 'null'] },
                      secondaryActionLabel: { type: ['string', 'null'] },
                      emptyStateTitle: { type: ['string', 'null'] },
                      emptyStateDescription: { type: ['string', 'null'] },
                    },
                  },
                  dataset: {
                    type: 'object',
                    additionalProperties: true,
                    required: ['kind'],
                    properties: {
                      kind: {
                        type: 'string',
                        enum: [
                          'navigation',
                          'table',
                          'form',
                          'cards',
                          'kanban',
                          'timeline',
                          'article',
                          'metrics',
                          'media',
                          'map',
                          'code',
                          'chat',
                          'generic',
                        ],
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      generationNotes: {
        type: 'array',
        items: { type: 'string' },
      },
    },
  } as const;
}

export function mockBlueprintPromptDiagnostics(input: {
  systemPrompt: string;
  userPrompt: string;
  schema: unknown;
}) {
  const systemPromptEstimatedTokens = estimatePromptTokens(input.systemPrompt);
  const userPromptEstimatedTokens = estimatePromptTokens(input.userPrompt);
  return {
    schemaName: 'mock_blueprint' as const,
    systemPromptBytes: Buffer.byteLength(input.systemPrompt, 'utf8'),
    userPromptBytes: Buffer.byteLength(input.userPrompt, 'utf8'),
    systemPromptEstimatedTokens,
    userPromptEstimatedTokens,
    totalPromptEstimatedTokens: systemPromptEstimatedTokens + userPromptEstimatedTokens,
    sectionAllowlistCount: renderableMockBlueprintSectionNames.length,
    schemaDigest: createHash('sha256').update(JSON.stringify(input.schema)).digest('hex'),
  };
}

function estimatePromptTokens(value: string) {
  return Math.ceil(Buffer.byteLength(value, 'utf8') / 4);
}

function renderSectionCatalog(sectionCatalog: SectionCatalogEntry[]) {
  return sectionCatalog
    .map(
      (entry) => `${entry.componentName}: ${entry.usage} dataset=${entry.datasetKinds.join('|')}`
    )
    .join('\n');
}

function renderDatasetGuide() {
  return [
    'navigation: nav items with label/href/active. min items=2.',
    'table: columns and row records for comparison/list management. min columns=2, min rows=5.',
    'form: fields and submitLabel for create/edit input. min fields=2.',
    'cards: rich summary cards. min cards=2.',
    'kanban: workflow columns and cards.',
    'timeline: chronological items. min items=2.',
    'article: text body and meta.',
    'metrics: KPI labels, values, trends. min metrics=2.',
    'media: visual/story items without real image generation.',
    'map: points or regions.',
    'code: file excerpts.',
    'chat: messages. min messages=2.',
    'generic: simple titled items. min items=2.',
  ].join('\n');
}

function sectionUsage(componentName: RenderableMockBlueprintSectionName) {
  const usage: Record<RenderableMockBlueprintSectionName, string> = {
    AccordionSection: 'grouped details or FAQs',
    AnalyticsDashboardSection: 'dashboard metrics and status overview',
    BlogPostSection: 'article or long-form text screen',
    CalendarSection: 'date-based planning or schedule preview',
    CardGridSection: 'browseable cards, templates, rich item summaries',
    CarouselSection: 'media or campaign sequence',
    ChartSection: 'chart or trend summary',
    ChatPanelSection: 'conversation or review comments',
    CheckoutSummarySection: 'checkout/order/payment summary',
    CodeEditorSection: 'code/config editing mock',
    ComparisonSection: 'side-by-side comparison',
    ControlPanelSection: 'settings, toggles, operational controls only',
    DataTableSection: 'records, CRUD lists, sorting, comparison',
    EmailInboxSection: 'inbox-style table/list workflow',
    ExplorerSidebarSection: 'hierarchical file/project navigation',
    FooterNavigationSection: 'footer links',
    FormSection: 'create/edit input flow',
    FullBleedHeroSection: 'visual landing hero',
    ImageSection: 'image-focused preview',
    KanbanSection: 'board workflow and status columns',
    LeftSidebarSection: 'explicit left supporting column only',
    MapSection: 'location or region view',
    MediaTextSection: 'media plus explanatory copy',
    NotificationCenterSection: 'notifications and alerts',
    PaymentFormSection: 'payment input form',
    RightSidebarLinksSection: 'explicit right supporting column only',
    ScheduleSection: 'schedule or upcoming items',
    SidebarMenuSection: 'primary sidebar navigation',
    SplitHeroSection: 'landing hero with media/text balance',
    TabNavigationSection: 'tabbed navigation',
    TimelineSection: 'events, activity, history',
    TopMenuSection: 'top navigation and primary actions',
    VideoSection: 'video/media preview',
  };
  return usage[componentName];
}

export type MockBlueprintPromptArtifact = MockBlueprint;
