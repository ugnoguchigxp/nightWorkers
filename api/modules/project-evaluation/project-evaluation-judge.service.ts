import { z } from '@hono/zod-openapi';
import {
  type ProjectEvaluationBundle,
  type ProjectEvaluationDimensionKey,
  type ProjectEvaluationReport,
  type ProjectEvaluationRun,
  type ProjectImprovementIdea,
  projectEvaluationDimensionLabels,
  projectEvaluationReportSchema,
  projectImprovementIdeasResultSchema,
} from '../../../shared/schemas/project-evaluation.schema';
import type { SupervisorLlmDebugEvent } from '../../services/structured-llm';
import {
  buildNormalizedSupervisorLlmRequest,
  callStructuredJsonLLM,
} from '../../services/structured-llm';
import {
  buildProjectEvaluationSystemPrompt,
  buildProjectEvaluationUserPrompt,
  buildProjectImprovementSystemPrompt,
  buildProjectImprovementUserPrompt,
} from './project-evaluation-prompts';

export type ProjectEvaluationLlmSelection = {
  role: 'evaluation';
  providerId: string;
  providerEndpointId: string | null;
  routeSource: string | null;
  modelOrDeployment: string | null;
  thinkingDepth: string | null;
};

function toJsonSchema(schema: z.ZodTypeAny) {
  return z.toJSONSchema(schema);
}

function fallbackSelectedModelForPrompts(
  systemPrompt: string,
  userPrompt: string,
  schemaName: string,
  schema: unknown
): ProjectEvaluationLlmSelection {
  const normalized = buildNormalizedSupervisorLlmRequest({
    systemPrompt,
    userPrompt,
    label: schemaName,
    role: 'evaluation',
    jsonSchema: {
      name: schemaName,
      schema,
    },
  });
  return {
    role: 'evaluation',
    providerId: normalized.providerId,
    providerEndpointId: normalized.providerEndpointId ?? null,
    routeSource: normalized.routeSource ?? null,
    modelOrDeployment: normalized.modelOrDeployment,
    thinkingDepth: normalized.thinkingDepth ?? null,
  };
}

function selectionFromDebugEvent(
  event: SupervisorLlmDebugEvent
): ProjectEvaluationLlmSelection | null {
  if (event.type !== 'model.request_started') return null;
  const data = event.data || {};
  return {
    role: 'evaluation',
    providerId: typeof data.provider === 'string' ? data.provider : 'unknown',
    providerEndpointId:
      typeof data.providerEndpointId === 'string' ? data.providerEndpointId : null,
    routeSource: typeof data.routeSource === 'string' ? data.routeSource : null,
    modelOrDeployment: typeof data.model === 'string' ? data.model : null,
    thinkingDepth: typeof data.thinkingDepth === 'string' ? data.thinkingDepth : null,
  };
}

async function callProjectEvaluationJson(input: {
  systemPrompt: string;
  userPrompt: string;
  schemaName: string;
  schema: unknown;
  onLlmEvent?: (event: SupervisorLlmDebugEvent) => Promise<void> | void;
}) {
  let selectedModel = fallbackSelectedModelForPrompts(
    input.systemPrompt,
    input.userPrompt,
    input.schemaName,
    input.schema
  );
  const raw = await callStructuredJsonLLM(input.systemPrompt, input.userPrompt, {
    role: 'evaluation',
    schemaName: input.schemaName,
    schema: input.schema,
    emitEvent: async (event) => {
      const nextSelection = selectionFromDebugEvent(event);
      if (nextSelection) selectedModel = nextSelection;
      await input.onLlmEvent?.(event);
    },
  });
  return { raw, selectedModel };
}

function normalizeProjectEvaluationReportLabels(
  report: ProjectEvaluationReport
): ProjectEvaluationReport {
  return {
    ...report,
    dimensions: report.dimensions.map((dimension) => ({
      ...dimension,
      label: projectEvaluationDimensionLabels[dimension.key],
    })),
  };
}

export async function judgeProjectEvaluation(input: {
  bundle: ProjectEvaluationBundle;
  baselinePrompt?: string;
  onLlmEvent?: (event: SupervisorLlmDebugEvent) => Promise<void> | void;
}): Promise<{
  report: ProjectEvaluationReport;
  rawOutput: unknown;
  selectedModel: ProjectEvaluationLlmSelection;
}> {
  const systemPrompt = buildProjectEvaluationSystemPrompt();
  const userPrompt = buildProjectEvaluationUserPrompt(input);
  const called = await callProjectEvaluationJson({
    systemPrompt,
    userPrompt,
    schemaName: 'project_evaluation',
    schema: toJsonSchema(projectEvaluationReportSchema),
    onLlmEvent: input.onLlmEvent,
  });
  const rawOutput = JSON.parse(called.raw) as unknown;
  const report = projectEvaluationReportSchema.parse(rawOutput);
  return {
    report: normalizeProjectEvaluationReportLabels(report),
    rawOutput,
    selectedModel: called.selectedModel,
  };
}

export async function generateProjectImprovementIdeas(input: {
  evaluation: ProjectEvaluationRun;
  bundle: ProjectEvaluationBundle;
  dimensionKeys: ProjectEvaluationDimensionKey[];
  onLlmEvent?: (event: SupervisorLlmDebugEvent) => Promise<void> | void;
}): Promise<{
  ideas: ProjectImprovementIdea[];
  rawOutput: unknown;
  selectedModel: ProjectEvaluationLlmSelection;
}> {
  const systemPrompt = buildProjectImprovementSystemPrompt();
  const userPrompt = buildProjectImprovementUserPrompt(input);
  const called = await callProjectEvaluationJson({
    systemPrompt,
    userPrompt,
    schemaName: 'project_improvement_ideas',
    schema: toJsonSchema(projectImprovementIdeasResultSchema),
    onLlmEvent: input.onLlmEvent,
  });
  const rawOutput = JSON.parse(called.raw) as unknown;
  const parsed = projectImprovementIdeasResultSchema.parse(rawOutput);
  return {
    ideas: parsed.ideas,
    rawOutput,
    selectedModel: called.selectedModel,
  };
}
