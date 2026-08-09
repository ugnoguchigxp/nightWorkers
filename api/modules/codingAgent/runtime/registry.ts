import { AppError } from "../../../lib/errors";
import type { ResolvedStructuredLlmRoute } from "../../../services/structured-llm/role-routing";
import type {
	StructuredLlmModelTarget,
	StructuredLlmRole,
} from "../../../services/structured-llm/settings";
import type { JobType } from "../../../services/supervisor/prompt";
import { CodexAgentRuntime } from "./CodexAgentRuntime";
import { NativeAgentRuntime } from "./NativeAgentRuntime";
import type {
	RuntimeLane,
	RuntimeLaneAlias,
	RuntimeLaneResolution,
} from "./runtime-lane";
import type { AgentRuntime, AgentRuntimeKind } from "./types";

let nativeRuntime: NativeAgentRuntime | null = null;
let codexRuntime: CodexAgentRuntime | null = null;

function getNativeRuntime() {
	nativeRuntime ??= new NativeAgentRuntime();
	return nativeRuntime;
}

function getCodexRuntime() {
	codexRuntime ??= new CodexAgentRuntime();
	return codexRuntime;
}

export function resolveAgentRuntime(kind: AgentRuntimeKind): AgentRuntime {
	if (kind === "native-local") return getNativeRuntime();
	if (kind === "codex-agent") return getCodexRuntime();
	throw new AppError(
		501,
		"RUNTIME_KIND_NOT_SUPPORTED",
		`Unsupported runtime kind: ${kind}`,
	);
}

export type RuntimeLaneSetupInput = {
	compiledPromptText: string;
	runtimeLaneResolution?: RuntimeLaneResolution;
	activeRole?: StructuredLlmRole;
	activeLlmRoute?: ResolvedStructuredLlmRoute | null;
	llmRouteOverride?: StructuredLlmModelTarget | null;
	jobType?: JobType | null;
	planModeSettingsSnapshot?: unknown;
	llmUsageSettingsSnapshot?: unknown;
};

export type RuntimeLaneDefinition = {
	readonly kind: RuntimeLane;
	readonly aliases: readonly RuntimeLaneAlias[];
	buildRuntimeOptions(input: RuntimeLaneSetupInput): Record<string, unknown>;
	createAdapter(): AgentRuntime;
};

const runtimeLaneDefinitions = {
	"native-api-runner": {
		kind: "native-api-runner",
		aliases: ["native-api-runner", "native-supervisor", "native-local"],
		buildRuntimeOptions: buildRuntimeLaneOptions,
		createAdapter: getNativeRuntime,
	},
	"codex-sdk": {
		kind: "codex-sdk",
		aliases: ["codex-sdk", "codex-agent"],
		buildRuntimeOptions: buildRuntimeLaneOptions,
		createAdapter: getCodexRuntime,
	},
} as const satisfies Record<RuntimeLane, RuntimeLaneDefinition>;

export function resolveRuntimeLaneDefinition(
	lane: RuntimeLane,
): RuntimeLaneDefinition {
	return runtimeLaneDefinitions[lane];
}

export function createRuntimeLaneAdapter(lane: RuntimeLane): AgentRuntime {
	return resolveRuntimeLaneDefinition(lane).createAdapter();
}

export function buildRuntimeLaneOptions(
	input: RuntimeLaneSetupInput,
): Record<string, unknown> {
	const activeRoute = input.activeLlmRoute ?? null;
	const nativeApiRoute =
		input.runtimeLaneResolution?.lane === "native-api-runner" &&
		activeRoute !== null &&
		activeRoute.providerId !== "codex";
	return {
		jobType: input.jobType ?? null,
		llmUsage: input.llmUsageSettingsSnapshot ?? null,
		runtimeLane: input.runtimeLaneResolution?.lane ?? null,
		runtimeLaneResolution: input.runtimeLaneResolution ?? null,
		...(nativeApiRoute
			? { structuredLlmRoutePolicy: { disallowedProviderIds: ["codex"] } }
			: {}),
		llmRouting: {
			activeRole: input.activeRole ?? activeRoute?.role ?? "implementation",
			active: activeRoute ? summarizeResolvedRoute(activeRoute) : null,
			override: input.llmRouteOverride ?? null,
		},
		...(activeRoute?.providerId === "codex"
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
