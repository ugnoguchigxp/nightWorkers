import type { DedicatedDesignView } from '../../../../shared/schemas/plan-mode-artifact.schema';

export const PLAN_DEDICATED_VIEW_PROMPT_VERSION = 'plan-mode-dedicated-view-v1';

export const genericDedicatedViewSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['artifactKind', 'view', 'title', 'markdown'],
  properties: {
    artifactKind: { type: 'string', const: 'plan_mode_dedicated_view' },
    view: {
      type: 'string',
      enum: [
        'user_flow',
        'api_io_contract',
        'state_model',
        'activity_flow',
        'sequence_flow',
        'zod_schema_design',
      ],
    },
    title: { type: 'string' },
    markdown: { type: 'string' },
    diagramKind: {
      type: 'string',
      enum: ['stateDiagram-v2', 'flowchart', 'sequenceDiagram'],
    },
  },
} as const;

export type GenericDedicatedViewArtifact = {
  artifactKind: 'plan_mode_dedicated_view';
  view: Exclude<DedicatedDesignView, 'questionnaire' | 'blueprint' | 'data_model'>;
  title: string;
  markdown: string;
  diagramKind?: 'stateDiagram-v2' | 'flowchart' | 'sequenceDiagram';
};

export function buildPlanDedicatedViewSystemPrompt(view: GenericDedicatedViewArtifact['view']) {
  return [
    '[SystemContext]',
    'あなたは NightWorkers の dedicated design view generator です。',
    `今回生成する view は ${view} だけです。複数 view をまとめて生成しないでください。`,
    'Feature Plan、Questionnaire、Blueprint、Data Model は入力 context として扱い、正本の責務を混ぜないでください。',
    'ユースケース図、journey、gantt は絶対に生成しないでください。',
    '',
    '[Output Contract]',
    'JSON object だけを返してください。markdown は JSON の markdown 文字列に入れてください。',
    'artifactKind は "plan_mode_dedicated_view"、view は選択された view 名にしてください。',
    '',
    '[View Rules]',
    viewRules(view),
  ].join('\n');
}

export function buildPlanDedicatedViewUserPrompt(input: {
  view: GenericDedicatedViewArtifact['view'];
  task: string;
  featurePlan: string;
  questionnaire: string;
  blueprint: string;
  dataModel: string;
  prompt: string;
}) {
  return [
    `次の context から ${input.view} dedicated design view を1つ生成してください。`,
    '',
    '## Task',
    input.task,
    '',
    '## Feature Plan',
    input.featurePlan,
    '',
    '## Questionnaire / Decisions',
    input.questionnaire,
    '',
    '## Blueprint Context',
    input.blueprint,
    '',
    '## Data Model Context',
    input.dataModel,
    '',
    '## User Prompt',
    input.prompt,
  ].join('\n');
}

function viewRules(view: GenericDedicatedViewArtifact['view']) {
  switch (view) {
    case 'user_flow':
      return [
        '- ユーザー操作、画面遷移、手順が実装判断に影響する範囲だけを書く。',
        '- UI がない作業、または user-visible flow が変わらない作業では、不要な画面や actor を足さない。',
        '- ユースケース図、journey、gantt は生成しない。',
      ].join('\n');
    case 'api_io_contract':
      return [
        '- Markdown で request / response / error / permission / timeout / idempotency を必要な範囲だけ書く。',
        '- internal algorithm を API contract として書かない。',
      ].join('\n');
    case 'state_model':
      return [
        '- Mermaid を使う場合は stateDiagram-v2 だけを使い、diagramKind は stateDiagram-v2 にする。',
        '- transition の trigger、guard、side effect を書く。',
      ].join('\n');
    case 'activity_flow':
      return [
        '- Mermaid を使う場合は flowchart TD または flowchart LR だけを使い、diagramKind は flowchart にする。',
        '- Acceptance Criteria と実装 branch に対応する flow だけを書く。',
      ].join('\n');
    case 'sequence_flow':
      return [
        '- Mermaid を使う場合は sequenceDiagram だけを使い、diagramKind は sequenceDiagram にする。',
        '- 実装に存在する actor だけを書く。',
      ].join('\n');
    case 'zod_schema_design':
      return [
        '- schema 名、owner file、input source、output consumer、default、strictness、compat normalize を書く。',
        '- DB DDL の代替にしない。',
      ].join('\n');
  }
}
