import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Setter = ReturnType<typeof vi.fn>;
let stateSetters: Setter[] = [];
let effects: Array<() => undefined | (() => void)> = [];

const defaultLlm = { provider: "openai", model: "model-1" };
const defaultGeneral = {
	timezone: "Asia/Tokyo",
	language: "ja",
	currency: "JPY",
	fx: { source: "ecb", autoRefresh: true, lastRefreshedAt: null },
	planMode: { capabilities: {} },
	llmUsage: { promptPartObservabilityEnabled: true },
	dataRetention: {},
};
const appearance = { density: "comfortable" };
const savedAppearance = { density: "compact" };

function stateValues(overrides: Record<number, unknown> = {}) {
	const values: unknown[] = [
		defaultLlm,
		defaultGeneral,
		null,
		false,
		false,
		"idle",
		"",
		"",
		"idle",
		false,
		false,
		appearance,
		"",
		"idle",
	];
	for (const [index, value] of Object.entries(overrides))
		values[Number(index)] = value;
	return values;
}

function component(name: string) {
	return Object.defineProperty(() => null, "name", { value: name });
}

function jsonResponse(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

function setup(
	values = stateValues(),
	options: {
		runEffects?: boolean;
		activeHook?: Record<string, unknown>;
		commandOverrides?: Record<string, unknown>;
	} = {},
) {
	const queued = [...values];
	stateSetters = [];
	effects = [];
	vi.resetModules();
	vi.doMock("react", async () => {
		const actual = await vi.importActual<typeof import("react")>("react");
		return {
			...actual,
			useEffect: (callback: () => undefined | (() => void)) => {
				effects.push(callback);
				if (options.runEffects) callback();
			},
			useState: <T,>(initial: T | (() => T)) => {
				const value = queued.length
					? (queued.shift() as T)
					: typeof initial === "function"
						? (initial as () => T)()
						: initial;
				const setter = vi.fn((next: T | ((current: T) => T)) =>
					typeof next === "function"
						? (next as (current: T) => T)(value)
						: next,
				);
				stateSetters.push(setter);
				return [value, setter] as const;
			},
		};
	});
	vi.doMock("react-i18next", () => ({
		useTranslation: () => ({
			t: (key: string, params?: { status?: number }) =>
				params?.status ? `${key}:${params.status}` : key,
		}),
	}));

	const applyAppLanguage = vi.fn();
	vi.doMock("../src/i18n/I18nProvider", () => ({ applyAppLanguage }));
	const applyAppearanceSettings = vi.fn();
	const persistAppearanceSettings = vi.fn();
	vi.doMock(
		"../src/modules/nightworkers/contexts/WorkspaceAppearanceContext",
		() => ({
			useWorkspaceAppearanceState: () => ({
				settings: appearance,
				savedSettings: savedAppearance,
			}),
			useWorkspaceAppearanceActions: () => ({
				applyAppearanceSettings,
				saveAppearanceSettings: persistAppearanceSettings,
			}),
		}),
	);
	const createBlueprintPreviewDesignSettings = vi.fn(() => ({
		density: "reset",
	}));
	vi.doMock("../src/modules/blueprint-preview", () => ({
		AppearanceSettings: component("AppearanceSettings"),
		createBlueprintPreviewDesignSettings,
	}));

	const onSecurityChange = vi.fn();
	const saveSecurity = vi.fn(async () => undefined);
	const onExplorationChange = vi.fn();
	const saveExploration = vi.fn(async () => undefined);
	const intelligenceHook = {
		securityIntelligence: { settings: { enabled: true } },
		securityMessage: "security feedback",
		securityMessageStatus: "success",
		securityBusy: false,
		changeSecurityIntelligence: onSecurityChange,
		saveSecurityIntelligence: saveSecurity,
		projectExploration: { enabled: true, mcpServerId: "mcp-1" },
		explorationMessage: "exploration feedback",
		explorationMessageStatus: "error",
		explorationBusy: false,
		mcpServers: [{ id: "mcp-1", enabled: true }],
		explorationConfigurationValid: true,
		changeProjectExploration: onExplorationChange,
		saveProjectExploration: saveExploration,
		...options.activeHook,
	};
	vi.doMock("../src/modules/settings/useProjectIntelligenceSettings", () => ({
		useProjectIntelligenceSettings: () => intelligenceHook,
	}));

	const commands = {
		fetchLlmSettings: vi.fn(async () =>
			jsonResponse({ model: "loaded-model" }),
		),
		fetchGeneralSettings: vi.fn(async () =>
			jsonResponse({ language: "en", fx: { autoRefresh: false } }),
		),
		fetchFxRates: vi.fn(async () =>
			jsonResponse({ fetchedAt: "2026-08-08", rates: { JPY: 1 } }),
		),
		refreshFxRates: vi.fn(async () =>
			jsonResponse({ fetchedAt: "2026-08-09", rates: { JPY: 1 } }),
		),
		saveGeneralSettings: vi.fn(async () =>
			jsonResponse({ ...defaultGeneral, language: "en" }),
		),
		saveLlmSettings: vi.fn(async () => jsonResponse({ ok: true })),
		...options.commandOverrides,
	};
	vi.doMock("../src/modules/settings/settingsCommands", () => commands);

	const handleWorkbenchAnchorClick = vi.fn(
		(_event: unknown, callback: () => void) => callback(),
	);
	const serializeWorkbenchRoute = vi.fn(
		(route: { kind: string; section?: string }) =>
			route.section ? `/settings/${route.section}` : `/${route.kind}`,
	);
	vi.doMock("../src/modules/nightworkers/routing/workbench-link-click", () => ({
		handleWorkbenchAnchorClick,
	}));
	vi.doMock(
		"../src/modules/nightworkers/routing/workbench-route-state",
		() => ({
			serializeWorkbenchRoute,
		}),
	);

	vi.doMock("../src/modules/hooks/SettingsHooksPanel", () => ({
		SettingsHooksPanel: component("SettingsHooksPanel"),
	}));
	vi.doMock("../src/modules/mcp/SettingsMcpPanel", () => ({
		SettingsMcpPanel: component("SettingsMcpPanel"),
	}));
	vi.doMock("../src/modules/ontology", () => ({
		SettingsOntologyPanel: component("SettingsOntologyPanel"),
		SettingsProjectExplorationPanel: component(
			"SettingsProjectExplorationPanel",
		),
	}));
	vi.doMock("../src/modules/securityScan", () => ({
		SettingsVulnerabilityScanProviderPanel: component(
			"SettingsVulnerabilityScanProviderPanel",
		),
	}));
	vi.doMock("../src/modules/settings/SettingsGeneralPanel", () => ({
		GeneralSettingsPanel: component("GeneralSettingsPanel"),
	}));
	vi.doMock("../src/modules/settings/SettingsLlmPanel", () => ({
		SettingsLlmPanel: component("SettingsLlmPanel"),
	}));
	vi.doMock("../src/modules/settings/SettingsPlanModePanel", () => ({
		SettingsPlanModePanel: component("SettingsPlanModePanel"),
	}));
	vi.doMock("../src/modules/settings/SettingsSaveActions", () => ({
		SettingsSaveActions: component("SettingsSaveActions"),
	}));
	return {
		commands,
		applyAppLanguage,
		applyAppearanceSettings,
		persistAppearanceSettings,
		createBlueprintPreviewDesignSettings,
		handleWorkbenchAnchorClick,
		serializeWorkbenchRoute,
		intelligenceHook,
	};
}

function elements(node: ReactNode): ReactElement[] {
	if (
		node == null ||
		typeof node === "boolean" ||
		typeof node === "string" ||
		typeof node === "number"
	)
		return [];
	if (Array.isArray(node)) return node.flatMap(elements);
	const element = node as ReactElement<{ children?: ReactNode }>;
	return [element, ...elements(element.props?.children)];
}

function named(root: ReactNode, name: string) {
	return elements(root).filter(
		(element) =>
			typeof element.type === "function" && element.type.name === name,
	);
}

function anchors(root: ReactNode) {
	return elements(root).filter((element) => element.type === "a");
}

async function flushPromises() {
	for (let index = 0; index < 10; index += 1) await Promise.resolve();
	await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("settings screen coverage", () => {
	beforeEach(() => vi.restoreAllMocks());

	it("loads all persisted settings and handles an unavailable FX cache", async () => {
		let tools = setup(stateValues({ 3: true }), { runEffects: true });
		let module = await import("../src/modules/settings/SettingsScreen");
		const result = module.SettingsScreen({
			activeProject: null,
			onClose: vi.fn(),
		});
		expect((result as ReactElement).props.children).toContain("設定をロード中");
		await flushPromises();
		expect(stateSetters[0]).toHaveBeenCalledWith(
			expect.objectContaining({ model: "loaded-model" }),
		);
		expect(stateSetters[1]).toHaveBeenCalledWith(
			expect.objectContaining({
				language: "en",
				fx: expect.objectContaining({ autoRefresh: false }),
			}),
		);
		expect(stateSetters[2]).toHaveBeenCalledWith(
			expect.objectContaining({ fetchedAt: "2026-08-08" }),
		);
		expect(stateSetters[3]).toHaveBeenCalledWith(false);

		tools = setup(stateValues({ 3: true }), {
			runEffects: true,
			commandOverrides: {
				fetchFxRates: vi.fn(async () => jsonResponse({}, 500)),
			},
		});
		module = await import("../src/modules/settings/SettingsScreen");
		module.SettingsScreen({ activeProject: null, onClose: vi.fn() });
		await flushPromises();
		expect(stateSetters[2]).toHaveBeenCalledWith(null);
		expect(tools.commands.fetchFxRates).toHaveBeenCalledTimes(1);
	});

	it("renders the navigation, defaults unknown sections, and dispatches links", async () => {
		const tools = setup();
		const { SettingsScreen } = await import(
			"../src/modules/settings/SettingsScreen"
		);
		const onClose = vi.fn();
		const onSectionChange = vi.fn();
		const root = SettingsScreen({
			activeProject: null,
			activeSection: "unknown" as never,
			onClose,
			onSectionChange,
		});
		const links = anchors(root);
		expect(links).toHaveLength(9);
		links[0].props.onClick({ preventDefault: vi.fn() });
		links[1].props.onClick({ preventDefault: vi.fn() });
		expect(onClose).toHaveBeenCalledTimes(1);
		expect(onSectionChange).toHaveBeenCalledWith("general");
		expect(tools.serializeWorkbenchRoute).toHaveBeenCalledTimes(9);

		setup();
		const next = await import("../src/modules/settings/SettingsScreen");
		const withoutHandler = next.SettingsScreen({
			activeProject: null,
			onClose,
		});
		anchors(withoutHandler)[1].props.onClick({});
	});

	it("changes and saves LLM settings, including HTTP and non-Error failures", async () => {
		const tools = setup();
		let { SettingsScreen } = await import(
			"../src/modules/settings/SettingsScreen"
		);
		let root = SettingsScreen({
			activeProject: null,
			activeSection: "llm-providers",
			onClose: vi.fn(),
		});
		let panel = named(root, "SettingsLlmPanel")[0];
		panel.props.onChange("model", "model-2");
		await panel.props.handleSave();
		expect(stateSetters[0]).toHaveBeenCalledWith(expect.any(Function));
		expect(stateSetters[5]).toHaveBeenLastCalledWith("success");
		expect(stateSetters[6]).toHaveBeenLastCalledWith("settings.saveSucceeded");
		expect(tools.commands.saveLlmSettings).toHaveBeenCalledWith(defaultLlm);

		setup(stateValues(), {
			commandOverrides: {
				saveLlmSettings: vi.fn(async () => jsonResponse({}, 418)),
			},
		});
		({ SettingsScreen } = await import(
			"../src/modules/settings/SettingsScreen"
		));
		root = SettingsScreen({
			activeProject: null,
			activeSection: "llm-routing",
			onClose: vi.fn(),
		});
		panel = named(root, "SettingsLlmPanel")[0];
		await panel.props.handleSave();
		expect(stateSetters[5]).toHaveBeenLastCalledWith("error");
		expect(stateSetters[6]).toHaveBeenLastCalledWith(
			"settings.saveFailedWithStatus:418",
		);

		setup(stateValues(), {
			commandOverrides: {
				saveLlmSettings: vi.fn(async () => {
					throw "offline";
				}),
			},
		});
		({ SettingsScreen } = await import(
			"../src/modules/settings/SettingsScreen"
		));
		root = SettingsScreen({
			activeProject: null,
			activeSection: "llm-routing",
			onClose: vi.fn(),
		});
		await named(root, "SettingsLlmPanel")[0].props.handleSave();
		expect(stateSetters[6]).toHaveBeenLastCalledWith("offline");
	});

	it("saves general settings and handles response and thrown failures", async () => {
		const tools = setup();
		let { SettingsScreen } = await import(
			"../src/modules/settings/SettingsScreen"
		);
		let root = SettingsScreen({
			activeProject: null,
			activeSection: "general",
			onClose: vi.fn(),
		});
		let actions = named(root, "SettingsSaveActions");
		expect(actions).toHaveLength(2);
		actions[0].props.onSave();
		await flushPromises();
		expect(tools.applyAppLanguage).toHaveBeenCalledWith("en");
		expect(stateSetters[8]).toHaveBeenLastCalledWith("success");

		setup(stateValues(), {
			commandOverrides: {
				saveGeneralSettings: vi.fn(async () => jsonResponse({}, 409)),
			},
		});
		({ SettingsScreen } = await import(
			"../src/modules/settings/SettingsScreen"
		));
		root = SettingsScreen({
			activeProject: null,
			activeSection: "plan-mode",
			onClose: vi.fn(),
		});
		actions = named(root, "SettingsSaveActions");
		actions[1].props.onSave();
		await flushPromises();
		expect(stateSetters[7]).toHaveBeenLastCalledWith(
			"settings.general.saveFailed",
		);
		expect(stateSetters[8]).toHaveBeenLastCalledWith("error");

		setup(stateValues(), {
			commandOverrides: {
				saveGeneralSettings: vi.fn(async () => {
					throw "offline";
				}),
			},
		});
		({ SettingsScreen } = await import(
			"../src/modules/settings/SettingsScreen"
		));
		root = SettingsScreen({
			activeProject: null,
			activeSection: "general",
			onClose: vi.fn(),
		});
		named(root, "SettingsSaveActions")[0].props.onSave();
		await flushPromises();
		expect(stateSetters[7]).toHaveBeenLastCalledWith(
			"settings.general.saveFailed",
		);

		setup(stateValues(), {
			commandOverrides: {
				saveGeneralSettings: vi.fn(async () => {
					throw new Error("disk full");
				}),
			},
		});
		({ SettingsScreen } = await import(
			"../src/modules/settings/SettingsScreen"
		));
		root = SettingsScreen({
			activeProject: null,
			activeSection: "general",
			onClose: vi.fn(),
		});
		named(root, "SettingsSaveActions")[0].props.onSave();
		await flushPromises();
		expect(stateSetters[7]).toHaveBeenLastCalledWith("disk full");
	});

	it("refreshes FX rates and reports HTTP and non-Error failures", async () => {
		const tools = setup();
		let { SettingsScreen } = await import(
			"../src/modules/settings/SettingsScreen"
		);
		let root = SettingsScreen({
			activeProject: null,
			activeSection: "general",
			onClose: vi.fn(),
		});
		const panel = named(root, "GeneralSettingsPanel")[0];
		panel.props.onChange({ ...defaultGeneral, language: "en" });
		panel.props.onRefreshFx();
		await flushPromises();
		expect(tools.commands.refreshFxRates).toHaveBeenCalledTimes(1);
		expect(stateSetters[1]).toHaveBeenCalledWith(expect.any(Function));
		expect(stateSetters[8]).toHaveBeenLastCalledWith("success");

		setup(stateValues(), {
			commandOverrides: {
				refreshFxRates: vi.fn(async () => jsonResponse({}, 503)),
			},
		});
		({ SettingsScreen } = await import(
			"../src/modules/settings/SettingsScreen"
		));
		root = SettingsScreen({
			activeProject: null,
			activeSection: "general",
			onClose: vi.fn(),
		});
		named(root, "GeneralSettingsPanel")[0].props.onRefreshFx();
		await flushPromises();
		expect(stateSetters[7]).toHaveBeenLastCalledWith(
			"settings.general.exchangeRefreshFailed:503",
		);

		setup(stateValues(), {
			commandOverrides: {
				refreshFxRates: vi.fn(async () => {
					throw "network down";
				}),
			},
		});
		({ SettingsScreen } = await import(
			"../src/modules/settings/SettingsScreen"
		));
		root = SettingsScreen({
			activeProject: null,
			activeSection: "general",
			onClose: vi.fn(),
		});
		named(root, "GeneralSettingsPanel")[0].props.onRefreshFx();
		await flushPromises();
		expect(stateSetters[7]).toHaveBeenLastCalledWith("network down");
	});

	it("applies, saves, resets, and cancels appearance drafts", async () => {
		const tools = setup();
		const { SettingsScreen } = await import(
			"../src/modules/settings/SettingsScreen"
		);
		const root = SettingsScreen({
			activeProject: null,
			activeSection: "appearance",
			onClose: vi.fn(),
		});
		const appearancePanel = named(root, "AppearanceSettings")[0];
		appearancePanel.props.onChange({ density: "spacious" });
		expect(tools.applyAppearanceSettings).toHaveBeenCalledWith({
			density: "spacious",
		});
		const actions = named(root, "SettingsSaveActions");
		actions[0].props.onSave();
		expect(tools.persistAppearanceSettings).toHaveBeenCalledWith(appearance);
		const buttons = elements(actions[0].props.secondaryAction).filter(
			(node) => node.type === "button",
		);
		buttons[0].props.onClick();
		expect(tools.createBlueprintPreviewDesignSettings).toHaveBeenCalledWith(
			undefined,
		);
		buttons[1].props.onClick();
		expect(tools.applyAppearanceSettings).toHaveBeenCalledWith(savedAppearance);
	});

	it("renders project intelligence, hooks, and MCP sections with their actions", async () => {
		let tools = setup();
		let { SettingsScreen } = await import(
			"../src/modules/settings/SettingsScreen"
		);
		const project = { id: "repo-1" } as never;
		let root = SettingsScreen({
			activeProject: project,
			activeSection: "security-intelligence",
			onClose: vi.fn(),
		});
		expect(named(root, "SettingsVulnerabilityScanProviderPanel")).toHaveLength(
			1,
		);
		const ontology = named(root, "SettingsOntologyPanel")[0];
		const exploration = named(root, "SettingsProjectExplorationPanel")[0];
		ontology.props.onChange({ settings: { enabled: false } });
		exploration.props.onChange({ enabled: false });
		const actions = named(root, "SettingsSaveActions");
		await actions[0].props.onSave();
		await actions[1].props.onSave();
		expect(
			tools.intelligenceHook.saveSecurityIntelligence,
		).toHaveBeenCalledTimes(1);
		expect(tools.intelligenceHook.saveProjectExploration).toHaveBeenCalledTimes(
			1,
		);

		tools = setup(stateValues(), {
			activeHook: {
				securityIntelligence: null,
				projectExploration: null,
				explorationConfigurationValid: false,
			},
		});
		({ SettingsScreen } = await import(
			"../src/modules/settings/SettingsScreen"
		));
		root = SettingsScreen({
			activeProject: null,
			activeSection: "security-intelligence",
			onClose: vi.fn(),
		});
		const disabled = named(root, "SettingsSaveActions");
		expect(disabled[0].props.disabled).toBe(true);
		expect(disabled[1].props.disabled).toBe(true);

		setup();
		({ SettingsScreen } = await import(
			"../src/modules/settings/SettingsScreen"
		));
		root = SettingsScreen({
			activeProject: null,
			activeSection: "hooks",
			onClose: vi.fn(),
		});
		expect(named(root, "SettingsHooksPanel")).toHaveLength(1);
		setup();
		({ SettingsScreen } = await import(
			"../src/modules/settings/SettingsScreen"
		));
		root = SettingsScreen({
			activeProject: null,
			activeSection: "mcp",
			onClose: vi.fn(),
		});
		expect(named(root, "SettingsMcpPanel")).toHaveLength(1);
	});

	it("syncs the appearance draft outside the appearance section", async () => {
		setup();
		const { SettingsScreen } = await import(
			"../src/modules/settings/SettingsScreen"
		);
		SettingsScreen({
			activeProject: null,
			activeSection: "general",
			onClose: vi.fn(),
		});
		effects[0]();
		expect(stateSetters[11]).toHaveBeenCalledWith(appearance);

		setup();
		const next = await import("../src/modules/settings/SettingsScreen");
		next.SettingsScreen({
			activeProject: null,
			activeSection: "appearance",
			onClose: vi.fn(),
		});
		effects[0]();
		expect(stateSetters[11]).not.toHaveBeenCalled();
	});
});
