import { beforeEach, describe, expect, it, vi } from "vitest";

type Setter = ReturnType<typeof vi.fn>;
let stateSetters: Setter[] = [];
let refs: Array<{ current: unknown }> = [];
let pendingEffects: Array<() => undefined | (() => void)> = [];
let effectCleanups: Array<() => void> = [];

function mockReactHooks(
	values: unknown[],
	options: { runEffects?: boolean; deferEffects?: boolean } = {},
) {
	const stateValues = [...values];
	stateSetters = [];
	refs = [];
	pendingEffects = [];
	effectCleanups = [];
	vi.resetModules();
	vi.doMock("react", async () => {
		const actual = await vi.importActual<typeof import("react")>("react");
		return {
			...actual,
			useEffect: (callback: () => undefined | (() => void)) => {
				if (options.deferEffects) {
					pendingEffects.push(callback);
					return;
				}
				if (!options.runEffects) return;
				const cleanup = callback();
				if (typeof cleanup === "function") effectCleanups.push(cleanup);
			},
			useRef: <T>(initial: T) => {
				const ref = { current: initial };
				refs.push(ref as { current: unknown });
				return ref;
			},
			useState: <T>(initial: T | (() => T)) => {
				const value = stateValues.length
					? (stateValues.shift() as T)
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
		useTranslation: () => ({ t: (key: string) => `translated:${key}` }),
	}));
}

function jsonResponse(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

const securitySettings = {
	settings: {
		enabled: true,
		providerId: "vulnworkbench",
	},
};
const savedSecuritySettings = {
	settings: {
		enabled: false,
		providerId: "vulnworkbench",
	},
};
const explorationSettings = {
	enabled: true,
	mcpServerId: "mcp-1",
};
const savedExplorationSettings = {
	enabled: false,
	mcpServerId: null,
};
const enabledServer = { id: "mcp-1", name: "Catalog", enabled: true };

function settingsState(overrides: Record<number, unknown> = {}) {
	const values: unknown[] = [
		null,
		"",
		"idle",
		false,
		null,
		"",
		"idle",
		false,
		[],
	];
	for (const [index, value] of Object.entries(overrides))
		values[Number(index)] = value;
	return values;
}

function mockCommands(overrides: Record<string, unknown> = {}) {
	const commands = {
		fetchProjectSecurityIntelligenceSettings: vi.fn(async () =>
			jsonResponse(securitySettings),
		),
		fetchProjectExplorationSettings: vi.fn(async () =>
			jsonResponse(explorationSettings),
		),
		saveProjectSecurityIntelligenceSettings: vi.fn(async () =>
			jsonResponse(savedSecuritySettings),
		),
		saveProjectExplorationSettings: vi.fn(async () =>
			jsonResponse(savedExplorationSettings),
		),
		...overrides,
	};
	vi.doMock("../src/modules/ontology", () => commands);
	const mcpCommands = {
		fetchMcpServers: vi.fn(async () =>
			jsonResponse({ servers: [enabledServer] }),
		),
	};
	vi.doMock("../src/modules/mcp/mcpCommands", () => mcpCommands);
	return { commands, mcpCommands };
}

async function flushPromises() {
	for (let index = 0; index < 12; index += 1) await Promise.resolve();
	await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("project intelligence settings coverage", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it("resets both groups when no project is active", async () => {
		mockReactHooks(settingsState(), { runEffects: true });
		const { commands, mcpCommands } = mockCommands();
		const { useProjectIntelligenceSettings } = await import(
			"../src/modules/settings/useProjectIntelligenceSettings"
		);
		const result = useProjectIntelligenceSettings(null);

		expect(result.explorationConfigurationValid).toBe(true);
		expect(stateSetters[0]).toHaveBeenCalledWith(null);
		expect(stateSetters[3]).toHaveBeenCalledWith(false);
		expect(stateSetters[4]).toHaveBeenCalledWith(null);
		expect(stateSetters[8]).toHaveBeenCalledWith([]);
		expect(stateSetters[7]).toHaveBeenCalledWith(false);
		expect(
			commands.fetchProjectSecurityIntelligenceSettings,
		).not.toHaveBeenCalled();
		expect(mcpCommands.fetchMcpServers).not.toHaveBeenCalled();
	});

	it("loads security, exploration, and MCP settings", async () => {
		mockReactHooks(settingsState(), { runEffects: true });
		const { commands, mcpCommands } = mockCommands();
		const { useProjectIntelligenceSettings } = await import(
			"../src/modules/settings/useProjectIntelligenceSettings"
		);
		useProjectIntelligenceSettings({ id: "repo-1" } as never);
		await flushPromises();

		expect(
			commands.fetchProjectSecurityIntelligenceSettings,
		).toHaveBeenCalledWith("repo-1");
		expect(commands.fetchProjectExplorationSettings).toHaveBeenCalledWith(
			"repo-1",
		);
		expect(mcpCommands.fetchMcpServers).toHaveBeenCalledTimes(1);
		expect(stateSetters[0]).toHaveBeenCalledWith(securitySettings);
		expect(stateSetters[4]).toHaveBeenCalledWith(explorationSettings);
		expect(stateSetters[8]).toHaveBeenCalledWith([enabledServer]);
		expect(stateSetters[3]).toHaveBeenLastCalledWith(false);
		expect(stateSetters[7]).toHaveBeenLastCalledWith(false);
		expect(effectCleanups).toHaveLength(2);
	});

	it("reports independent loading failures and joins exploration errors", async () => {
		mockReactHooks(settingsState(), { runEffects: true });
		const { mcpCommands } = mockCommands({
			fetchProjectSecurityIntelligenceSettings: vi.fn(async () =>
				jsonResponse(
					{
						error: {
							code: "SECURITY_SETTINGS_UNAVAILABLE",
							message: "Security settings unavailable",
						},
					},
					503,
				),
			),
			fetchProjectExplorationSettings: vi.fn(async () => {
				throw "exploration offline";
			}),
		});
		mcpCommands.fetchMcpServers.mockResolvedValue(
			jsonResponse(
				{
					error: { code: "MCP_UNAVAILABLE", message: "MCP unavailable" },
				},
				502,
			),
		);
		const { useProjectIntelligenceSettings } = await import(
			"../src/modules/settings/useProjectIntelligenceSettings"
		);
		useProjectIntelligenceSettings({ id: "repo-1" } as never);
		await flushPromises();

		expect(stateSetters[0]).toHaveBeenCalledWith(null);
		expect(stateSetters[1]).toHaveBeenCalledWith(
			"Security settings unavailable",
		);
		expect(stateSetters[2]).toHaveBeenCalledWith("error");
		expect(stateSetters[4]).toHaveBeenCalledWith(null);
		expect(stateSetters[8]).toHaveBeenCalledWith([]);
		expect(stateSetters[5]).toHaveBeenCalledWith(
			"exploration offline / MCP unavailable",
		);
		expect(stateSetters[6]).toHaveBeenCalledWith("error");
	});

	it("keeps a successful exploration result when only MCP loading fails", async () => {
		mockReactHooks(settingsState(), { runEffects: true });
		const { mcpCommands } = mockCommands();
		mcpCommands.fetchMcpServers.mockRejectedValue(new Error("MCP offline"));
		const { useProjectIntelligenceSettings } = await import(
			"../src/modules/settings/useProjectIntelligenceSettings"
		);
		useProjectIntelligenceSettings({ id: "repo-1" } as never);
		await flushPromises();

		expect(stateSetters[4]).toHaveBeenCalledWith(explorationSettings);
		expect(stateSetters[8]).toHaveBeenCalledWith([]);
		expect(stateSetters[5]).toHaveBeenCalledWith("MCP offline");
	});

	it("ignores loading results after effect cleanup", async () => {
		mockReactHooks(settingsState(), { deferEffects: true });
		mockCommands();
		const { useProjectIntelligenceSettings } = await import(
			"../src/modules/settings/useProjectIntelligenceSettings"
		);
		useProjectIntelligenceSettings({ id: "repo-1" } as never);
		const cleanups = pendingEffects
			.map((effect) => effect())
			.filter(
				(cleanup): cleanup is () => void => typeof cleanup === "function",
			);
		for (const cleanup of cleanups) cleanup();
		await flushPromises();

		expect(stateSetters[0]).not.toHaveBeenCalledWith(securitySettings);
		expect(stateSetters[3]).not.toHaveBeenCalledWith(false);
		expect(stateSetters[4]).not.toHaveBeenCalledWith(explorationSettings);
		expect(stateSetters[7]).not.toHaveBeenCalledWith(false);
	});

	it("changes and saves both settings groups", async () => {
		mockReactHooks(
			settingsState({
				0: securitySettings,
				4: explorationSettings,
				8: [enabledServer],
			}),
		);
		const { commands } = mockCommands();
		const { useProjectIntelligenceSettings } = await import(
			"../src/modules/settings/useProjectIntelligenceSettings"
		);
		const result = useProjectIntelligenceSettings({ id: "repo-1" } as never);

		expect(result.explorationConfigurationValid).toBe(true);
		result.changeSecurityIntelligence(savedSecuritySettings as never);
		result.changeProjectExploration(savedExplorationSettings as never);
		await result.saveSecurityIntelligence();
		await result.saveProjectExploration();

		expect(
			commands.saveProjectSecurityIntelligenceSettings,
		).toHaveBeenCalledWith("repo-1", securitySettings.settings);
		expect(commands.saveProjectExplorationSettings).toHaveBeenCalledWith(
			"repo-1",
			explorationSettings,
		);
		expect(stateSetters[0]).toHaveBeenLastCalledWith(savedSecuritySettings);
		expect(stateSetters[1]).toHaveBeenLastCalledWith(
			"translated:settings.securityIntelligence.saveSucceeded",
		);
		expect(stateSetters[2]).toHaveBeenLastCalledWith("success");
		expect(stateSetters[4]).toHaveBeenLastCalledWith(savedExplorationSettings);
		expect(stateSetters[5]).toHaveBeenLastCalledWith(
			"translated:settings.projectExploration.saveSucceeded",
		);
		expect(stateSetters[6]).toHaveBeenLastCalledWith("success");
	});

	it("guards unavailable and invalid save operations", async () => {
		mockReactHooks(settingsState());
		const { commands } = mockCommands();
		const { useProjectIntelligenceSettings } = await import(
			"../src/modules/settings/useProjectIntelligenceSettings"
		);
		let result = useProjectIntelligenceSettings(null);
		await result.saveSecurityIntelligence();
		await result.saveProjectExploration();

		mockReactHooks(settingsState({ 0: null, 4: explorationSettings, 8: [] }));
		mockCommands();
		const module = await import(
			"../src/modules/settings/useProjectIntelligenceSettings"
		);
		result = module.useProjectIntelligenceSettings({ id: "repo-1" } as never);
		expect(result.explorationConfigurationValid).toBe(false);
		await result.saveSecurityIntelligence();
		await result.saveProjectExploration();

		expect(
			commands.saveProjectSecurityIntelligenceSettings,
		).not.toHaveBeenCalled();
		expect(commands.saveProjectExplorationSettings).not.toHaveBeenCalled();
	});

	it("reports save errors from Error and non-Error values", async () => {
		mockReactHooks(
			settingsState({
				0: securitySettings,
				4: explorationSettings,
				8: [enabledServer],
			}),
		);
		mockCommands({
			saveProjectSecurityIntelligenceSettings: vi.fn(async () => {
				throw new Error("security save failed");
			}),
			saveProjectExplorationSettings: vi.fn(async () => {
				throw "exploration save failed";
			}),
		});
		const { useProjectIntelligenceSettings } = await import(
			"../src/modules/settings/useProjectIntelligenceSettings"
		);
		const result = useProjectIntelligenceSettings({ id: "repo-1" } as never);
		await result.saveSecurityIntelligence();
		await result.saveProjectExploration();

		expect(stateSetters[1]).toHaveBeenLastCalledWith("security save failed");
		expect(stateSetters[2]).toHaveBeenLastCalledWith("error");
		expect(stateSetters[5]).toHaveBeenLastCalledWith("exploration save failed");
		expect(stateSetters[6]).toHaveBeenLastCalledWith("error");
		expect(stateSetters[3]).toHaveBeenLastCalledWith(false);
		expect(stateSetters[7]).toHaveBeenLastCalledWith(false);
	});

	it("does not apply a save after the active repository changes", async () => {
		let resolveSecurity!: (value: Response) => void;
		let resolveExploration!: (value: Response) => void;
		mockReactHooks(
			settingsState({
				0: securitySettings,
				4: explorationSettings,
				8: [enabledServer],
			}),
		);
		mockCommands({
			saveProjectSecurityIntelligenceSettings: vi.fn(
				() => new Promise<Response>((resolve) => (resolveSecurity = resolve)),
			),
			saveProjectExplorationSettings: vi.fn(
				() =>
					new Promise<Response>((resolve) => (resolveExploration = resolve)),
			),
		});
		const { useProjectIntelligenceSettings } = await import(
			"../src/modules/settings/useProjectIntelligenceSettings"
		);
		const result = useProjectIntelligenceSettings({ id: "repo-1" } as never);
		const securitySave = result.saveSecurityIntelligence();
		const explorationSave = result.saveProjectExploration();
		refs[0].current = "repo-2";
		resolveSecurity(jsonResponse(savedSecuritySettings));
		resolveExploration(jsonResponse(savedExplorationSettings));
		await Promise.all([securitySave, explorationSave]);

		expect(stateSetters[0]).not.toHaveBeenCalledWith(savedSecuritySettings);
		expect(stateSetters[4]).not.toHaveBeenCalledWith(savedExplorationSettings);
		expect(stateSetters[3]).not.toHaveBeenCalledWith(false);
		expect(stateSetters[7]).not.toHaveBeenCalledWith(false);
	});
});
