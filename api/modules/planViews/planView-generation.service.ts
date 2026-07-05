import mermaid from 'mermaid';
import ts from 'typescript';
import { z } from 'zod';
import {
  type DedicatedDesignView,
  type PlanApiContractArtifact,
  type PlanZodSchemaArtifact,
  planApiContractArtifactSchema,
  planZodSchemaArtifactSchema,
} from '../../../shared/schemas/plan-mode-artifact.schema';
import { AppError, NotFoundError } from '../../lib/errors';
import {
  buildPlanApiContractSystemPrompt,
  buildPlanApiContractUserPrompt,
  PLAN_API_CONTRACT_PROMPT_VERSION,
  planApiContractStructuredOutputSchema,
} from '../../services/structured-generation/prompts/plan-api-contract';
import {
  buildPlanDedicatedViewSystemPrompt,
  buildPlanDedicatedViewUserPrompt,
  type GenericDedicatedViewArtifact,
  genericDedicatedViewSchema,
  PLAN_DEDICATED_VIEW_PROMPT_VERSION,
} from '../../services/structured-generation/prompts/plan-dedicated-view';
import {
  buildPlanZodSchemaSystemPrompt,
  buildPlanZodSchemaUserPrompt,
  PLAN_ZOD_SCHEMA_PROMPT_VERSION,
  planZodSchemaStructuredOutputSchema,
} from '../../services/structured-generation/prompts/plan-zod-schema';
import { callStructuredJsonLLM } from '../../services/structured-llm';
import { parseRepairedJsonWithSchema } from '../../services/structured-llm/json';
import {
  createPlanModeTaskMessage,
  getPlanModeTask,
  listPlanModeTaskMessages,
  type PlanModeTaskMessage,
} from '../nightworkers/nightworkers.plan-mode-core.port';
import { assertPlanModeCapabilityEnabled } from '../nightworkers/nightworkers.plan-mode-settings.service';
import { resolvePlanModeProjectStackContext } from '../specification/plan-mode-project-stack-context';
import { getPlanModeWorkspace } from '../specification/plan-mode-workspace.service';
import { assertPlanModeMutable } from '../specification/specification-mutability';

const PLAN_VIEW_MERMAID_MAX_ATTEMPTS = 3;
const httpMethodSchema = z.enum(['get', 'post', 'put', 'patch', 'delete', 'options', 'head']);
const jsonSchemaFieldTypeSchema = z.enum([
  'string',
  'number',
  'integer',
  'boolean',
  'object',
  'array',
  'unknown',
]);

export const genericPlanViewSchema = z.enum([
  'user_flow',
  'api_io_contract',
  'activity_flow',
  'sequence_flow',
  'zod_schema_design',
]);

export type GenericPlanView = z.infer<typeof genericPlanViewSchema>;

export const markdownPlanViewSchema = z.enum(['user_flow', 'activity_flow', 'sequence_flow']);

export type MarkdownPlanView = z.infer<typeof markdownPlanViewSchema>;

export type PlanViewGenerationInput = {
  prompt?: string;
  questionnaireSessionId?: string | null;
  featurePlanMessageId?: string | null;
  sourceBlueprintMessageId?: string | null;
  sourceDataModelMessageId?: string | null;
};

const planApiContractDraftSchema = z.object({
  artifactKind: z.literal('plan_mode_api_contract'),
  view: z.literal('api_io_contract'),
  title: z.string().min(1),
  summary: z.string().min(1),
  operations: z
    .array(
      z.object({
        path: z.string().min(1),
        method: httpMethodSchema,
        operationId: z.string().min(1),
        summary: z.string(),
        description: z.string(),
        tags: z.array(z.string()),
        requestBody: z.object({
          description: z.string(),
          schemaName: z.string(),
          required: z.boolean(),
        }),
        responses: z
          .array(
            z.object({
              status: z.number().int().min(100).max(599),
              description: z.string(),
              schemaName: z.string(),
            })
          )
          .min(1),
      })
    )
    .min(1),
  componentSchemas: z.array(
    z.object({
      name: z.string().min(1),
      description: z.string(),
      fields: z.array(
        z.object({
          name: z.string().min(1),
          type: jsonSchemaFieldTypeSchema,
          required: z.boolean(),
          description: z.string(),
        })
      ),
    })
  ),
  stateTransitions: z.array(
    z.object({
      operationId: z.string().min(1),
      fromState: z.string(),
      toState: z.string(),
      successStatus: z.number().int().min(100).max(599),
      conflictStatuses: z.array(z.number().int().min(100).max(599)),
      stateField: z.string(),
      notes: z.array(z.string()),
    })
  ),
  validation: z.array(
    z.object({
      schemaName: z.string().min(1),
      owner: z.enum(['request', 'response', 'error', 'shared']),
      zodOwnerFile: z.string(),
      strictness: z.enum(['strict', 'passthrough', 'strip', 'unknown']),
      examples: z.array(
        z.object({
          name: z.string().min(1),
          valid: z.boolean(),
          payloadJson: z.string(),
          expectedIssues: z.array(z.string()),
        })
      ),
    })
  ),
  openQuestions: z.array(z.string()),
});

const planZodSchemaDraftSchema = z.object({
  artifactKind: z.literal('plan_mode_zod_schema'),
  view: z.literal('zod_schema_design'),
  title: z.string().min(1),
  summary: z.string().min(1),
  schemaName: z.string().min(1),
  owner: z.enum(['llm_json', 'worker_tool_input', 'mcp_input', 'provider_adapter', 'local_config']),
  zodSource: z.string().min(1),
  openQuestions: z.array(z.string()),
});

export async function generatePlanViewArtifact(
  taskId: string,
  view: DedicatedDesignView,
  input: PlanViewGenerationInput = {}
) {
  const parsedView = genericPlanViewSchema.safeParse(view);
  if (!parsedView.success) {
    throw new AppError(422, 'UNSUPPORTED_PLAN_VIEW', `Unsupported generic plan view: ${view}`);
  }
  const task = await getPlanModeTask(taskId);
  if (!task) throw new NotFoundError('Task not found');
  assertPlanModeCapabilityEnabled(parsedView.data);
  assertPlanModeMutable(task);

  const messages = await listPlanModeTaskMessages(taskId);
  const featurePlanMessage = resolveMessage(messages, input.featurePlanMessageId, 'feature_plan');
  const blueprintMessage = resolveMessage(messages, input.sourceBlueprintMessageId, 'blueprint');
  const dataModelMessage = resolveMessage(messages, input.sourceDataModelMessageId, 'data_model');
  const prompt =
    input.prompt?.trim() ||
    task.objective ||
    task.description ||
    task.title ||
    'No additional prompt.';
  const projectStackContext = await resolvePlanModeProjectStackContext(task.repositoryId);
  const sourceMessageIds = [
    featurePlanMessage?.id,
    blueprintMessage?.id,
    dataModelMessage?.id,
  ].filter((id): id is string => Boolean(id));
  if (parsedView.data === 'api_io_contract') {
    const artifact = await generateApiContractArtifactFromLlm({
      taskId,
      task: renderTaskContext(task),
      projectStackContext,
      featurePlan: featurePlanMessage?.content || 'Feature Plan は未生成です。',
      questionnaire: input.questionnaireSessionId
        ? `Questionnaire session: ${input.questionnaireSessionId}`
        : 'Questionnaire は指定されていません。',
      blueprint: blueprintMessage?.content || 'Blueprint は未生成です。',
      dataModel: dataModelMessage?.content || 'Data Model は未生成です。',
      prompt,
    });
    const message = await createPlanModeTaskMessage({
      taskId,
      role: 'assistant',
      content: JSON.stringify(artifact.openapi, null, 2),
      messageType: 'api_contract',
      payloadJson: {
        artifactKind: 'plan_mode_api_contract',
        view: artifact.view,
        source: 'dedicated-view-generator',
        title: artifact.title,
        intent: 'plan_mode_dedicated_view',
        artifactType: artifact.view,
        apiContract: artifact,
        artifactPayload: artifact,
        featurePlanMessageId: featurePlanMessage?.id ?? null,
        questionnaireSessionId: input.questionnaireSessionId ?? null,
        sourceBlueprintMessageId: blueprintMessage?.id ?? null,
        sourceDataModelMessageId: dataModelMessage?.id ?? null,
        sourceMessageIds,
        generation: {
          promptVersion: PLAN_API_CONTRACT_PROMPT_VERSION,
        },
      },
    });
    return { message, workspace: await getPlanModeWorkspace(taskId) };
  }
  if (parsedView.data === 'zod_schema_design') {
    const artifact = await generateZodSchemaArtifactFromLlm({
      taskId,
      task: renderTaskContext(task),
      projectStackContext,
      featurePlan: featurePlanMessage?.content || 'Feature Plan は未生成です。',
      questionnaire: input.questionnaireSessionId
        ? `Questionnaire session: ${input.questionnaireSessionId}`
        : 'Questionnaire は指定されていません。',
      blueprint: blueprintMessage?.content || 'Blueprint は未生成です。',
      dataModel: dataModelMessage?.content || 'Data Model は未生成です。',
      prompt,
    });
    const message = await createPlanModeTaskMessage({
      taskId,
      role: 'assistant',
      content: artifact.zodSource,
      messageType: 'zod_schema',
      payloadJson: {
        artifactKind: 'plan_mode_zod_schema',
        view: artifact.view,
        source: 'dedicated-view-generator',
        title: artifact.title,
        intent: 'plan_mode_dedicated_view',
        artifactType: artifact.view,
        zodSchema: artifact,
        artifactPayload: artifact,
        featurePlanMessageId: featurePlanMessage?.id ?? null,
        questionnaireSessionId: input.questionnaireSessionId ?? null,
        sourceBlueprintMessageId: blueprintMessage?.id ?? null,
        sourceDataModelMessageId: dataModelMessage?.id ?? null,
        sourceMessageIds,
        generation: {
          promptVersion: PLAN_ZOD_SCHEMA_PROMPT_VERSION,
        },
      },
    });
    return { message, workspace: await getPlanModeWorkspace(taskId) };
  }
  const artifact = await generateArtifactFromLlm({
    view: markdownPlanViewSchema.parse(parsedView.data),
    taskId,
    task: renderTaskContext(task),
    projectStackContext,
    featurePlan: featurePlanMessage?.content || 'Feature Plan は未生成です。',
    questionnaire: input.questionnaireSessionId
      ? `Questionnaire session: ${input.questionnaireSessionId}`
      : 'Questionnaire は指定されていません。',
    blueprint: blueprintMessage?.content || 'Blueprint は未生成です。',
    dataModel: dataModelMessage?.content || 'Data Model は未生成です。',
    prompt,
  });
  const message = await createPlanModeTaskMessage({
    taskId,
    role: 'assistant',
    content: artifact.markdown,
    messageType: 'markdown_document',
    payloadJson: {
      artifactKind: 'plan_mode_dedicated_view',
      view: artifact.view,
      source: 'dedicated-view-generator',
      title: artifact.title,
      intent: 'plan_mode_dedicated_view',
      artifactType: artifact.view,
      ...(artifact.diagramKind ? { diagramKind: artifact.diagramKind } : {}),
      featurePlanMessageId: featurePlanMessage?.id ?? null,
      questionnaireSessionId: input.questionnaireSessionId ?? null,
      sourceBlueprintMessageId: blueprintMessage?.id ?? null,
      sourceDataModelMessageId: dataModelMessage?.id ?? null,
      sourceMessageIds,
      generation: {
        promptVersion: PLAN_DEDICATED_VIEW_PROMPT_VERSION,
      },
    },
  });
  return { message, workspace: await getPlanModeWorkspace(taskId) };
}

export function parseGenericDedicatedViewOutput(
  rawOutput: string,
  expectedView: MarkdownPlanView
): GenericDedicatedViewArtifact {
  const parsed = parseRepairedJsonWithSchema(
    rawOutput,
    z
      .object({
        artifactKind: z.literal('plan_mode_dedicated_view'),
        view: markdownPlanViewSchema,
        title: z.string().min(1),
        markdown: z.string().min(1),
        diagramKind: z
          .enum(['stateDiagram-v2', 'flowchart', 'sequenceDiagram'])
          .nullable()
          .optional(),
      })
      .transform((artifact) => {
        if (artifact.diagramKind === null) {
          const { diagramKind: _diagramKind, ...normalized } = artifact;
          return normalized;
        }
        return artifact;
      })
  );
  if (!parsed.ok) throw new Error('Plan view LLM output did not contain valid JSON.');
  if (parsed.value.view !== expectedView) {
    throw new Error(`Plan view output used ${parsed.value.view}, expected ${expectedView}.`);
  }
  validateDedicatedViewMarkdown(parsed.value);
  return parsed.value;
}

function validateDedicatedViewMarkdown(artifact: GenericDedicatedViewArtifact) {
  const lower = artifact.markdown.toLowerCase();
  const forbiddenDiagram = 'use' + 'case';
  if (lower.includes(`${forbiddenDiagram}diagram`) || lower.includes(forbiddenDiagram)) {
    throw new Error('Unsupported diagram output is not allowed in Plan Mode views.');
  }
  const expectedDiagramKind = diagramKindForView(artifact.view);
  if (!expectedDiagramKind) return;
  if (requiresMermaidDiagram(artifact.view)) {
    if (!artifact.markdown.includes('```mermaid')) {
      throw new Error(`${artifact.view} must be rendered as a Mermaid diagram.`);
    }
    if (!artifact.diagramKind) {
      throw new Error(`${artifact.view} Mermaid output must include diagramKind.`);
    }
    if (artifact.diagramKind !== expectedDiagramKind) {
      throw new Error(`${artifact.view} must use ${expectedDiagramKind}.`);
    }
  }
  if (artifact.diagramKind && artifact.diagramKind !== expectedDiagramKind) {
    throw new Error(`${artifact.view} must use ${expectedDiagramKind}.`);
  }
  if (artifact.markdown.includes('```mermaid')) {
    if (!artifact.diagramKind) {
      throw new Error(`${artifact.view} Mermaid output must include diagramKind.`);
    }
    const requiredMarker = expectedDiagramKind === 'flowchart' ? 'flowchart ' : expectedDiagramKind;
    if (!artifact.markdown.includes(requiredMarker)) {
      throw new Error(`${artifact.view} Mermaid output must include ${requiredMarker}.`);
    }
  }
}

function diagramKindForView(view: MarkdownPlanView) {
  if (view === 'user_flow') return 'flowchart' as const;
  if (view === 'activity_flow') return 'flowchart' as const;
  if (view === 'sequence_flow') return 'sequenceDiagram' as const;
  return null;
}

function requiresMermaidDiagram(view: MarkdownPlanView) {
  return Boolean(diagramKindForView(view));
}

function resolveMessage(
  messages: PlanModeTaskMessage[],
  messageId: string | null | undefined,
  kind: 'feature_plan' | 'blueprint' | 'data_model'
) {
  if (messageId)
    return (
      messages.find((message) => message.id === messageId && isMessageKind(message, kind)) || null
    );
  return [...messages].reverse().find((message) => isMessageKind(message, kind)) || null;
}

async function generateArtifactFromLlm(input: {
  view: MarkdownPlanView;
  taskId: string;
  task: string;
  projectStackContext: string;
  featurePlan: string;
  questionnaire: string;
  blueprint: string;
  dataModel: string;
  prompt: string;
}) {
  try {
    let repairContext: string | null = null;
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= PLAN_VIEW_MERMAID_MAX_ATTEMPTS; attempt += 1) {
      const rawOutput = await callStructuredJsonLLM(
        buildPlanDedicatedViewSystemPrompt(input.view),
        buildPlanDedicatedViewUserPrompt({ ...input, repairContext }),
        {
          schemaName: 'plan_mode_dedicated_view',
          schema: genericDedicatedViewSchema,
          taskId: input.taskId,
          runId: null,
          role: 'plan',
        }
      );
      try {
        const artifact = normalizePlanViewMermaidArtifact(
          parseGenericDedicatedViewOutput(rawOutput, input.view)
        );
        const mermaidError = await validatePlanViewMermaidArtifact(artifact);
        if (!mermaidError) return artifact;
        lastError = new Error(mermaidError.error);
        repairContext = buildPlanViewMermaidRepairContext({
          artifact,
          chart: mermaidError.chart,
          error: mermaidError.error,
        });
      } catch (err) {
        lastError = err;
        repairContext = buildPlanViewOutputRepairContext(rawOutput, err);
      }
    }
    throw lastError instanceof Error ? lastError : new Error('Plan view generation failed.');
  } catch (err) {
    if (err instanceof AppError) throw err;
    const message = err instanceof Error ? err.message : 'Plan view generation failed.';
    throw new AppError(502, 'PLAN_VIEW_GENERATION_FAILED', message);
  }
}

async function generateApiContractArtifactFromLlm(input: {
  taskId: string;
  task: string;
  projectStackContext: string;
  featurePlan: string;
  questionnaire: string;
  blueprint: string;
  dataModel: string;
  prompt: string;
}) {
  try {
    const rawOutput = await callStructuredJsonLLM(
      buildPlanApiContractSystemPrompt(),
      buildPlanApiContractUserPrompt(input),
      {
        schemaName: 'plan_mode_api_contract',
        schema: planApiContractStructuredOutputSchema,
        taskId: input.taskId,
        runId: null,
        role: 'plan',
      }
    );
    return parsePlanApiContractOutput(rawOutput);
  } catch (err) {
    if (err instanceof AppError) throw err;
    const message = err instanceof Error ? err.message : 'Plan API contract generation failed.';
    throw new AppError(502, 'PLAN_API_CONTRACT_GENERATION_FAILED', message);
  }
}

async function generateZodSchemaArtifactFromLlm(input: {
  taskId: string;
  task: string;
  projectStackContext: string;
  featurePlan: string;
  questionnaire: string;
  blueprint: string;
  dataModel: string;
  prompt: string;
}) {
  try {
    const rawOutput = await callStructuredJsonLLM(
      buildPlanZodSchemaSystemPrompt(),
      buildPlanZodSchemaUserPrompt(input),
      {
        schemaName: 'plan_mode_zod_schema',
        schema: planZodSchemaStructuredOutputSchema,
        taskId: input.taskId,
        runId: null,
        role: 'plan',
      }
    );
    return parsePlanZodSchemaOutput(rawOutput, {
      sourceText: buildZodSchemaSourceEvidence(input),
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    const message = err instanceof Error ? err.message : 'Plan Zod schema generation failed.';
    throw new AppError(502, 'PLAN_ZOD_SCHEMA_GENERATION_FAILED', message);
  }
}

export function parsePlanZodSchemaOutput(
  rawOutput: string,
  options: { sourceText?: string | null } = {}
): PlanZodSchemaArtifact {
  const parsed = parseRepairedJsonWithSchema(rawOutput, planZodSchemaDraftSchema);
  if (!parsed.ok) throw new Error('Plan Zod schema output did not contain valid JSON.');
  validatePlanZodSchemaTarget(parsed.value, options.sourceText);
  const parsedSource = parseZodObjectSource(parsed.value.zodSource);
  return planZodSchemaArtifactSchema.parse({
    ...parsed.value,
    fields: parsedSource.fields,
    unsupportedExpressions: parsedSource.unsupportedExpressions,
  });
}

function buildZodSchemaSourceEvidence(input: {
  task: string;
  featurePlan: string;
  questionnaire: string;
  blueprint: string;
  dataModel: string;
  prompt: string;
}) {
  return [
    input.task,
    input.featurePlan,
    input.questionnaire,
    input.blueprint,
    input.dataModel,
    input.prompt,
  ].join('\n');
}

function validatePlanZodSchemaTarget(
  artifact: z.infer<typeof planZodSchemaDraftSchema>,
  sourceText: string | null | undefined
) {
  const combined = [artifact.title, artifact.summary, artifact.schemaName, artifact.zodSource]
    .join('\n')
    .toLowerCase();
  const forbiddenMetaTerms = [
    'plandecision',
    'plan decision',
    'planmode',
    'plan mode',
    'questionnaire',
    'decisionschema',
    'decision schema',
    'nightworkers',
  ];
  const matched = forbiddenMetaTerms.find((term) => combined.includes(term));
  if (matched) {
    throw new Error(
      `Plan Zod schema output targeted Plan Mode metadata instead of the target application schema: ${matched}`
    );
  }
  validatePlanZodSchemaScope(artifact, sourceText);
}

function validatePlanZodSchemaScope(
  artifact: z.infer<typeof planZodSchemaDraftSchema>,
  sourceText: string | null | undefined
) {
  const declaredSchemaNames = extractZodConstSchemaNames(artifact.zodSource);
  const aggregateSchema = declaredSchemaNames.find((name) =>
    /(?:runtime|aggregate|root)schema$/i.test(name)
  );
  if (aggregateSchema) {
    throw new Error(`Plan Zod schema output included an aggregate/root schema: ${aggregateSchema}`);
  }
  const context = normalizeScopeText(sourceText || '');
  const scopedRules = [
    {
      label: 'settings/preference schema',
      namePattern: /(?:settings|setting|preferences|preference|config)schema$/i,
      contextPattern: /settings?|preferences?|config|設定|既定|デフォルト|default/i,
    },
    {
      label: 'sort schema',
      namePattern: /(?:sort|order|ordering)schema$/i,
      contextPattern: /sort|order|ordering|並び替え|並び順|ソート/i,
    },
    {
      label: 'filter/search schema',
      namePattern: /(?:filter|search|query)schema$/i,
      contextPattern: /filter|search|query|絞り込み|検索|フィルタ/i,
    },
    {
      label: 'list/category/group management schema',
      namePattern: /(?:list|category|group)(?:input)?schema$/i,
      contextPattern: /list|category|group|リスト|カテゴリ|分類|グループ/i,
    },
  ];
  for (const rule of scopedRules) {
    const schemaName = declaredSchemaNames.find((name) => rule.namePattern.test(name));
    if (schemaName && !rule.contextPattern.test(context)) {
      throw new Error(
        `Plan Zod schema output included ${rule.label} without source scope evidence: ${schemaName}`
      );
    }
  }
  if (declaredSchemaNames.length > 4) {
    throw new Error(
      `Plan Zod schema output included too many object schemas for a focused validation view: ${declaredSchemaNames.length}`
    );
  }
}

function extractZodConstSchemaNames(zodSource: string) {
  const sourceFile = ts.createSourceFile(
    'plan-zod-schema.ts',
    zodSource,
    ts.ScriptTarget.Latest,
    true
  );
  const names: string[] = [];
  sourceFile.forEachChild((node) => {
    if (!ts.isVariableStatement(node)) return;
    for (const declaration of node.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
      if (containsZodObjectCall(declaration.initializer)) {
        names.push(declaration.name.text);
      }
    }
  });
  return names;
}

function containsZodObjectCall(expression: ts.Expression): boolean {
  if (ts.isCallExpression(expression) && isZodMethodCall(expression, 'object')) return true;
  if (ts.isCallExpression(expression)) return containsZodObjectCall(expression.expression);
  if (ts.isPropertyAccessExpression(expression))
    return containsZodObjectCall(expression.expression);
  if (ts.isParenthesizedExpression(expression)) return containsZodObjectCall(expression.expression);
  return false;
}

function normalizeScopeText(value: string) {
  return value.toLowerCase();
}

export function parsePlanApiContractOutput(rawOutput: string): PlanApiContractArtifact {
  const artifact = parseRepairedJsonWithSchema(rawOutput, planApiContractArtifactSchema);
  if (artifact.ok) {
    validateApiContractOperationReferences(artifact.value);
    return artifact.value;
  }

  const draft = parseRepairedJsonWithSchema(rawOutput, planApiContractDraftSchema);
  if (!draft.ok) throw new Error('Plan API contract output did not contain valid JSON.');
  const normalized = normalizePlanApiContractDraft(draft.value);
  validateApiContractOperationReferences(normalized);
  return normalized;
}

function validateApiContractOperationReferences(artifact: PlanApiContractArtifact) {
  const operationIds = new Set(
    Object.values(artifact.openapi.paths).flatMap((methods) =>
      Object.values(methods).map((operation) => operation.operationId)
    )
  );
  for (const transition of artifact.stateTransitions) {
    if (!operationIds.has(transition.operationId)) {
      throw new Error(`State transition references unknown operationId: ${transition.operationId}`);
    }
  }
}

function normalizePlanApiContractDraft(
  draft: z.infer<typeof planApiContractDraftSchema>
): PlanApiContractArtifact {
  const components = Object.fromEntries(
    draft.componentSchemas.map((schema) => [
      schema.name,
      {
        type: 'object',
        description: blankToUndefined(schema.description),
        properties: Object.fromEntries(
          schema.fields.map((field) => [
            field.name,
            {
              ...jsonSchemaTypeForField(field.type),
              description: blankToUndefined(field.description),
            },
          ])
        ),
        required: schema.fields.filter((field) => field.required).map((field) => field.name),
      },
    ])
  );
  const paths: PlanApiContractArtifact['openapi']['paths'] = {};
  for (const operationDraft of draft.operations) {
    const pathOperations = paths[operationDraft.path] ?? {};
    paths[operationDraft.path] = pathOperations;
    const requestSchemaName = operationDraft.requestBody.schemaName.trim();
    const operation: PlanApiContractArtifact['openapi']['paths'][string][string] = {
      operationId: operationDraft.operationId,
      summary: blankToNull(operationDraft.summary),
      description: blankToNull(operationDraft.description),
      tags: operationDraft.tags,
      responses: Object.fromEntries(
        operationDraft.responses.map((response) => [
          String(response.status),
          {
            description: response.description || 'Response',
            ...contentForSchemaName(response.schemaName),
          },
        ])
      ),
    };
    if (requestSchemaName) {
      operation.requestBody = {
        required: operationDraft.requestBody.required,
        description: blankToUndefined(operationDraft.requestBody.description),
        ...contentForSchemaName(requestSchemaName),
      };
    }
    pathOperations[operationDraft.method] = operation;
  }
  const parsed = planApiContractArtifactSchema.parse({
    artifactKind: 'plan_mode_api_contract',
    view: 'api_io_contract',
    title: draft.title,
    summary: draft.summary,
    openapi: {
      openapi: '3.1.0',
      info: {
        title: draft.title,
        version: '0.1.0',
      },
      paths,
      components: {
        schemas: components,
      },
    },
    stateTransitions: draft.stateTransitions.map((transition) => ({
      operationId: transition.operationId,
      fromState: blankToNull(transition.fromState),
      toState: blankToNull(transition.toState),
      successStatus: transition.successStatus,
      conflictStatuses: transition.conflictStatuses,
      stateField: blankToNull(transition.stateField),
      notes: transition.notes,
    })),
    validation: draft.validation.map((entry) => ({
      schemaName: entry.schemaName,
      owner: entry.owner,
      zodOwnerFile: blankToNull(entry.zodOwnerFile),
      strictness: entry.strictness,
      examples: entry.examples.map((example) => ({
        name: example.name,
        valid: example.valid,
        payload: parsePayloadJson(example.payloadJson),
        expectedIssues: example.expectedIssues,
      })),
    })),
    openQuestions: draft.openQuestions,
  });
  return parsed;
}

function contentForSchemaName(schemaName: string) {
  const normalized = schemaName.trim();
  if (!normalized) return {};
  return {
    content: {
      'application/json': {
        schema: {
          $ref: `#/components/schemas/${normalized}`,
        },
      },
    },
  };
}

function jsonSchemaTypeForField(type: z.infer<typeof jsonSchemaFieldTypeSchema>) {
  if (type === 'unknown') return {};
  if (type === 'array') return { type: 'array', items: {} };
  return { type };
}

function parsePayloadJson(payloadJson: string): unknown {
  try {
    return JSON.parse(payloadJson);
  } catch {
    return payloadJson;
  }
}

function blankToNull(value: string) {
  const normalized = value.trim();
  return normalized ? normalized : null;
}

function blankToUndefined(value: string) {
  const normalized = value.trim();
  return normalized ? normalized : undefined;
}

function parseZodObjectSource(zodSource: string): {
  fields: PlanZodSchemaArtifact['fields'];
  unsupportedExpressions: string[];
} {
  const sourceFile = ts.createSourceFile(
    'plan-zod-schema.ts',
    zodSource,
    ts.ScriptTarget.Latest,
    true
  );
  const objectLiteral = findFirstZodObjectLiteral(sourceFile);
  if (!objectLiteral) {
    throw new Error('Zod schema source must contain a top-level z.object({...}) schema.');
  }
  const fields: PlanZodSchemaArtifact['fields'] = [];
  const unsupportedExpressions: string[] = [];
  fields.push(...parseZodObjectFields(objectLiteral, sourceFile));
  for (const field of fields) {
    if (field.type === 'unknown') {
      unsupportedExpressions.push(`${field.name}: ${field.zodExpression}`);
    }
  }
  if (fields.length === 0) {
    throw new Error('Zod schema source must define at least one object field.');
  }
  return { fields, unsupportedExpressions };
}

function parseZodObjectFields(
  objectLiteral: ts.ObjectLiteralExpression,
  sourceFile: ts.SourceFile
): PlanZodSchemaArtifact['fields'] {
  const fields: PlanZodSchemaArtifact['fields'] = [];
  for (const property of objectLiteral.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const name = propertyNameText(property.name);
    if (!name) continue;
    const expression = property.initializer;
    const field = analyzeZodFieldExpression(name, expression, sourceFile);
    fields.push(field);
  }
  return fields;
}

function findFirstZodObjectLiteral(sourceFile: ts.SourceFile): ts.ObjectLiteralExpression | null {
  const visit = (node: ts.Node): ts.ObjectLiteralExpression | null => {
    if (ts.isCallExpression(node) && isZodMethodCall(node, 'object')) {
      const firstArg = node.arguments[0];
      if (firstArg && ts.isObjectLiteralExpression(firstArg)) {
        return firstArg;
      }
    }
    return ts.forEachChild(node, visit) ?? null;
  };
  return visit(sourceFile);
}

function analyzeZodFieldExpression(
  name: string,
  expression: ts.Expression,
  sourceFile: ts.SourceFile
): PlanZodSchemaArtifact['fields'][number] {
  const analysis: PlanZodSchemaArtifact['fields'][number] = {
    name,
    type: 'unknown',
    required: true,
    description: null,
    enumOptions: [],
    defaultValue: null,
    referencedSchema: null,
    children: [],
    rules: [],
    zodExpression: expression.getText(sourceFile),
  };
  collectZodCalls(expression, sourceFile, analysis);
  if (analysis.type === 'unknown') {
    const referencedSchema = zodExpressionRootIdentifier(expression);
    if (referencedSchema) {
      analysis.type = 'reference';
      analysis.referencedSchema = referencedSchema;
    }
  }
  return analysis;
}

function collectZodCalls(
  expression: ts.Expression,
  sourceFile: ts.SourceFile,
  analysis: PlanZodSchemaArtifact['fields'][number]
) {
  if (!ts.isCallExpression(expression) || !ts.isPropertyAccessExpression(expression.expression)) {
    return;
  }
  const method = expression.expression.name.text;
  const target = expression.expression.expression;
  if (ts.isIdentifier(target) && target.text === 'z') {
    applyZodBaseCall(method, expression, sourceFile, analysis);
    return;
  }
  collectZodCalls(target, sourceFile, analysis);
  applyZodRuleCall(method, expression, sourceFile, analysis);
}

function zodExpressionRootIdentifier(expression: ts.Expression): string | null {
  if (ts.isIdentifier(expression)) {
    return expression.text === 'z' ? null : expression.text;
  }
  if (ts.isCallExpression(expression)) {
    return zodExpressionRootIdentifier(expression.expression);
  }
  if (ts.isPropertyAccessExpression(expression)) {
    return zodExpressionRootIdentifier(expression.expression);
  }
  if (ts.isParenthesizedExpression(expression)) {
    return zodExpressionRootIdentifier(expression.expression);
  }
  return null;
}

function applyZodBaseCall(
  method: string,
  expression: ts.CallExpression,
  sourceFile: ts.SourceFile,
  analysis: PlanZodSchemaArtifact['fields'][number]
) {
  if (method === 'string' || method === 'number' || method === 'boolean' || method === 'array') {
    analysis.type = method;
    return;
  }
  if (method === 'enum') {
    analysis.type = 'enum';
    const values = expression.arguments[0];
    if (values && ts.isArrayLiteralExpression(values)) {
      analysis.enumOptions = values.elements
        .map((element) => literalValue(element, sourceFile))
        .filter((value): value is string => typeof value === 'string');
    }
  }
  if (method === 'object') {
    analysis.type = 'object';
    const objectLiteral = expression.arguments[0];
    if (objectLiteral && ts.isObjectLiteralExpression(objectLiteral)) {
      analysis.children = parseZodObjectFields(objectLiteral, sourceFile);
    }
  }
}

function applyZodRuleCall(
  method: string,
  expression: ts.CallExpression,
  sourceFile: ts.SourceFile,
  analysis: PlanZodSchemaArtifact['fields'][number]
) {
  if (method === 'optional' || method === 'nullish') {
    analysis.required = false;
  }
  if (method === 'default') {
    analysis.required = false;
    analysis.defaultValue = literalValue(expression.arguments[0], sourceFile) ?? null;
  }
  if (method === 'describe') {
    const description = literalValue(expression.arguments[0], sourceFile);
    if (typeof description === 'string') analysis.description = description;
  }
  const ruleNames = new Set([
    'min',
    'max',
    'length',
    'email',
    'url',
    'uuid',
    'regex',
    'int',
    'positive',
    'nonnegative',
    'optional',
    'nullable',
    'nullish',
    'default',
    'describe',
    'trim',
    'strict',
  ]);
  if (!ruleNames.has(method)) return;
  analysis.rules.push({
    name: method,
    args: expression.arguments
      .map((argument) => literalValue(argument, sourceFile))
      .filter((value): value is string | number | boolean => value !== null),
    message: null,
  });
}

function isZodMethodCall(node: ts.CallExpression, method: string) {
  return (
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === method &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === 'z'
  );
}

function propertyNameText(name: ts.PropertyName) {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return null;
}

function literalValue(node: ts.Node | undefined, sourceFile: ts.SourceFile) {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  return node.getText(sourceFile);
}

async function validatePlanViewMermaidArtifact(artifact: GenericDedicatedViewArtifact) {
  const chart = extractMermaidChart(artifact.markdown);
  if (!chart) return null;
  const parseChart = chart.trim().startsWith('flowchart') ? stripFlowchartLabels(chart) : chart;
  try {
    await mermaid.parse(parseChart);
    return null;
  } catch (err) {
    return { chart, error: err instanceof Error ? err.message : String(err) };
  }
}

export function normalizePlanViewMermaidArtifact(
  artifact: GenericDedicatedViewArtifact
): GenericDedicatedViewArtifact {
  const chart = extractMermaidChart(artifact.markdown);
  if (!chart?.trim().startsWith('flowchart')) return artifact;
  const sanitizedChart = sanitizeFlowchartLabels(chart);
  if (sanitizedChart === chart) return artifact;
  return {
    ...artifact,
    markdown: artifact.markdown.replace(/```mermaid\s*([\s\S]*?)```/i, () =>
      ['```mermaid', sanitizedChart, '```'].join('\n')
    ),
  };
}

function sanitizeFlowchartLabels(chart: string) {
  return chart
    .split('\n')
    .map((line) =>
      line
        .replace(/\["([^"\n]*)"\]/g, (_match, label: string) => `["${sanitizeMermaidText(label)}"]`)
        .replace(/\[([^\]\n]*)\]/g, (_match, label: string) => `["${sanitizeMermaidText(label)}"]`)
        .replace(/\(([^)\n]*)\)/g, (_match, label: string) => `("${sanitizeMermaidText(label)}")`)
        .replace(/\{([^}\n]*)\}/g, (_match, label: string) => `{"${sanitizeMermaidText(label)}"}`)
    )
    .join('\n');
}

function sanitizeMermaidText(value: string) {
  return value
    .replace(/`([^`]*)`/g, '$1')
    .replace(/`/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_~]/g, '')
    .replace(/[{}<>]/g, ' ')
    .replaceAll('[', ' ')
    .replaceAll(']', ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');
}

function stripFlowchartLabels(chart: string) {
  return chart
    .split('\n')
    .map((line) =>
      line
        .replace(/\[[^\]\n]*\]/g, '')
        .replace(/\([^)\n]*\)/g, '')
        .replace(/\{[^}\n]*\}/g, '')
    )
    .join('\n');
}

function buildPlanViewMermaidRepairContext(input: {
  artifact: GenericDedicatedViewArtifact;
  chart: string;
  error: string;
}) {
  return [
    '### Error',
    input.error,
    '',
    '### Previous Mermaid source',
    '```mermaid',
    input.chart.trim(),
    '```',
    '',
    '### Previous artifact JSON',
    JSON.stringify(input.artifact, null, 2),
  ].join('\n');
}

function buildPlanViewOutputRepairContext(rawOutput: string, err: unknown) {
  return [
    '### Error',
    err instanceof Error ? err.message : String(err),
    '',
    '### Previous raw output',
    rawOutput,
  ].join('\n');
}

function extractMermaidChart(content: string) {
  const match = content.match(/```mermaid\s*([\s\S]*?)```/i);
  return match?.[1]?.trim() || null;
}

function isMessageKind(
  message: PlanModeTaskMessage,
  kind: 'feature_plan' | 'blueprint' | 'data_model'
) {
  if (message.messageType !== 'markdown_document') return false;
  const metadata = (message.metadataJson || {}) as Record<string, unknown>;
  if (kind === 'feature_plan') return metadata.intent === 'feature_plan';
  if (kind === 'blueprint')
    return (
      (metadata.intent === 'app_blueprint' && Boolean(metadata.appBlueprint)) ||
      (metadata.intent === 'mock_blueprint' && Boolean(metadata.mockBlueprint))
    );
  return metadata.artifactKind === 'plan_mode_dedicated_view' && metadata.view === 'data_model';
}

function renderTaskContext(task: {
  title?: string | null;
  description?: string | null;
  objective?: string | null;
}) {
  return [
    `Title: ${task.title || 'Untitled'}`,
    task.description ? `Description: ${task.description}` : '',
    task.objective ? `Objective: ${task.objective}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}
