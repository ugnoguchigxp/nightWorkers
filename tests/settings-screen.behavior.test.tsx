// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultSettings } from "../src/modules/settings/settings-defaults";
import { buttonByLabel, clickDom, flushDom, mountDom } from "./dom-test-utils";

type SettingsMode = "error" | "success";

async function loadSettingsScreen(mode: SettingsMode) {
	vi.resetModules();
	const queryClient = { setQueryData: vi.fn() };
	const retry = vi.fn();
	const saveLlmSettings = vi.fn(
		async (settings: unknown) =>
			new Response(JSON.stringify({ ...defaultSettings, ...settings })),
	);
	let serverSettings = { ...defaultSettings };
	const appearanceSettings = { density: "comfortable" };

	vi.doMock("react-i18next", () => ({
		useTranslation: () => ({ t: (key: string) => key }),
	}));
	vi.doMock("@tanstack/react-query", async () => {
		const actual = await vi.importActual<
			typeof import("@tanstack/react-query")
		>("@tanstack/react-query");
		return {
			...actual,
			useQuery: (options: { queryKey: readonly string[] }) => {
				if (options.queryKey[0] === "llmSettings") {
					return mode === "error"
						? {
								data: undefined,
								isPending: false,
								isError: true,
								error: new Error("LLM settings are unavailable"),
								refetch: retry,
							}
						: {
								data: serverSettings,
								isPending: false,
								isError: false,
								error: null,
								refetch: retry,
							};
				}
				return {
					data: null,
					isPending: false,
					isError: false,
					error: null,
					refetch: vi.fn(),
				};
			},
			useQueryClient: () => queryClient,
		};
	});
	vi.doMock("../src/modules/settings/settingsCommands", () => ({
		fetchLlmSettings: vi.fn(),
		saveLlmSettings,
		fetchLlmModelOptions: vi.fn(),
		fetchCodexSdkStatus: vi.fn(
			async () => new Response(JSON.stringify({ models: [] })),
		),
		testLlmProviderHealth: vi.fn(),
		fetchGeneralSettings: vi.fn(),
		fetchFxRates: vi.fn(),
		refreshFxRates: vi.fn(),
		saveGeneralSettings: vi.fn(),
	}));
	vi.doMock("../src/i18n/I18nProvider", () => ({
		applyAppLanguage: vi.fn(),
	}));
	vi.doMock("../src/modules/settings/useProjectIntelligenceSettings", () => ({
		useProjectIntelligenceSettings: () => ({
			securityIntelligence: null,
			securityMessage: "",
			securityMessageStatus: "idle",
			securityBusy: false,
			changeSecurityIntelligence: vi.fn(),
			saveSecurityIntelligence: vi.fn(),
			projectExploration: null,
			explorationMessage: "",
			explorationMessageStatus: "idle",
			explorationBusy: false,
			mcpServers: [],
			explorationConfigurationValid: true,
			changeProjectExploration: vi.fn(),
			saveProjectExploration: vi.fn(),
		}),
	}));
	vi.doMock(
		"../src/modules/nightworkers/contexts/WorkspaceAppearanceContext",
		() => ({
			useWorkspaceAppearanceState: () => ({
				settings: appearanceSettings,
				savedSettings: appearanceSettings,
			}),
			useWorkspaceAppearanceActions: () => ({
				applyAppearanceSettings: vi.fn(),
				saveAppearanceSettings: vi.fn(),
			}),
		}),
	);
	vi.doMock("../src/modules/blueprint-preview", () => ({
		AppearanceSettings: () => null,
		createBlueprintPreviewDesignSettings: vi.fn(),
	}));
	vi.doMock("../src/modules/nightworkers/routing/workbench-link-click", () => ({
		handleWorkbenchAnchorClick: vi.fn(),
	}));
	vi.doMock(
		"../src/modules/nightworkers/routing/workbench-route-state",
		() => ({ serializeWorkbenchRoute: () => "/settings" }),
	);

	const { SettingsScreen } = await import(
		"../src/modules/settings/SettingsScreen"
	);
	return {
		SettingsScreen,
		queryClient,
		retry,
		saveLlmSettings,
		setServerSettings(next: typeof serverSettings) {
			serverSettings = next;
		},
	};
}

describe("SettingsScreen behavior", () => {
	afterEach(() => document.body.replaceChildren());

	it("announces the initial query failure and retries it", async () => {
		const module = await loadSettingsScreen("error");
		const screen = await mountDom(
			<module.SettingsScreen activeProject={null} onClose={vi.fn()} />,
		);
		expect(
			screen.container.querySelector('[role="alert"]')?.textContent,
		).toContain("LLM settings are unavailable");
		await clickDom(buttonByLabel(screen.container, "common.retry"));
		expect(module.retry).toHaveBeenCalledOnce();
		await screen.unmount();
	});

	it("keeps a dirty provider draft across a refetch and commits the normalized server snapshot on save", async () => {
		const module = await loadSettingsScreen("success");
		const screen = await mountDom(
			<module.SettingsScreen
				activeProject={null}
				activeSection="llm-providers"
				onClose={vi.fn()}
			/>,
		);
		await flushDom();
		await clickDom(
			buttonByLabel(screen.container, "settings.llm.endpoint.add"),
		);
		expect(
			screen.container.querySelector('input[value="Local LLM"]'),
		).not.toBeNull();

		module.setServerSettings({ ...defaultSettings, providerEndpoints: [] });
		await screen.rerender(
			<module.SettingsScreen
				activeProject={null}
				activeSection="llm-providers"
				onClose={vi.fn()}
			/>,
		);
		expect(
			screen.container.querySelector('input[value="Local LLM"]'),
		).not.toBeNull();

		await clickDom(buttonByLabel(screen.container, "settings.saveAll"));
		await flushDom();
		expect(module.saveLlmSettings).toHaveBeenCalledWith(
			expect.objectContaining({
				providerEndpoints: [expect.objectContaining({ name: "Local LLM" })],
			}),
		);
		expect(module.queryClient.setQueryData).toHaveBeenCalledWith(
			["llmSettings"],
			expect.objectContaining({
				providerEndpoints: [expect.objectContaining({ name: "Local LLM" })],
			}),
		);
		await screen.unmount();
	});
});
