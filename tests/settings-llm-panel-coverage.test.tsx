import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

let stateSetters: Array<ReturnType<typeof vi.fn>> = [];
let effects: Array<() => undefined | (() => void)> = [];

const codexEndpoint = {
	id: "codex-1",
	name: "Codex",
	kind: "codex",
	enabled: true,
	apiKey: "",
	baseUrl: "",
	endpoint: "",
	apiVersion: "",
	region: "",
	models: ["gpt-5-codex", "o3"],
	modelDisplayNames: { "gpt-5-codex": "Codex Five" },
};
const localEndpoint = {
	id: "local-1",
	name: "Local",
	kind: "local",
	enabled: true,
	apiKey: "",
	baseUrl: "http://localhost:11434/v1",
	endpoint: "",
	apiVersion: "",
	region: "",
	models: ["qwen3-coder", "deepseek-r1"],
	modelDisplayNames: {},
};
const disabledEndpoint = { ...localEndpoint, id: "off-1", enabled: false };
const primary = {
	providerEndpointId: "local-1",
	model: "deepseek-r1",
	thinkingDepth: "medium",
};
const fallbackOne = { providerEndpointId: "local-1", model: "qwen3-coder" };
const fallbackTwo = {
	providerEndpointId: "codex-1",
	model: "o3",
	thinkingDepth: "high",
};
const route = {
	role: "coding_agent",
	primary,
	fallbacks: [fallbackOne, fallbackTwo],
};
const emptyRoute = {
	role: "mission_pilot",
	primary: { providerEndpointId: "", model: "" },
	fallbacks: [],
};
const settings = {
	CODEX_MODEL: "gpt-5-codex",
	CODEX_ENABLED: true,
	CODEX_ACCESS_TOKEN: "token",
	providerEndpoints: [codexEndpoint, localEndpoint, disabledEndpoint],
	roleRoutes: [route, emptyRoute],
};
const codexStatus = {
	loggedIn: true,
	authSource: "chatgpt",
	codexHome: "/tmp/codex",
	models: [
		{ value: "o4-mini", label: "O4 Mini" },
		{ value: "o4-mini", label: "duplicate" },
	],
	modelSource: "catalog",
};

function component(name: string) {
	return Object.defineProperty(() => null, "name", { value: name });
}

function jsonResponse(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

function setup(
	state: unknown[] = [null, false, null, {}],
	commandOverrides: Record<string, unknown> = {},
) {
	const queued = [...state];
	stateSetters = [];
	effects = [];
	vi.resetModules();
	vi.doMock("react", async () => {
		const actual = await vi.importActual<typeof import("react")>("react");
		return {
			...actual,
			useCallback: <T extends (...args: never[]) => unknown>(callback: T) =>
				callback,
			useEffect: (callback: () => undefined | (() => void)) =>
				effects.push(callback),
			useState: <T,>(initial: T | (() => T)) => {
				const value = queued.length
					? (queued.shift() as T)
					: typeof initial === "function"
						? (initial as () => T)()
						: initial;
				const setter = vi.fn((next: T | ((current: T) => T)) =>
					typeof next === "function" ? (next as (value: T) => T)(value) : next,
				);
				stateSetters.push(setter);
				return [value, setter] as const;
			},
		};
	});
	vi.doMock("react-i18next", () => ({
		useTranslation: () => ({ t: (key: string) => key }),
	}));
	vi.doMock("@/components/ui/Button", () => ({ Button: component("Button") }));
	vi.doMock("../src/modules/settings/SettingsFields", () => ({
		Field: component("Field"),
		NumberField: component("NumberField"),
		SelectField: component("SelectField"),
	}));
	vi.doMock("../src/modules/settings/SettingsLlmProviderEndpoints", () => ({
		SettingsLlmProviderEndpoints: component("SettingsLlmProviderEndpoints"),
	}));
	vi.doMock("../src/modules/settings/SettingsSaveActions", () => ({
		SettingsSaveActions: component("SettingsSaveActions"),
	}));
	const commands = {
		fetchCodexSdkStatus: vi.fn(async () => jsonResponse(codexStatus)),
		testLlmProviderHealth: vi.fn(async () =>
			jsonResponse({
				ok: true,
				providerEndpointId: "local-1",
				reachable: true,
			}),
		),
		...commandOverrides,
	};
	vi.doMock("../src/modules/settings/settingsCommands", () => commands);
	return commands;
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

async function flushPromises() {
	for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

describe("settings LLM panel coverage", () => {
	beforeEach(() => vi.restoreAllMocks());

	it("loads Codex status for both supported sections and handles non-OK responses", async () => {
		let commands = setup();
		let { SettingsLlmPanel } = await import(
			"../src/modules/settings/SettingsLlmPanel"
		);
		SettingsLlmPanel({
			section: "providers",
			settings: settings as never,
			isSaving: false,
			saveStatus: "idle",
			saveMessage: "",
			onChange: vi.fn(),
			handleSave: vi.fn(),
		});
		effects[0]();
		await flushPromises();
		expect(commands.fetchCodexSdkStatus).toHaveBeenCalledTimes(1);
		expect(stateSetters[0]).toHaveBeenCalledWith(codexStatus);
		expect(stateSetters[1]).toHaveBeenLastCalledWith(false);

		commands = setup([], {
			fetchCodexSdkStatus: vi.fn(async () => jsonResponse({}, 503)),
		});
		({ SettingsLlmPanel } = await import(
			"../src/modules/settings/SettingsLlmPanel"
		));
		SettingsLlmPanel({
			section: "routing",
			settings: settings as never,
			isSaving: false,
			saveStatus: "idle",
			saveMessage: "",
			onChange: vi.fn(),
			handleSave: vi.fn(),
		});
		effects[0]();
		await flushPromises();
		expect(stateSetters[0]).not.toHaveBeenCalled();
		expect(stateSetters[1]).toHaveBeenLastCalledWith(false);

		commands = setup();
		({ SettingsLlmPanel } = await import(
			"../src/modules/settings/SettingsLlmPanel"
		));
		SettingsLlmPanel({
			section: "other" as never,
			settings: settings as never,
			isSaving: false,
			saveStatus: "idle",
			saveMessage: "",
			onChange: vi.fn(),
			handleSave: vi.fn(),
		});
		effects[0]();
		expect(commands.fetchCodexSdkStatus).not.toHaveBeenCalled();

		commands = setup([], {
			fetchCodexSdkStatus: vi.fn(async () => {
				throw new Error("offline");
			}),
		});
		({ SettingsLlmPanel } = await import(
			"../src/modules/settings/SettingsLlmPanel"
		));
		SettingsLlmPanel({
			section: "providers",
			settings: settings as never,
			isSaving: false,
			saveStatus: "idle",
			saveMessage: "",
			onChange: vi.fn(),
			handleSave: vi.fn(),
		});
		effects[0]();
		await flushPromises();
		expect(commands.fetchCodexSdkStatus).toHaveBeenCalledTimes(1);
		expect(stateSetters[0]).not.toHaveBeenCalled();
		expect(stateSetters[1]).toHaveBeenLastCalledWith(false);
	});

	it("adds, edits, removes, checks, and toggles provider endpoints", async () => {
		const commands = setup([codexStatus, false, null, {}]);
		const onChange = vi.fn();
		const handleSave = vi.fn(async () => undefined);
		const { SettingsLlmPanel } = await import(
			"../src/modules/settings/SettingsLlmPanel"
		);
		const root = SettingsLlmPanel({
			section: "providers",
			settings: settings as never,
			isSaving: false,
			saveStatus: "success",
			saveMessage: "saved",
			onChange,
			handleSave,
		});
		const endpointPanel = named(root, "SettingsLlmProviderEndpoints")[0];
		endpointPanel.props.addEndpoint();
		endpointPanel.props.updateEndpoint("local-1", { name: "Updated" });
		endpointPanel.props.removeEndpoint("local-1");
		await endpointPanel.props.checkEndpointHealth(localEndpoint);
		expect(commands.testLlmProviderHealth).toHaveBeenCalledWith(
			"local-1",
			localEndpoint,
		);
		expect(stateSetters[3]).toHaveBeenCalledWith(expect.any(Function));

		const checkbox = elements(root).find(
			(element) =>
				element.type === "input" && element.props.type === "checkbox",
		);
		if (!checkbox) throw new Error("Codex enabled checkbox was not rendered");
		checkbox.props.onChange({ target: { checked: false } });
		expect(onChange).toHaveBeenCalledWith("CODEX_ENABLED", false);
		const codexModel = named(root, "SelectField").find(
			(element) => element.props.id === "codex-model",
		);
		if (!codexModel) throw new Error("Codex model field was not rendered");
		codexModel.props.onChange("o4-mini");
		const token = named(root, "Field")[0];
		token.props.onChange("replacement");
		const saveActions = named(root, "SettingsSaveActions");
		saveActions[0].props.onSave();
		expect(handleSave).toHaveBeenCalledTimes(1);
		expect(onChange).toHaveBeenCalledWith("CODEX_MODEL", "o4-mini");
		expect(onChange).toHaveBeenCalledWith("CODEX_ACCESS_TOKEN", "replacement");
	});

	it("records provider health failures from Error and string values", async () => {
		let commands = setup([null, false, null, {}], {
			testLlmProviderHealth: vi.fn(
				async () =>
					new Response(
						JSON.stringify({
							error: { code: "PROVIDER_UNHEALTHY", message: "unhealthy" },
						}),
						{ status: 500, headers: { "content-type": "application/json" } },
					),
			),
		});
		let { SettingsLlmPanel } = await import(
			"../src/modules/settings/SettingsLlmPanel"
		);
		let root = SettingsLlmPanel({
			section: "providers",
			settings: settings as never,
			isSaving: false,
			saveStatus: "idle",
			saveMessage: "",
			onChange: vi.fn(),
			handleSave: vi.fn(),
		});
		await named(
			root,
			"SettingsLlmProviderEndpoints",
		)[0].props.checkEndpointHealth(localEndpoint);
		expect(stateSetters[3].mock.results.at(-1)?.value).toEqual(
			expect.objectContaining({
				"local-1": expect.objectContaining({ message: "unhealthy" }),
			}),
		);

		commands = setup([null, false, null, {}], {
			testLlmProviderHealth: vi.fn(async () => {
				throw "offline";
			}),
		});
		({ SettingsLlmPanel } = await import(
			"../src/modules/settings/SettingsLlmPanel"
		));
		root = SettingsLlmPanel({
			section: "providers",
			settings: settings as never,
			isSaving: false,
			saveStatus: "idle",
			saveMessage: "",
			onChange: vi.fn(),
			handleSave: vi.fn(),
		});
		await named(
			root,
			"SettingsLlmProviderEndpoints",
		)[0].props.checkEndpointHealth(localEndpoint);
		expect(commands.testLlmProviderHealth).toHaveBeenCalledTimes(1);
		expect(stateSetters[3].mock.results.at(-1)?.value).toEqual(
			expect.objectContaining({
				"local-1": expect.objectContaining({ message: "offline" }),
			}),
		);
	});

	it("updates routing targets, thinking depth, fallback order, and removal", async () => {
		setup([codexStatus, false, null, {}]);
		const onChange = vi.fn();
		const { SettingsLlmPanel } = await import(
			"../src/modules/settings/SettingsLlmPanel"
		);
		const root = SettingsLlmPanel({
			section: "routing",
			settings: settings as never,
			isSaving: true,
			saveStatus: "error",
			saveMessage: "bad",
			onChange,
			handleSave: vi.fn(),
		});
		const selects = named(root, "SelectField");
		selects
			.find((field) => field.props.id === "coding_agent-primary-model-target")
			?.props.onChange("codex-1::o3");
		selects
			.find((field) => field.props.id === "coding_agent-primary-thinking-depth")
			?.props.onChange("high");
		selects
			.find((field) => field.props.id === "coding_agent-fallback-0")
			?.props.onChange("codex-1::o3");
		selects
			.find(
				(field) => field.props.id === "coding_agent-fallback-1-thinking-depth",
			)
			?.props.onChange("low");
		const numberFields = named(root, "NumberField");
		const primaryTimeout = numberFields.find(
			(field) => field.props.id === "coding_agent-primary-request-timeout",
		);
		expect(primaryTimeout?.props).toMatchObject({
			value: 300,
			min: 30,
			max: 1200,
			clampOnBlur: true,
		});
		primaryTimeout?.props.onChange(1200);
		numberFields
			.find(
				(field) => field.props.id === "coding_agent-fallback-0-request-timeout",
			)
			?.props.onChange(420);

		const buttons = named(root, "Button");
		for (const button of buttons) button.props.onClick?.();
		expect(onChange).toHaveBeenCalledWith("roleRoutes", expect.any(Array));
		expect(onChange.mock.calls.length).toBeGreaterThan(8);
	});

	it("renders empty provider and fallback alternatives", async () => {
		setup([null, true, null, {}]);
		const sparseSettings = {
			...settings,
			CODEX_MODEL: "",
			CODEX_ENABLED: false,
			providerEndpoints: [{ ...localEndpoint, models: [], enabled: false }],
			roleRoutes: [emptyRoute],
		};
		const { SettingsLlmPanel } = await import(
			"../src/modules/settings/SettingsLlmPanel"
		);
		const providerRoot = SettingsLlmPanel({
			section: "providers",
			settings: sparseSettings as never,
			isSaving: false,
			saveStatus: "idle",
			saveMessage: "",
			onChange: vi.fn(),
			handleSave: vi.fn(),
		});
		expect(
			named(providerRoot, "SelectField").find(
				(field) => field.props.id === "codex-model",
			)?.props.options,
		).toEqual([{ value: "", label: "settings.llm.none" }]);

		setup([null, false, null, {}]);
		const module = await import("../src/modules/settings/SettingsLlmPanel");
		const routingRoot = module.SettingsLlmPanel({
			section: "routing",
			settings: sparseSettings as never,
			isSaving: false,
			saveStatus: "idle",
			saveMessage: "",
			onChange: vi.fn(),
			handleSave: vi.fn(),
		});
		const primarySelect = named(routingRoot, "SelectField")[0];
		expect(primarySelect.props.options[0].label).toBe(
			"settings.llm.noModelTargets",
		);
		named(routingRoot, "Button")[0].props.onClick();
	});
});
