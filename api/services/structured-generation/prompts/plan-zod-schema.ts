import type { PlanZodSchemaArtifact } from '../../../../shared/schemas/plan-mode-artifact.schema';

export const PLAN_ZOD_SCHEMA_PROMPT_VERSION = 'plan-mode-zod-schema-v1';

export const planZodSchemaStructuredOutputSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'artifactKind',
    'view',
    'title',
    'summary',
    'schemaName',
    'owner',
    'zodSource',
    'openQuestions',
  ],
  properties: {
    artifactKind: { type: 'string', const: 'plan_mode_zod_schema' },
    view: { type: 'string', const: 'zod_schema_design' },
    title: { type: 'string' },
    summary: { type: 'string' },
    schemaName: { type: 'string' },
    owner: {
      type: 'string',
      enum: ['llm_json', 'worker_tool_input', 'mcp_input', 'provider_adapter', 'local_config'],
    },
    zodSource: { type: 'string' },
    openQuestions: { type: 'array', items: { type: 'string' } },
  },
} as const;

export function buildPlanZodSchemaSystemPrompt() {
  return [
    '[SystemContext]',
    '対象プロジェクト/対象機能の runtime validation contract のための Zod schema source を生成してください。',
    'NightWorkers 自体、Plan Mode 自体、設計判断、アンケート、planning decision、meta schema を定義してはいけません。',
    '`PlanDecision`, `PlanMode`, `Questionnaire`, `DecisionSchema`, `Planning`, `NightWorkers` を schema 名や field 名の中心概念に使わないでください。',
    'Feature Plan / API Contract / Blueprint / Data Model / User Prompt に明示された入力だけを Zod schema 化してください。',
    '将来拡張として想定できるだけの schema、便利そうな追加機能、未要求の設定値は生成しないでください。',
    'Todo 機能であれば `CreateTodoInputSchema`, `UpdateTodoInputSchema`, `SetTodoStatusInputSchema`, `DeleteTodoInputSchema` のような実操作に直接対応する schema を優先し、`TodoListPlanDecisionSchema` のような計画判断 schema は禁止です。',
    '明示がない限り、sort / filter / search / settings / preferences / list 管理 / category 管理 / group 管理 / runtime root schema / aggregate schema は生成しないでください。',
    '`TaskRuntimeSchema`, `TodoRuntimeSchema`, `TaskSettingsSchema`, `TaskSortSchema`, `TaskFilterSchema`, `TaskListInputSchema` のようなまとめ schema や未要求機能 schema は禁止です。',
    'OpenAPI endpoint に属さない validation contract のための Zod schema source を生成してください。',
    'HTTP API の request / response / error schema は API Contract view の責務なので、この view では扱わないでください。',
    '',
    '[Output Contract]',
    'JSON object だけを返してください。Markdown は返さないでください。',
    'artifactKind は "plan_mode_zod_schema"、view は "zod_schema_design" にしてください。',
    'zodSource には TypeScript の Zod schema source だけを入れてください。',
    'zodSource は import 行を含めず、`const SchemaName = z.object({ ... }).strict();` の形を基本にしてください。',
    '生成する object schema は原則 1〜4 個までにしてください。各 schema は画面操作、worker/tool input、provider adapter input、local config のいずれかに直接対応している必要があります。',
    'フォーム化できるよう、top-level は z.object({...}) にし、field は z.string / z.number / z.boolean / z.enum / z.array を中心にしてください。',
    '各 field には必要に応じて .describe(), .min(), .max(), .length(), .email(), .url(), .uuid(), .regex(), .int(), .nonnegative(), .positive(), .optional(), .default() を使ってください。',
    '必須 field、optional field、enum、代表的な validation error の根拠が Feature Plan / API Contract / Blueprint にある場合は zodSource に反映してください。',
    '根拠がない field や便利そうな追加 field は作らず、必要なら openQuestions に残してください。',
  ].join('\n');
}

export function buildPlanZodSchemaUserPrompt(input: {
  task: string;
  projectStackContext?: string | null;
  featurePlan: string;
  questionnaire: string;
  blueprint: string;
  dataModel: string;
  prompt: string;
}) {
  return [
    '次の context から Zod Schema view を1つ生成してください。',
    '',
    '## Task',
    input.task,
    '',
    '## Project Stack Context',
    input.projectStackContext?.trim() || 'Project stack は未検出です。',
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

export function renderPlanZodSchemaSummary(artifact: PlanZodSchemaArtifact) {
  return [
    artifact.summary,
    '',
    `Schema: ${artifact.schemaName}`,
    `Fields: ${artifact.fields.length}`,
  ].join('\n');
}
