import { z } from '@hono/zod-openapi';
import {
  type Mission,
  type MissionDecompositionEvaluation,
  type MissionDecompositionPlanningResult,
  type MissionDeterministicCheckReport,
  missionDecompositionEvaluationSchema,
} from '../../../shared/schemas/mission-planner.schema';
import type { ProjectSignalSnapshot } from '../../../shared/schemas/project-detail.schema';
import type { SupervisorLlmDebugEvent } from '../../services/structured-llm';
import {
  buildNormalizedSupervisorLlmRequest,
  callStructuredJsonLLM,
} from '../../services/structured-llm';
import {
  buildMissionEvaluationSystemPrompt,
  buildMissionEvaluationUserPrompt,
} from './mission-planner.prompts';

export type MissionPlannerLlmSelection = {
  stage: 'mission_candidates' | 'mission_draft' | 'structure' | 'task_proposals' | 'evaluation';
  providerId: string;
  providerEndpointId: string | null;
  routeSource: string | null;
  modelOrDeployment: string | null;
  thinkingDepth: string | null;
};

export function fallbackSelectedModelForMissionStage(input: {
  stage: MissionPlannerLlmSelection['stage'];
  systemPrompt: string;
  userPrompt: string;
  schemaName: string;
  schema: unknown;
}): MissionPlannerLlmSelection {
  const normalized = buildNormalizedSupervisorLlmRequest({
    systemPrompt: input.systemPrompt,
    userPrompt: input.userPrompt,
    label: input.schemaName,
    role: input.stage === 'evaluation' ? 'evaluation' : 'mission_task_generation',
    jsonSchema: { name: input.schemaName, schema: input.schema },
  });
  return {
    stage: input.stage,
    providerId: normalized.providerId,
    providerEndpointId: normalized.providerEndpointId ?? null,
    routeSource: normalized.routeSource ?? null,
    modelOrDeployment: normalized.modelOrDeployment,
    thinkingDepth: normalized.thinkingDepth ?? null,
  };
}

export function missionSelectionFromDebugEvent(
  stage: MissionPlannerLlmSelection['stage'],
  event: SupervisorLlmDebugEvent
): MissionPlannerLlmSelection | null {
  if (event.type !== 'model.request_started') return null;
  const data = event.data || {};
  return {
    stage,
    providerId: typeof data.provider === 'string' ? data.provider : 'unknown',
    providerEndpointId:
      typeof data.providerEndpointId === 'string' ? data.providerEndpointId : null,
    routeSource: typeof data.routeSource === 'string' ? data.routeSource : null,
    modelOrDeployment: typeof data.model === 'string' ? data.model : null,
    thinkingDepth: typeof data.thinkingDepth === 'string' ? data.thinkingDepth : null,
  };
}

export async function callMissionPlannerJson<T>(input: {
  stage: MissionPlannerLlmSelection['stage'];
  systemPrompt: string;
  userPrompt: string;
  schemaName: string;
  schema: z.ZodType<T>;
  onSelection?: (selection: MissionPlannerLlmSelection) => void;
}): Promise<{ parsed: T; rawOutput: unknown; selectedModel: MissionPlannerLlmSelection }> {
  const jsonSchema = z.toJSONSchema(input.schema);
  let selectedModel = fallbackSelectedModelForMissionStage({
    stage: input.stage,
    systemPrompt: input.systemPrompt,
    userPrompt: input.userPrompt,
    schemaName: input.schemaName,
    schema: jsonSchema,
  });
  const raw = await callStructuredJsonLLM(input.systemPrompt, input.userPrompt, {
    role: input.stage === 'evaluation' ? 'evaluation' : 'mission_task_generation',
    schemaName: input.schemaName,
    schema: jsonSchema,
    emitEvent: async (event) => {
      const nextSelection = missionSelectionFromDebugEvent(input.stage, event);
      if (nextSelection) {
        selectedModel = nextSelection;
        input.onSelection?.(nextSelection);
      }
    },
  });
  const rawOutput = JSON.parse(raw) as unknown;
  return {
    parsed: input.schema.parse(rawOutput),
    rawOutput,
    selectedModel,
  };
}

export async function evaluateMissionDecomposition(input: {
  mission: Mission;
  planningResult: MissionDecompositionPlanningResult;
  deterministicChecks: MissionDeterministicCheckReport;
  signal: ProjectSignalSnapshot;
  existingTaskTitles: string[];
}) {
  const systemPrompt = buildMissionEvaluationSystemPrompt();
  const userPrompt = buildMissionEvaluationUserPrompt(input);
  const result = await callMissionPlannerJson<MissionDecompositionEvaluation>({
    stage: 'evaluation',
    systemPrompt,
    userPrompt,
    schemaName: 'mission_decomposition_evaluation',
    schema: missionDecompositionEvaluationSchema,
  });
  return result;
}
