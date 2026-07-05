import { toDeepRecord } from '../../../../shared/json-record';
import type { NightWorkersWorkspaceState } from '../hooks/useNightWorkersWorkspace';
import type { WorkbenchRouteState } from '../routing/workbench-route-state';
import type {
  LlmModelTarget,
  LlmRoleRoute,
  ProjectSafetyPolicy,
  Task,
  TaskMessage,
  ThinkingDepthOption,
} from '../types';
import { THINKING_DEPTH_OPTIONS } from '../types';

export function asProjectSafetyPolicy(value: unknown): ProjectSafetyPolicy {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as ProjectSafetyPolicy;
}

type ComposerModelTarget = {
  providerEndpointId: string;
  model: string;
};

export const modelTargetKey = (target: ComposerModelTarget) => JSON.stringify(target);
export const COMPOSER_THINKING_DEPTH_OPTIONS: ThinkingDepthOption[] = [
  { value: '', label: 'Auto' },
  ...THINKING_DEPTH_OPTIONS,
];

export function parseModelTargetKey(value: string): ComposerModelTarget | null {
  try {
    const parsed = JSON.parse(value) as Partial<ComposerModelTarget>;
    if (typeof parsed.providerEndpointId === 'string' && typeof parsed.model === 'string') {
      return { providerEndpointId: parsed.providerEndpointId, model: parsed.model };
    }
  } catch {
    // Legacy model values fall through.
  }
  return null;
}

export function isMissionProposalApprovalRequiredError(error: unknown) {
  if (!(error instanceof Error)) return false;
  try {
    const parsed = JSON.parse(error.message) as { code?: unknown };
    return parsed.code === 'MISSION_PROPOSAL_APPROVAL_REQUIRED';
  } catch {
    return error.message.includes('MISSION_PROPOSAL_APPROVAL_REQUIRED');
  }
}

export function isThinkingModel(modelName: string) {
  const normalized = modelName.toLowerCase();
  return (
    /^gpt-5(\b|[.-])/.test(normalized) ||
    /^o[134](\b|[.-])/.test(normalized) ||
    normalized.includes('codex') ||
    normalized.includes('reasoning') ||
    normalized.includes('thinking') ||
    normalized.includes('deepseek-r1') ||
    normalized.includes('qwen3')
  );
}

export function resolveComposerRouteTarget(
  routes: LlmRoleRoute[] | undefined,
  availableModelKeys: Set<string>
): LlmModelTarget | null {
  const roles = ['plan', 'implementation'] as const;
  for (const role of roles) {
    const route = routes?.find((item) => item.role === role);
    if (!route) continue;
    for (const target of [route.primary, ...route.fallbacks]) {
      const key = modelTargetKey(target);
      if (availableModelKeys.has(key)) return target;
    }
  }
  return null;
}

export function findComposerRouteTargetByKey(
  routes: LlmRoleRoute[] | undefined,
  targetKey: string
): LlmModelTarget | null {
  const roles = ['plan', 'implementation'] as const;
  for (const role of roles) {
    const route = routes?.find((item) => item.role === role);
    if (!route) continue;
    const target = [route.primary, ...route.fallbacks].find(
      (item) => modelTargetKey(item) === targetKey
    );
    if (target) return target;
  }
  return null;
}

export function isImplementationLockedStatus(status: string | undefined) {
  return status === 'completed';
}

export function isDesignQuestionnaireReadyMessage(message: TaskMessage) {
  return String(toDeepRecord(message.metadataJson).intent) === 'design_questionnaire_ready';
}

export function designQuestionnaireMessageIds(messages: TaskMessage[]) {
  return new Set(messages.filter(isDesignQuestionnaireReadyMessage).map((message) => message.id));
}

export function projectEvaluationDraftStorageKey(taskId: string) {
  return `nightworkers:composer:${taskId}`;
}

export function projectEvaluationTaskPromptDrafts(tasks: Task[]) {
  return tasks
    .map((task) => ({ taskId: task.id, prompt: task.objective?.trim() || '' }))
    .filter((draft) => draft.prompt.length > 0);
}

export function collectProjectSessionViews(
  groupedSessionViews: NightWorkersWorkspaceState['groupedSessionViews'],
  projectId: string
) {
  return [
    ...(groupedSessionViews[projectId]?.processing || []),
    ...(groupedSessionViews[projectId]?.queue || []),
    ...(groupedSessionViews[projectId]?.archive || []),
  ];
}

export function isMissingProjectRoute(
  routeState: WorkbenchRouteState,
  workspace: NightWorkersWorkspaceState,
  projectQueueProject: unknown,
  projectDetailProject: unknown
) {
  return (
    !workspace.isProjectsLoading &&
    (routeState.kind === 'project_queue' || routeState.kind === 'project_detail') &&
    !projectQueueProject &&
    !projectDetailProject
  );
}

export function isMissingSessionRoute(
  routeState: WorkbenchRouteState,
  workspace: NightWorkersWorkspaceState
) {
  return (
    !workspace.isSessionsLoading &&
    routeState.kind === 'session' &&
    !workspace.sessions.some((session) => session.id === routeState.sessionId)
  );
}

export function resolveCurrentProviderModel(workspace: NightWorkersWorkspaceState) {
  if (workspace.activeProvider === 'openai') return workspace.llmSettings?.OPENAI_MODEL;
  if (workspace.activeProvider === 'azure')
    return workspace.llmSettings?.AZURE_OPENAI_DEPLOYMENT_NAME;
  if (workspace.activeProvider === 'bedrock') return workspace.llmSettings?.AWS_BEDROCK_MODEL;
  if (workspace.activeProvider === 'codex') return workspace.llmSettings?.CODEX_MODEL;
  return null;
}
