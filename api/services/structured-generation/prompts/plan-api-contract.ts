import type { PlanApiContractArtifact } from '../../../../shared/schemas/plan-mode-artifact.schema';

export const PLAN_API_CONTRACT_PROMPT_VERSION = 'plan-mode-api-contract-v1';

const planApiContractRequestBodyDraftSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['description', 'schemaName', 'required'],
  properties: {
    description: { type: 'string' },
    schemaName: { type: 'string' },
    required: { type: 'boolean' },
  },
} as const;

const planApiContractResponseDraftSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'description', 'schemaName'],
  properties: {
    status: { type: 'integer', minimum: 100, maximum: 599 },
    description: { type: 'string' },
    schemaName: { type: 'string' },
  },
} as const;

const planApiContractParameterDraftSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'in', 'type', 'required', 'description'],
  properties: {
    name: { type: 'string' },
    in: { type: 'string', enum: ['query', 'path', 'header', 'cookie'] },
    type: {
      type: 'string',
      enum: ['string', 'number', 'integer', 'boolean', 'object', 'array', 'unknown'],
    },
    required: { type: 'boolean' },
    description: { type: 'string' },
  },
} as const;

const planApiContractFieldDraftSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'type', 'required', 'description'],
  properties: {
    name: { type: 'string' },
    type: {
      type: 'string',
      enum: ['string', 'number', 'integer', 'boolean', 'object', 'array', 'unknown'],
    },
    required: { type: 'boolean' },
    description: { type: 'string' },
  },
} as const;

export const planApiContractStructuredOutputSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'artifactKind',
    'view',
    'title',
    'summary',
    'operations',
    'componentSchemas',
    'stateTransitions',
    'validation',
    'openQuestions',
  ],
  properties: {
    artifactKind: { type: 'string', const: 'plan_mode_api_contract' },
    view: { type: 'string', const: 'api_io_contract' },
    title: { type: 'string' },
    summary: { type: 'string' },
    operations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'path',
          'method',
          'operationId',
          'summary',
          'description',
          'tags',
          'parameters',
          'requestBody',
          'responses',
        ],
        properties: {
          path: { type: 'string' },
          method: {
            type: 'string',
            enum: ['get', 'post', 'put', 'patch', 'delete', 'options', 'head'],
          },
          operationId: { type: 'string' },
          summary: { type: 'string' },
          description: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
          parameters: {
            type: 'array',
            items: planApiContractParameterDraftSchema,
          },
          requestBody: planApiContractRequestBodyDraftSchema,
          responses: {
            type: 'array',
            items: planApiContractResponseDraftSchema,
          },
        },
      },
    },
    componentSchemas: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'description', 'fields'],
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          fields: {
            type: 'array',
            items: planApiContractFieldDraftSchema,
          },
        },
      },
    },
    stateTransitions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'operationId',
          'fromState',
          'toState',
          'successStatus',
          'conflictStatuses',
          'stateField',
          'notes',
        ],
        properties: {
          operationId: { type: 'string' },
          fromState: { type: 'string' },
          toState: { type: 'string' },
          successStatus: { type: 'integer', minimum: 100, maximum: 599 },
          conflictStatuses: {
            type: 'array',
            items: { type: 'integer', minimum: 100, maximum: 599 },
          },
          stateField: { type: 'string' },
          notes: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    validation: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['schemaName', 'owner', 'zodOwnerFile', 'strictness', 'examples'],
        properties: {
          schemaName: { type: 'string' },
          owner: { type: 'string', enum: ['request', 'response', 'error', 'shared'] },
          zodOwnerFile: { type: 'string' },
          strictness: {
            type: 'string',
            enum: ['strict', 'passthrough', 'strip', 'unknown'],
          },
          examples: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['name', 'valid', 'payloadJson', 'expectedIssues'],
              properties: {
                name: { type: 'string' },
                valid: { type: 'boolean' },
                payloadJson: { type: 'string' },
                expectedIssues: { type: 'array', items: { type: 'string' } },
              },
            },
          },
        },
      },
    },
    openQuestions: { type: 'array', items: { type: 'string' } },
  },
} as const;

export function buildPlanApiContractSystemPrompt() {
  return [
    '[SystemContext]',
    'OpenAPI 3.1.0 互換に正規化できる API contract JSON を生成してください。',
    'Feature Plan、Questionnaire、Blueprint、Data Model は入力 context として扱い、正本の責務を混ぜないでください。',
    'API 経由で観測・変更できる state は、OpenAPI responses、status code、response body の state/status/phase field、error schema に統合してください。',
    'HTTP API の request / response / error validation は、独立した zod_schema_design ではなく components.schemas と validation に統合してください。',
    'UI local state、worker lease、LLM JSON、MCP tool input のような non-HTTP contract は、この view に無理に含めず openQuestions または別 view の必要性として残してください。',
    '',
    '[Output Contract]',
    'JSON object だけを返してください。Markdown は返さないでください。',
    'artifactKind は "plan_mode_api_contract"、view は "api_io_contract" にしてください。',
    'operations には実装予定または変更対象の endpoint だけを書いてください。',
    '各 operation は operationId と responses を必ず持たせてください。',
    'path parameter と GET/HEAD/DELETE の query parameter は operations[].parameters に必ず書いてください。',
    'POST/PUT/PATCH の JSON body は requestBody.schemaName と componentSchemas.fields に必ず書いてください。body field を parameters に混ぜないでください。',
    'query/path/header/cookie parameter は name、in、type、required、description を具体化してください。該当しない場合は空配列にしてください。',
    'requestBody.schemaName、response.schemaName、zodOwnerFile、state field が該当しない場合は null ではなく空文字にしてください。',
    'validation.examples の payloadJson は JSON.stringify 済みの文字列にしてください。',
    'status code は success / validation / conflict / auth / not found / server error のうち実装判断に必要なものだけを具体化してください。',
    'componentSchemas.fields には request / response / error body の主要 field、required、type、enum 相当の判断を必ず反映してください。型名だけで終わらせないでください。',
    'DELETE response、toggle semantics、sort direction、id generation が未確定で project convention から決められない場合は、推測せず openQuestions に残してください。',
  ].join('\n');
}

export function buildPlanApiContractUserPrompt(input: {
  task: string;
  projectStackContext?: string | null;
  featurePlan: string;
  questionnaire: string;
  blueprint: string;
  dataModel: string;
  prompt: string;
}) {
  return [
    '次の context から API Contract view を1つ生成してください。',
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

export function renderPlanApiContractSummary(artifact: PlanApiContractArtifact) {
  const operations = Object.entries(artifact.openapi.paths).flatMap(([path, methods]) =>
    Object.entries(methods).map(([method, operation]) => {
      const summary = operation.summary ? ` - ${operation.summary}` : '';
      return `- ${method.toUpperCase()} ${path} (${operation.operationId})${summary}`;
    })
  );
  return [`# ${artifact.title}`, '', artifact.summary, '', '## Operations', ...operations].join(
    '\n'
  );
}
