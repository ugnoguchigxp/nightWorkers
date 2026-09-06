import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimeLaneResolution } from "../api/modules/codingAgent";
import {
	buildCompiledPromptText,
	buildEffectiveLlmRoutingSnapshot,
	buildLatestRuntimeUserMessage,
	findLatestImplementationDesignArtifacts,
	findLatestImplementationHandoffMessage,
	IMPLEMENTATION_PHASE_PREAMBLE,
	loadCodexRuntimeResumeState,
	maybeLoadConversationStateCard,
	resolveLatestJobTypeFromMessages,
	resolveRuntimeLaneForRoleRoute,
	safelyRefreshConversationContext,
} from "../api/modules/nightworkers/run-orchestration/runtime-routing";
import type { ResolvedStructuredLlmRoute } from "../api/services/structured-llm/role-routing";
import type {
	StructuredLlmProviderEndpoint,
	StructuredLlmProviderSettings,
	StructuredLlmRole,
} from "../api/services/structured-llm/settings";

const mocks = vi.hoisted(() => ({
	warn: vi.fn(),
	refreshConversationContext: vi.fn(async () => undefined),
	getConversationContext: vi.fn(async () => null),
	buildOnIdleEnabled: vi.fn(() => false),
	stateCardEnabled: vi.fn(() => false),
	getRuntimeState: vi.fn(async () => null),
}));

vi.mock("../api/lib/logger", () => ({ logger: { warn: mocks.warn } }));
vi.mock("../api/services/conversation-context", () => ({
	refreshConversationContextSnapshot: mocks.refreshConversationContext,
	getLatestConversationContextForTask: mocks.getConversationContext,
}));
vi.mock("../api/services/conversation-context/flags", () => ({
	isConversationContextBuildOnIdleEnabled: mocks.buildOnIdleEnabled,
	isConversationContextStateCardEnabled: mocks.stateCardEnabled,
}));
vi.mock("../api/services/runtime-session-state", () => ({
	RuntimeSessionStateStore: class {
		getLatestRuntimeSessionStateForTask = mocks.getRuntimeState;
	},
}));

const nativeFallback: RuntimeLaneResolution = {
	lane: "native-api-runner",
	workerKind: "native-local",
	source: "settings",
	diagnostics: [{ level: "info", message: "fallback selected" }],
};

const codexFallback: RuntimeLaneResolution = {
	lane: "codex-sdk",
	workerKind: "codex-agent",
	source: "env",
	diagnostics: [{ level: "info", message: "codex requested" }],
};

beforeEach(() => {
	vi.clearAllMocks();
	mocks.buildOnIdleEnabled.mockReturnValue(false);
	mocks.stateCardEnabled.mockReturnValue(false);
	mocks.refreshConversationContext.mockResolvedValue(undefined);
	mocks.getConversationContext.mockResolvedValue(null);
	mocks.getRuntimeState.mockResolvedValue(null);
});

describe("runtime lane and effective provider routing", () => {
	it("keeps the fallback lane when no role route is available", () => {
		expect(resolveRuntimeLaneForRoleRoute(nativeFallback, null)).toBe(
			nativeFallback,
		);
	});

	it("selects Codex SDK for an implementation Codex route", () => {
		const output = resolveRuntimeLaneForRoleRoute(
			nativeFallback,
			route({ providerId: "codex", role: "implementation" }),
		);
		expect(output).toMatchObject({
			lane: "codex-sdk",
			workerKind: "codex-agent",
			source: "role_route",
		});
		expect(output.diagnostics).toEqual([
			...nativeFallback.diagnostics,
			expect.objectContaining({
				level: "info",
				message: expect.stringContaining(
					"Implementation role route selected codex-sdk",
				),
			}),
			expect.objectContaining({
				level: "warning",
				message: expect.stringContaining("points at a Codex provider endpoint"),
			}),
		]);
	});

	it("forces a configured API implementation route onto the native lane", () => {
		const output = resolveRuntimeLaneForRoleRoute(
			codexFallback,
			route({ providerId: "openai", role: "implementation" }),
		);
		expect(output).toMatchObject({
			lane: "native-api-runner",
			workerKind: "native-local",
		});
		expect(output.diagnostics.at(-1)).toMatchObject({
			level: "warning",
			message: expect.stringContaining("requested codex-sdk"),
		});
	});

	it("labels non-implementation API routes without implementation warnings", () => {
		const output = resolveRuntimeLaneForRoleRoute(
			nativeFallback,
			route({ providerId: "azure-openai", role: "review" }),
		);
		expect(output.lane).toBe("native-api-runner");
		expect(output.diagnostics.at(-1)?.message).toContain(
			"review role route selected native-api-runner",
		);
		expect(output.diagnostics).toHaveLength(2);
	});

	it("summarizes primary, fallback, override, settings, and active implementation", () => {
		const settings = routingSettings();
		const override = {
			providerEndpointId: "azure-endpoint",
			model: "azure-model",
			thinkingDepth: "high" as const,
		};
		const activeRoute = route({
			providerId: "azure-openai",
			providerEndpointId: "azure-endpoint",
			model: "azure-model",
			role: "implementation",
			source: "override",
			thinkingDepth: "high",
			endpoint: endpoint("azure-endpoint", "azure", ["azure-model"]),
		});

		const snapshot = buildEffectiveLlmRoutingSnapshot({
			activeRole: "implementation",
			executionMode: "implementation",
			settings,
			activeRoute,
			override,
		});

		expect(snapshot).toMatchObject({
			activeRole: "implementation",
			executionMode: "implementation",
			settingsRevision: "revision-7",
			endpointIdSchemaVersion: 3,
			routePolicyDigest: "native-api:no-codex:explicit-only",
			active: {
				providerId: "azure-openai",
				providerAdapter: "azure",
				thinkingDepth: "high",
				source: "override",
				routeKey: "azure-endpoint::azure-model::azure-openai",
			},
			implementation: { role: "implementation" },
			plan: null,
			review: null,
			override,
		});
		expect(snapshot.roles.plan).toMatchObject({
			primary: { source: "primary", providerId: "openai" },
			fallbacks: [{ source: "fallback", providerId: "codex" }],
			override: null,
		});
		expect(snapshot.roles.implementation).toMatchObject({
			primary: null,
			fallbacks: [],
			override: {
				source: "override",
				providerAdapter: "azure",
			},
		});
		expect(snapshot.roles.mission_task_generation.candidates).toEqual([]);
	});

	it.each([
		["plan", "plan"],
		["review", "review"],
		["evaluation", null],
	] as const)("places an active %s route in its role slot", (role, expectedSlot) => {
		const activeRoute = route({ role });
		const snapshot = buildEffectiveLlmRoutingSnapshot({
			activeRole: role,
			executionMode: "planning",
			settings: {},
			activeRoute,
			override: null,
		});
		expect(snapshot.settingsRevision).toBeNull();
		expect(snapshot.endpointIdSchemaVersion).toBeNull();
		expect(snapshot.implementation).toBeNull();
		expect(snapshot.plan).toEqual(
			expectedSlot === "plan" ? snapshot.active : null,
		);
		expect(snapshot.review).toEqual(
			expectedSlot === "review" ? snapshot.active : null,
		);
	});

	it("represents an absent active route as null", () => {
		const snapshot = buildEffectiveLlmRoutingSnapshot({
			activeRole: "test",
			executionMode: "test",
			settings: {},
			activeRoute: null,
			override: null,
		});
		expect(snapshot.active).toBeNull();
		expect(snapshot.implementation).toBeNull();
		expect(snapshot.plan).toBeNull();
		expect(snapshot.review).toBeNull();
	});
});

describe("conversation and review side effects", () => {
	it("skips idle context refresh when disabled", async () => {
		await safelyRefreshConversationContext({
			taskId: "task-1",
			runId: "run-1",
		});
		expect(mocks.refreshConversationContext).not.toHaveBeenCalled();
	});

	it("refreshes context when enabled", async () => {
		mocks.buildOnIdleEnabled.mockReturnValue(true);
		const input = { taskId: "task-1", runId: "run-1" };
		await safelyRefreshConversationContext(input);
		expect(mocks.refreshConversationContext).toHaveBeenCalledWith(input);
		expect(mocks.warn).not.toHaveBeenCalled();
	});

	it("logs and contains context refresh errors", async () => {
		mocks.buildOnIdleEnabled.mockReturnValue(true);
		mocks.refreshConversationContext.mockRejectedValueOnce("refresh offline");
		await expect(
			safelyRefreshConversationContext({ taskId: "task-1", runId: "run-1" }),
		).resolves.toBeUndefined();
		expect(mocks.warn).toHaveBeenCalledWith(
			{ error: "refresh offline", taskId: "task-1", runId: "run-1" },
			"conversation context refresh failed",
		);
	});

	it("skips state-card loading when disabled", async () => {
		await expect(maybeLoadConversationStateCard("task-1")).resolves.toBeNull();
		expect(mocks.getConversationContext).not.toHaveBeenCalled();
	});

	it("returns a fresh state card and suppresses the already-consumed card", async () => {
		mocks.stateCardEnabled.mockReturnValue(true);
		const snapshot = { id: "snapshot-1", latestUserMessageId: "message-2" };
		mocks.getConversationContext.mockResolvedValue(snapshot);
		await expect(
			maybeLoadConversationStateCard("task-1", "message-1"),
		).resolves.toBe(snapshot);
		await expect(
			maybeLoadConversationStateCard("task-1", "message-2"),
		).resolves.toBeNull();
	});

	it.each([
		null,
		{ id: "snapshot-without-message", latestUserMessageId: null },
	])("returns the optional snapshot value when it has no message id", async (snapshot) => {
		mocks.stateCardEnabled.mockReturnValue(true);
		mocks.getConversationContext.mockResolvedValueOnce(snapshot);
		await expect(maybeLoadConversationStateCard("task-1", null)).resolves.toBe(
			snapshot,
		);
	});

	it("logs state-card load errors and falls back to null", async () => {
		mocks.stateCardEnabled.mockReturnValue(true);
		mocks.getConversationContext.mockRejectedValueOnce(
			new Error("snapshot failed"),
		);
		await expect(maybeLoadConversationStateCard("task-1")).resolves.toBeNull();
		expect(mocks.warn).toHaveBeenCalledWith(
			{ error: "snapshot failed", taskId: "task-1" },
			"conversation context load failed",
		);
	});
});

describe("message provenance and implementation artifacts", () => {
	it("resolves the newest valid intake or legacy job selection", () => {
		const messages = [
			message("legacy", { jobSelection: { jobType: "review" } }),
			message("invalid", { intakeJobSelection: { jobType: "not-a-job" } }),
			message("latest", { intakeJobSelection: { jobType: "test" } }),
		];
		expect(resolveLatestJobTypeFromMessages(messages as never)).toBe("test");
		messages.pop();
		expect(resolveLatestJobTypeFromMessages(messages as never)).toBe("review");
	});

	it("returns null for malformed and non-string job selections", () => {
		const messages = [
			message("array", []),
			message("null", null),
			message("invalid-selection", { intakeJobSelection: [] }),
			message("number", { jobSelection: { jobType: 3 } }),
			message("invalid", { jobSelection: { jobType: "unknown" } }),
		];
		expect(resolveLatestJobTypeFromMessages(messages as never)).toBeNull();
		expect(resolveLatestJobTypeFromMessages([] as never)).toBeNull();
	});

	it("finds the newest markdown implementation or feature plan handoff", () => {
		const oldPlan = message("old-plan", { intent: "implementation_plan" });
		const missingMetadata = message("missing-metadata", null);
		const missingIntent = message("missing-intent", {});
		const ignoredType = {
			...message("ignored-type", { intent: "feature_plan" }),
			messageType: "user",
		};
		const latestPlan = message("latest-plan", { intent: "FEATURE_PLAN" });
		const ignoredIntent = message("ignored-intent", { intent: "blueprint" });
		expect(
			findLatestImplementationHandoffMessage([
				oldPlan,
				missingMetadata,
				missingIntent,
				ignoredType,
				latestPlan,
				ignoredIntent,
			] as never),
		).toBe(latestPlan);
		expect(
			findLatestImplementationHandoffMessage([
				ignoredType,
				ignoredIntent,
				missingMetadata,
				missingIntent,
			] as never),
		).toBeUndefined();
	});

	it("selects only referenced design artifacts and keeps the latest per kind", () => {
		const oldData = designMessage("old-data", { intent: "data_model" });
		const newData = designMessage("new-data", {
			artifactKind: "plan_mode_dedicated_view",
			view: "data_model",
		});
		const api = designMessage("api", { intent: "api_io_contract" });
		const appBlueprint = designMessage("app-blueprint", {
			intent: "app_blueprint",
		});
		const mockBlueprint = designMessage("mock-blueprint", {
			intent: "mock_blueprint",
		});
		const ignoredIntent = designMessage("ignored", { intent: "random" });
		const ignoredType = { ...api, id: "ignored-type", messageType: "user" };
		const unreferenced = designMessage("unreferenced", { intent: "user_flow" });
		const handoff = message("handoff", {
			generation: {
				context: {
					inputProjection: {
						sourceMessageIds: [
							oldData.id,
							newData.id,
							api.id,
							appBlueprint.id,
							mockBlueprint.id,
							ignoredIntent.id,
							ignoredType.id,
							"",
							7,
						],
					},
				},
			},
		});
		const artifacts = findLatestImplementationDesignArtifacts(
			[
				oldData,
				newData,
				api,
				appBlueprint,
				mockBlueprint,
				ignoredIntent,
				ignoredType,
				unreferenced,
			] as never,
			handoff as never,
		);
		expect(artifacts.map(({ kind, message: item }) => [kind, item.id])).toEqual(
			[
				["blueprint", "mock-blueprint"],
				["data_model", "new-data"],
				["api_io_contract", "api"],
			],
		);
	});

	it("accepts all design sources when handoff provenance is absent or malformed", () => {
		const messages = [
			designMessage("blueprint", { intent: "blueprint" }),
			designMessage("sequence", {
				artifactKind: "plan_mode_dedicated_view",
				view: "sequence_flow",
			}),
			designMessage("bad-view", {
				artifactKind: "plan_mode_dedicated_view",
				view: "unknown",
			}),
			designMessage("missing-view", {
				artifactKind: "plan_mode_dedicated_view",
			}),
		];
		const malformedHandoff = message("handoff", {
			generation: { context: { inputProjection: { sourceMessageIds: "all" } } },
		});
		expect(
			findLatestImplementationDesignArtifacts(
				messages as never,
				malformedHandoff as never,
			).map(({ kind }) => kind),
		).toEqual(["blueprint", "sequence_flow"]);
		expect(findLatestImplementationDesignArtifacts([] as never)).toEqual([]);
	});
});

describe("compiled runtime prompts", () => {
	it.each([
		[
			"last message",
			"latest request",
			"description",
			"objective",
			"latest request",
		],
		[
			"description",
			undefined,
			"task description",
			"objective",
			"task description",
		],
		["objective", undefined, "", "task objective", "task objective"],
		["empty", undefined, "", "", ""],
	] as const)("uses the %s as the request fallback", (_name, lastContent, description, objective, expected) => {
		expect(
			buildCompiledPromptText({
				task: { description, objective } as never,
				lastUserMessage:
					lastContent === undefined
						? undefined
						: (message("user", null, lastContent) as never),
			}),
		).toBe(expected);
	});

	it("combines a trimmed user request and implementation handoff", () => {
		expect(
			buildCompiledPromptText({
				task: { description: "fallback" } as never,
				lastUserMessage: message("user", null, "  user request  ") as never,
				implementationHandoffMessage: message(
					"handoff",
					null,
					"  adopted plan  ",
				) as never,
			}),
		).toBe(
			"<USER_REQUEST>\nuser request\n</USER_REQUEST>\n\n<IMPLEMENTATION_HANDOFF>\nadopted plan\n</IMPLEMENTATION_HANDOFF>",
		);
	});

	it("returns only a handoff when the request is blank", () => {
		expect(
			buildCompiledPromptText({
				task: { description: "" } as never,
				implementationHandoffMessage: message(
					"handoff",
					null,
					" plan ",
				) as never,
			}),
		).toBe("plan");
		expect(
			buildCompiledPromptText({
				task: { description: "request" } as never,
				implementationHandoffMessage: message("handoff", null, "   ") as never,
			}),
		).toBe("request");
	});

	it("injects the implementation preamble into a direct request", () => {
		const output = buildLatestRuntimeUserMessage({
			fallback: " fallback request ",
		});
		expect(output).toBe(`${IMPLEMENTATION_PHASE_PREAMBLE}\n\nfallback request`);
	});

	it("includes distinct request and handoff sections", () => {
		const output = buildLatestRuntimeUserMessage({
			fallback: "fallback",
			lastUserMessage: message("user", null, " user request ") as never,
			implementationHandoffMessage: message(
				"handoff",
				null,
				" adopted plan ",
			) as never,
		});
		expect(output).toContain("<USER_REQUEST>\nuser request\n</USER_REQUEST>");
		expect(output).toContain("<IMPLEMENTATION_HANDOFF>");
		expect(output).toContain("adopted plan");
	});

	it("does not duplicate a fallback that equals the handoff", () => {
		const output = buildLatestRuntimeUserMessage({
			fallback: "same plan",
			implementationHandoffMessage: message(
				"handoff",
				null,
				"same plan",
			) as never,
		});
		expect(output).not.toContain("<USER_REQUEST>");
		expect(output.match(/same plan/g)).toHaveLength(1);
	});

	it("keeps a distinct fallback request when a handoff exists", () => {
		const output = buildLatestRuntimeUserMessage({
			fallback: "request",
			implementationHandoffMessage: message("handoff", null, "plan") as never,
		});
		expect(output).toContain("<USER_REQUEST>\nrequest\n</USER_REQUEST>");
	});
});

describe("Codex runtime resume state", () => {
	it("returns a reasoned unavailable result without an agent-mode session", async () => {
		await expect(
			loadCodexRuntimeResumeState({
				taskId: "task-1",
				repositoryId: "repo-1",
				executionMode: "implementation",
				agentModeSessionId: null,
			}),
		).resolves.toEqual({
			kind: "codex_thread",
			status: "unavailable",
			executionMode: "implementation",
			reason: "agent_mode_session_unavailable",
		});
		expect(mocks.getRuntimeState).not.toHaveBeenCalled();
	});

	it.each([
		null,
		{ providerSessionId: null },
	])("returns unavailable when no resumable provider thread exists", async (state) => {
		mocks.getRuntimeState.mockResolvedValueOnce(state);
		await expect(
			loadCodexRuntimeResumeState({
				taskId: "task-1",
				repositoryId: "repo-1",
				executionMode: "review",
				agentModeSessionId: "session-1",
			}),
		).resolves.toEqual({
			kind: "codex_thread",
			status: "unavailable",
			executionMode: "review",
		});
		expect(mocks.getRuntimeState).toHaveBeenCalledWith({
			taskId: "task-1",
			agentModeSessionId: "session-1",
			repositoryId: "repo-1",
			runtimeLane: "codex-sdk",
			provider: "codex",
			executionMode: "review",
		});
	});

	it("returns all available Codex thread provenance", async () => {
		mocks.getRuntimeState.mockResolvedValueOnce({
			id: "state-1",
			runId: "source-run",
			providerSessionId: "thread-1",
			model: "gpt-codex",
		});
		await expect(
			loadCodexRuntimeResumeState({
				taskId: "task-1",
				repositoryId: "repo-1",
				executionMode: "implementation",
				agentModeSessionId: "session-1",
			}),
		).resolves.toEqual({
			kind: "codex_thread",
			status: "available",
			stateId: "state-1",
			sourceRunId: "source-run",
			providerThreadId: "thread-1",
			executionMode: "implementation",
			model: "gpt-codex",
		});
	});

	it("propagates runtime-state storage errors", async () => {
		mocks.getRuntimeState.mockRejectedValueOnce(
			new Error("state store unavailable"),
		);
		await expect(
			loadCodexRuntimeResumeState({
				taskId: "task-1",
				repositoryId: "repo-1",
				executionMode: "implementation",
				agentModeSessionId: "session-1",
			}),
		).rejects.toThrow("state store unavailable");
	});
});

function endpoint(
	id: string,
	kind: StructuredLlmProviderEndpoint["kind"],
	models: string[],
): StructuredLlmProviderEndpoint {
	return { id, name: `${id} name`, kind, enabled: true, models };
}

function route(
	overrides: Partial<ResolvedStructuredLlmRoute> = {},
): ResolvedStructuredLlmRoute {
	const providerId = overrides.providerId ?? "openai";
	const providerEndpointId = overrides.providerEndpointId ?? "openai-endpoint";
	return {
		role: "implementation",
		providerEndpointId,
		providerId,
		endpoint:
			overrides.endpoint ??
			endpoint(providerEndpointId, "openai", ["gpt-test"]),
		model: "gpt-test",
		thinkingDepth: null,
		source: "primary",
		diagnostics: ["configured route"],
		...overrides,
	};
}

function routingSettings(): StructuredLlmProviderSettings {
	const openai = endpoint("openai-endpoint", "openai", ["gpt-test"]);
	const codex = endpoint("codex-endpoint", "codex", ["codex-model"]);
	const azure = endpoint("azure-endpoint", "azure", ["azure-model"]);
	const configuredRoles: StructuredLlmRole[] = [
		"plan",
		"evaluation",
		"implementation",
		"test",
		"review",
		"mission_pilot",
	];
	return {
		settingsRevision: "revision-7",
		endpointIdSchemaVersion: 3,
		providerEndpoints: [openai, codex, azure],
		roleRoutes: configuredRoles.map((role) => ({
			role,
			primary: { providerEndpointId: openai.id, model: "gpt-test" },
			fallbacks: [
				{
					providerEndpointId: codex.id,
					model: "codex-model",
					thinkingDepth: "",
				},
			],
		})),
	};
}

function message(id: string, metadataJson: unknown, content = id) {
	return { id, messageType: "markdown_document", metadataJson, content };
}

function designMessage(id: string, metadataJson: unknown) {
	return message(id, metadataJson, `${id} content`);
}
