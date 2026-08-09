import { beforeEach, describe, expect, it, vi } from "vitest";

type Effect = () => undefined | (() => void);

let stateSlots: unknown[] = [];
let refSlots: Array<{ current: unknown }> = [];
let setters: Array<ReturnType<typeof vi.fn>> = [];
let effects: Effect[] = [];
let stateCursor = 0;
let refCursor = 0;

async function createHarness() {
	stateSlots = [];
	refSlots = [];
	setters = [];
	effects = [];
	vi.resetModules();
	vi.doMock("react", async () => {
		const actual = await vi.importActual<typeof import("react")>("react");
		return {
			...actual,
			useCallback: <T extends (...args: never[]) => unknown>(callback: T) =>
				callback,
			useMemo: <T>(factory: () => T) => factory(),
			useEffect: (callback: Effect) => effects.push(callback),
			useRef: <T>(initial: T) => {
				const index = refCursor++;
				refSlots[index] ??= { current: initial };
				return refSlots[index] as { current: T };
			},
			useState: <T>(initial: T) => {
				const index = stateCursor++;
				if (stateSlots.length <= index) stateSlots[index] = initial;
				const setter = vi.fn((next: T | ((current: T) => T)) => {
					stateSlots[index] =
						typeof next === "function"
							? (next as (current: T) => T)(stateSlots[index] as T)
							: next;
				});
				setters[index] = setter;
				return [stateSlots[index] as T, setter] as const;
			},
		};
	});

	const { useNightWorkersComposer } = await import(
		"../src/modules/nightworkers/components/useNightWorkersComposer"
	);
	return {
		useComposer(workspace: ReturnType<typeof workspace>) {
			stateCursor = 0;
			refCursor = 0;
			effects = [];
			return useNightWorkersComposer(workspace as never);
		},
		runEffects() {
			for (const effect of effects) effect();
		},
	};
}

function endpoint(
	id: string,
	kind: "openai" | "azure" | "bedrock" | "codex",
	models: string[],
	overrides: Record<string, unknown> = {},
) {
	return {
		id,
		name: `${id} endpoint`,
		kind,
		enabled: true,
		models,
		modelDisplayNames: {},
		...overrides,
	};
}

function target(
	providerEndpointId: string,
	model: string,
	thinkingDepth?: "low" | "medium" | "high" | "very_high",
) {
	return {
		providerEndpointId,
		model,
		...(thinkingDepth ? { thinkingDepth } : {}),
	};
}

function targetKey(providerEndpointId: string, model: string) {
	return JSON.stringify({ providerEndpointId, model });
}

function workspace(overrides: Record<string, unknown> = {}) {
	return {
		activeSessionId: null,
		activeProvider: "openai",
		latestRun: undefined,
		latestRunEvents: [],
		providerModelOptions: [],
		llmSettings: {
			OPENAI_MODEL: "gpt-4.1",
			AZURE_OPENAI_DEPLOYMENT_NAME: "azure-default",
			AWS_BEDROCK_MODEL: "bedrock-default",
			CODEX_MODEL: "gpt-5.2-codex",
			CODEX_ENABLED: false,
			providerEndpoints: [],
			roleRoutes: [],
		},
		...overrides,
	};
}

describe("useNightWorkersComposer extra coverage", () => {
	beforeEach(() => vi.restoreAllMocks());

	it("initializes from the current provider when no endpoint options exist", async () => {
		const harness = await createHarness();
		const current = workspace();
		let composer = harness.useComposer(current);

		expect(composer.model).toBe("");
		expect(composer.composerModelOptions).toEqual([]);
		expect(composer.buildComposerLlmSelection()).toBeUndefined();
		harness.runEffects();

		composer = harness.useComposer(current);
		expect(composer.model).toBe("gpt-4.1");
		expect(composer.composerThinkingDepthOptions).toEqual([]);

		composer.handleComposerModelChange("gpt-5.3");
		composer = harness.useComposer(current);
		expect(composer.model).toBe("gpt-5.3");
		expect(composer.composerThinkingDepthOptions.length).toBeGreaterThan(1);
		expect(composer.buildComposerLlmSelection()).toEqual({
			model: "gpt-5.3",
			providerEndpointId: undefined,
			thinkingDepth: "",
		});

		composer.handleComposerThinkingDepthChange("high");
		composer = harness.useComposer(current);
		expect(composer.buildComposerLlmSelection()).toEqual({
			model: "gpt-5.3",
			providerEndpointId: undefined,
			thinkingDepth: "high",
		});
		composer.clearComposerLlmSelectionOverride();
		expect(composer.buildComposerLlmSelection()).toBeUndefined();
	});

	it("filters endpoint models, uses route defaults, and preserves explicit choices", async () => {
		const harness = await createHarness();
		const openaiKey = targetKey("openai-main", "gpt-5.3");
		const plainKey = targetKey("openai-main", "gpt-4.1");
		const codexKey = targetKey("codex-main", "gpt-5.2-codex");
		const routed = workspace({
			providerModelOptions: [{ value: "legacy", label: "Legacy" }],
			llmSettings: {
				OPENAI_MODEL: "gpt-4.1",
				CODEX_ENABLED: false,
				providerEndpoints: [
					endpoint("openai-main", "openai", ["gpt-5.3", "gpt-4.1"], {
						modelDisplayNames: { "gpt-5.3": "  Reasoner  ", "gpt-4.1": "" },
					}),
					endpoint("disabled", "azure", ["azure-model"], { enabled: false }),
					endpoint("codex-main", "codex", ["gpt-5.2-codex"]),
				],
				roleRoutes: [
					{
						role: "plan",
						primary: target("openai-main", "gpt-5.3", "high"),
						fallbacks: [target("openai-main", "gpt-4.1")],
					},
				],
			},
		});

		let composer = harness.useComposer(routed);
		expect(composer.composerModelOptions).toEqual([
			{ value: openaiKey, label: "Reasoner" },
			{ value: plainKey, label: "gpt-4.1 (openai-main endpoint)" },
		]);
		expect(
			composer.composerModelOptions.some((item) => item.value === codexKey),
		).toBe(false);
		harness.runEffects();

		composer = harness.useComposer(routed);
		expect(composer.model).toBe(plainKey);
		expect(composer.thinkingDepth).toBe("");
		composer.handleComposerModelChange(openaiKey);
		composer = harness.useComposer(routed);
		expect(composer.model).toBe(openaiKey);
		expect(composer.thinkingDepth).toBe("");
		expect(composer.buildComposerLlmSelection()).toEqual({
			model: "gpt-5.3",
			providerEndpointId: "openai-main",
			thinkingDepth: "",
		});
		composer.handleComposerThinkingDepthChange("high");
		composer = harness.useComposer(routed);
		expect(composer.buildComposerLlmSelection()?.thinkingDepth).toBe("high");

		harness.runEffects();
		composer = harness.useComposer(routed);
		expect(composer.model).toBe(openaiKey);
		composer.clearComposerLlmSelectionOverride();
		composer = harness.useComposer(routed);
		expect(composer.model).toBe(plainKey);
		expect(composer.thinkingDepth).toBe("");
	});

	it("supports enabled Codex endpoints and legacy provider option fallback", async () => {
		const harness = await createHarness();
		const codex = workspace({
			activeProvider: "codex",
			llmSettings: {
				CODEX_MODEL: "gpt-5.2-codex",
				CODEX_ENABLED: true,
				providerEndpoints: [endpoint("codex-main", "codex", ["gpt-5.2-codex"])],
				roleRoutes: [],
			},
		});
		let composer = harness.useComposer(codex);
		expect(composer.composerModelOptions).toHaveLength(1);
		harness.runEffects();
		composer = harness.useComposer(codex);
		expect(composer.model).toBe(targetKey("codex-main", "gpt-5.2-codex"));

		const fallbackHarness = await createHarness();
		const fallback = workspace({
			activeProvider: "azure",
			providerModelOptions: [{ value: "azure-default", label: "Azure" }],
			llmSettings: {
				AZURE_OPENAI_DEPLOYMENT_NAME: "azure-default",
				providerEndpoints: [],
				roleRoutes: [],
			},
		});
		let fallbackComposer = fallbackHarness.useComposer(fallback);
		expect(fallbackComposer.composerModelOptions).toEqual([
			{ value: "azure-default", label: "Azure" },
		]);
		fallbackHarness.runEffects();
		fallbackComposer = fallbackHarness.useComposer(fallback);
		expect(fallbackComposer.model).toBe("azure-default");
	});

	it("locks controls to an active run route and appends its missing option", async () => {
		const harness = await createHarness();
		const activeTarget = target(
			"runtime-endpoint",
			"runtime-thinking",
			"medium",
		);
		const active = workspace({
			activeSessionId: "task-1",
			providerModelOptions: [{ value: "legacy", label: "Legacy" }],
			latestRun: {
				id: "run-1",
				taskId: "task-1",
				status: "running",
				contextSnapshot: {},
			},
			latestRunEvents: [
				{
					id: "event-1",
					runId: "run-1",
					eventType: "model.request_started",
					payloadJson: {
						runEvent: {
							type: "model.request_started",
							data: activeTarget,
						},
					},
				},
			],
			llmSettings: {
				OPENAI_MODEL: "gpt-4.1",
				providerEndpoints: [],
				roleRoutes: [],
			},
		});
		const activeKey = JSON.stringify(activeTarget);

		let composer = harness.useComposer(active);
		expect(composer.composerModelOptions).toEqual([
			{ value: "legacy", label: "Legacy" },
			{
				value: activeKey,
				label: "runtime-thinking",
			},
		]);
		harness.runEffects();
		composer = harness.useComposer(active);
		harness.runEffects();
		composer = harness.useComposer(active);
		expect(composer.model).toBe(activeKey);
		expect(composer.thinkingDepth).toBe("medium");

		composer.handleComposerModelChange("legacy");
		composer.handleComposerThinkingDepthChange("high");
		expect(composer.buildComposerLlmSelection()).toBeUndefined();
		expect(stateSlots).toEqual([activeKey, "medium"]);
	});

	it("labels active endpoint models and avoids duplicating available active keys", async () => {
		const harness = await createHarness();
		const key = targetKey("active-endpoint", "gpt-5.3");
		const active = workspace({
			activeSessionId: "task-1",
			latestRun: {
				id: "run-1",
				taskId: "task-1",
				status: "finalizing",
				contextSnapshot: {
					effectiveLlmRouting: {
						active: target("active-endpoint", "gpt-5.3"),
					},
				},
			},
			llmSettings: {
				OPENAI_MODEL: "gpt-4.1",
				providerEndpoints: [
					endpoint("active-endpoint", "openai", ["gpt-5.3"], {
						name: "Active API",
						modelDisplayNames: { "gpt-5.3": " Active Reasoner " },
					}),
				],
				roleRoutes: [],
			},
		});

		let composer = harness.useComposer(active);
		expect(composer.composerModelOptions).toEqual([
			{ value: key, label: "Active Reasoner" },
		]);
		harness.runEffects();
		composer = harness.useComposer(active);
		expect(composer.model).toBe(key);
		expect(composer.thinkingDepth).toBe("");
	});

	it("clears overrides on session changes unless explicitly preserved", async () => {
		const harness = await createHarness();
		const options = [{ value: "gpt-5.3", label: "Reasoner" }];
		const sessionA = workspace({
			activeSessionId: "task-a",
			providerModelOptions: options,
		});
		let composer = harness.useComposer(sessionA);
		harness.runEffects();
		composer = harness.useComposer(sessionA);
		composer.handleComposerModelChange("gpt-5.3");
		composer = harness.useComposer(sessionA);
		expect(composer.buildComposerLlmSelection()).toEqual({
			model: "gpt-5.3",
			providerEndpointId: undefined,
			thinkingDepth: "",
		});

		composer = harness.useComposer(
			workspace({ activeSessionId: "task-b", providerModelOptions: options }),
		);
		expect(composer.buildComposerLlmSelection()).toBeUndefined();

		composer.handleComposerModelChange("gpt-5.3");
		composer.preserveComposerOverrideSessionIdRef.current = "task-c";
		composer = harness.useComposer(
			workspace({ activeSessionId: "task-c", providerModelOptions: options }),
		);
		expect(composer.buildComposerLlmSelection()).toEqual({
			model: "gpt-5.3",
			providerEndpointId: undefined,
			thinkingDepth: "",
		});
		expect(composer.preserveComposerOverrideSessionIdRef.current).toBeNull();
	});

	it("drops an explicit selection when its model disappears", async () => {
		const harness = await createHarness();
		const withModels = workspace({
			providerModelOptions: [
				{ value: "gpt-5.3", label: "Reasoner" },
				{ value: "gpt-4.1", label: "Fast" },
			],
		});
		let composer = harness.useComposer(withModels);
		harness.runEffects();
		composer = harness.useComposer(withModels);
		composer.handleComposerModelChange("gpt-5.3");
		composer = harness.useComposer(withModels);
		expect(composer.buildComposerLlmSelection()).toBeDefined();

		const withoutReasoner = workspace({
			providerModelOptions: [{ value: "gpt-4.1", label: "Fast" }],
		});
		composer = harness.useComposer(withoutReasoner);
		harness.runEffects();
		composer = harness.useComposer(withoutReasoner);
		expect(composer.model).toBe("gpt-4.1");
		expect(composer.buildComposerLlmSelection()).toBeUndefined();
	});
});
