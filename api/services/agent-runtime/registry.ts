import { AppError } from '../../lib/errors';
import type { ResolvedStructuredLlmRoute } from '../structured-llm/role-routing';
import type { StructuredLlmModelTarget } from '../structured-llm/settings';
import type { JobType } from '../supervisor/prompt';
import type { ImplementationTodoInput } from '../todo-runtime';
import { CodexAgentRuntime } from './CodexAgentRuntime';
import { NativeAgentRuntime } from './NativeAgentRuntime';
import type { NativeApiExecutionMode } from './native-api-runner/native-api-mode';
import type { RuntimeLane, RuntimeLaneAlias, RuntimeLaneResolution } from './runtime-lane';
import type { AgentRuntime, AgentRuntimeKind } from './types';

const nativeRuntime = new NativeAgentRuntime();
const codexRuntime = new CodexAgentRuntime();

export function resolveAgentRuntime(kind: AgentRuntimeKind): AgentRuntime {
  if (kind === 'native-local') {
    return nativeRuntime;
  }
  if (kind === 'codex-agent') {
    return codexRuntime;
  }
  throw new AppError(501, 'RUNTIME_KIND_NOT_SUPPORTED', `Unsupported runtime kind: ${kind}`);
}

export type RuntimeLaneSetupInput = {
  compiledPromptText: string;
  executionMode?: NativeApiExecutionMode;
  runtimeLaneResolution?: RuntimeLaneResolution;
  implementationLlmRoute?: ResolvedStructuredLlmRoute | null;
  llmRouteOverride?: StructuredLlmModelTarget | null;
  jobType?: JobType | null;
  planModeSettingsSnapshot?: unknown;
  llmUsageSettingsSnapshot?: unknown;
};

export type RuntimeLaneDefinition = {
  readonly kind: RuntimeLane;
  readonly aliases: readonly RuntimeLaneAlias[];
  buildInitialTodos(input: RuntimeLaneSetupInput): ImplementationTodoInput[];
  buildRuntimeOptions(input: RuntimeLaneSetupInput): Record<string, unknown>;
  createAdapter(): AgentRuntime;
};

const runtimeLaneDefinitions = {
  'native-api-runner': {
    kind: 'native-api-runner',
    aliases: ['native-api-runner', 'native-supervisor', 'native-local'],
    buildInitialTodos: buildNativeSupervisorInitialRunTodos,
    buildRuntimeOptions: buildRuntimeLaneOptions,
    createAdapter: () => nativeRuntime,
  },
  'codex-sdk': {
    kind: 'codex-sdk',
    aliases: ['codex-sdk', 'codex-agent'],
    buildInitialTodos: buildCodexSdkInitialRunTodos,
    buildRuntimeOptions: buildRuntimeLaneOptions,
    createAdapter: () => codexRuntime,
  },
} as const satisfies Record<RuntimeLane, RuntimeLaneDefinition>;

export function resolveRuntimeLaneDefinition(lane: RuntimeLane): RuntimeLaneDefinition {
  return runtimeLaneDefinitions[lane];
}

export function buildRuntimeLaneInitialTodos(
  lane: RuntimeLane,
  input: RuntimeLaneSetupInput
): ImplementationTodoInput[] {
  return resolveRuntimeLaneDefinition(lane).buildInitialTodos(input);
}

export function createRuntimeLaneAdapter(lane: RuntimeLane): AgentRuntime {
  return resolveRuntimeLaneDefinition(lane).createAdapter();
}

export function buildRuntimeLaneOptions(
  input: RuntimeLaneSetupInput & { runtimeLaneResolution?: RuntimeLaneResolution }
): Record<string, unknown> {
  const activeRoute = input.implementationLlmRoute ?? null;
  const nativeApiRoute =
    input.runtimeLaneResolution?.lane === 'native-api-runner' &&
    activeRoute !== null &&
    activeRoute.providerId !== 'codex';
  const activeRole = activeRoute?.role ?? fallbackRoleForExecutionMode(input.executionMode);
  return {
    executionMode: input.executionMode ?? 'implementation',
    jobType: input.jobType ?? null,
    planModeSettingsSnapshot: input.planModeSettingsSnapshot ?? null,
    llmUsage: input.llmUsageSettingsSnapshot ?? null,
    runtimeLane: input.runtimeLaneResolution?.lane ?? null,
    runtimeLaneResolution: input.runtimeLaneResolution ?? null,
    ...(nativeApiRoute
      ? {
          structuredLlmRoutePolicy: {
            disallowedProviderIds: ['codex'],
          },
        }
      : {}),
    llmRouting: {
      activeRole,
      executionMode: input.executionMode ?? 'implementation',
      active: activeRoute ? summarizeResolvedRoute(activeRoute) : null,
      implementation:
        activeRoute?.role === 'implementation' ? summarizeResolvedRoute(activeRoute) : null,
      plan: activeRoute?.role === 'plan' ? summarizeResolvedRoute(activeRoute) : null,
      review: activeRoute?.role === 'review' ? summarizeResolvedRoute(activeRoute) : null,
      override: input.llmRouteOverride ?? null,
    },
    ...(activeRoute?.providerId === 'codex'
      ? {
          codex: {
            providerEndpointId: activeRoute.providerEndpointId,
            model: activeRoute.model,
            thinkingDepth: activeRoute.thinkingDepth || null,
            routeSource: activeRoute.source,
          },
        }
      : {}),
  };
}

function summarizeResolvedRoute(route: ResolvedStructuredLlmRoute) {
  return {
    role: route.role,
    providerEndpointId: route.providerEndpointId,
    providerId: route.providerId,
    model: route.model,
    thinkingDepth: route.thinkingDepth || null,
    source: route.source,
    diagnostics: route.diagnostics,
  };
}

function fallbackRoleForExecutionMode(mode: NativeApiExecutionMode | undefined) {
  if (mode === 'planning' || mode === 'general_answer') return 'plan';
  if (mode === 'review') return 'review';
  return 'implementation';
}

function buildNativeSupervisorInitialRunTodos(
  input: RuntimeLaneSetupInput
): ImplementationTodoInput[] {
  if (input.executionMode === 'planning') return [];
  if (input.executionMode === 'general_answer') return [];
  if (input.executionMode === 'review') return buildReviewInitialRunTodos(input);

  const screenPath = extractFirstMatch(input.compiledPromptText, /画面パス:\s*`([^`]+)`/);
  const featureSummary = extractFeatureSummary(input.compiledPromptText);
  const target = screenPath ? `${screenPath} 画面` : '対象画面';

  return [
    {
      title: '仕様と既存構成を確認する',
      description:
        '最新仕様、リポジトリ構成、既存の package scripts、ルーティング、保存方式を確認し、実装方針を決める。',
      taskType: 'inspection',
    },
    {
      title: `${target}の実装準備を行う`,
      description:
        '既存プロジェクト構成に合わせて、必要なテンプレート、依存関係、ルート、ファイル配置を準備する。',
      taskType: 'scaffold',
      dependsOn: [1],
    },
    {
      title: `${target}を仕様に沿って実装する`,
      description: featureSummary
        ? `${featureSummary} を実装する。`
        : '仕様に沿って主要 UI、状態管理、保存処理、操作導線を実装する。',
      taskType: 'implementation',
      dependsOn: [2],
    },
    {
      title: '受け入れ条件を検証する',
      description:
        'ビルド、テスト、必要なブラウザ確認を実行し、仕様の受け入れ条件を満たすことを確認する。',
      taskType: 'verification',
      dependsOn: [3],
    },
  ];
}

function buildCodexSdkInitialRunTodos(input: RuntimeLaneSetupInput): ImplementationTodoInput[] {
  if (input.executionMode === 'planning') return [];
  if (input.executionMode === 'general_answer') return [];
  if (input.executionMode === 'review') return buildReviewInitialRunTodos(input);

  const summary = input.compiledPromptText.replace(/\s+/g, ' ').trim().slice(0, 160);
  const requestSummary = summary ? `ユーザー依頼: ${summary}` : 'ユーザー依頼に基づく対象変更。';

  return [
    {
      title: '対象変更を確認して実装する',
      description: [
        requestSummary,
        'ユーザーが実装計画化を明示していない場合は、必要最小限の確認後に対象変更を実装する。',
      ].join('\n'),
      taskType: 'implementation',
    },
    {
      title: '必要最小限の動作確認を行う',
      description:
        '変更範囲に応じた focused check を行う。広域 verify は追加される品質ゲート Todo で扱う。',
      taskType: 'focused_verification',
      dependsOn: [1],
    },
  ];
}

function buildReviewInitialRunTodos(input: RuntimeLaneSetupInput): ImplementationTodoInput[] {
  const summary = input.compiledPromptText.replace(/\s+/g, ' ').trim().slice(0, 160);
  const requestSummary = summary ? `レビュー依頼: ${summary}` : 'ユーザーのレビュー依頼。';

  return [
    {
      title: 'レビュー対象と差分を確認する',
      description: [
        requestSummary,
        'git status / git diff / 関連ファイル / 既存仕様を確認し、レビュー対象を特定する。',
      ].join('\n'),
      taskType: 'inspection',
    },
    {
      title: 'レビュー結果を根拠付きで整理する',
      description:
        'バグ、回帰、責務境界違反、テスト不足を優先し、必要な場合は明確な修正まで進める。',
      taskType: 'focused_verification',
      dependsOn: [1],
    },
  ];
}

function extractFeatureSummary(text: string) {
  const requirementsBlock = text.match(/## 機能要件\s*([\s\S]*?)(?:\n## |$)/)?.[1] ?? '';
  const requirements = requirementsBlock
    .split('\n')
    .map((line) => line.replace(/^\s*\d+\.\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 6);
  return requirements.length > 0 ? requirements.join('、') : null;
}

function extractFirstMatch(text: string, pattern: RegExp) {
  return text.match(pattern)?.[1]?.trim() || null;
}
