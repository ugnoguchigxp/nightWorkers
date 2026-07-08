import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../src/i18n/setup";
import { SettingsHooksPanel } from "../src/modules/hooks/SettingsHooksPanel";
import { SettingsMcpPanel } from "../src/modules/mcp/SettingsMcpPanel";
import type {
	AgentHookConfig,
	GeneralSettings,
	McpServerConfig,
	Repository,
	TestQualitySettings,
} from "../src/modules/nightworkers/types";
import { GeneralSettingsPanel } from "../src/modules/settings/SettingsGeneralPanel";
import { SettingsPlanModePanel } from "../src/modules/settings/SettingsPlanModePanel";
import { SettingsTestPanel } from "../src/modules/settings/SettingsTestPanel";

let mockMcpServers: McpServerConfig[] = [];
let mockAgentHooks: AgentHookConfig[] = [];

vi.mock("../src/modules/mcp/useMcpSettings", () => ({
	useMcpSettings: () => ({
		mcpServers: mockMcpServers,
		createMcpServer: vi.fn(),
		importMcpServers: vi.fn(),
		updateMcpServer: vi.fn(),
		deleteMcpServer: vi.fn(),
		testMcpServer: vi.fn(),
	}),
}));

vi.mock("../src/modules/hooks/useAgentHooks", () => ({
	useAgentHooks: () => ({
		agentHooks: mockAgentHooks,
		createAgentHook: vi.fn(),
		updateAgentHook: vi.fn(),
		deleteAgentHook: vi.fn(),
		testAgentHook: vi.fn(),
	}),
}));

const generalSettings: GeneralSettings = {
	timezone: "Asia/Tokyo",
	language: "ja",
	currency: "JPY",
	fx: {
		source: "ecb",
		autoRefresh: true,
		lastRefreshedAt: "2026-07-08T00:00:00Z",
	},
	planMode: {
		capabilities: {
			feature_plan: true,
			questionnaire: true,
			user_flow: true,
			blueprint: true,
			data_model: true,
			api_io_contract: true,
			activity_flow: true,
			sequence_flow: true,
			zod_schema_design: true,
		},
	},
	llmUsage: {
		promptPartObservabilityEnabled: true,
	},
};

const testQualitySettings: TestQualitySettings = {
	coverageGateEnabled: true,
	coverageMinimumPercent: 80,
	coverageMaxIterations: 5,
};

const activeProject: Repository = {
	id: "repo-1",
	name: "NightWorkers",
	localPath: "/tmp/nightworkers",
	createdAt: "2026-07-08T00:00:00Z",
	updatedAt: "2026-07-08T00:00:00Z",
};

describe("settings panels", () => {
	afterEach(() => {
		mockMcpServers = [];
		mockAgentHooks = [];
	});

	it("renders MCP settings with configured servers and the import form", () => {
		mockMcpServers = [
			{
				id: "mcp-1",
				name: "Docs MCP",
				enabled: true,
				transport: "stdio",
				command: "node",
				args: ["server.js"],
				cwd: "/tmp/docs",
				env: { DOCS_ROOT: "/tmp/docs" },
				toolPrefix: "docs",
				createdAt: "2026-07-08T00:00:00Z",
				updatedAt: "2026-07-08T00:00:00Z",
				lastStatus: {
					ok: true,
					checkedAt: "2026-07-08T00:00:00Z",
					message: "2 tools",
					toolCount: 2,
				},
			},
		];

		const markup = renderToStaticMarkup(<SettingsMcpPanel />);

		expect(markup).toContain("Docs MCP");
		expect(markup).toContain("docs");
		expect(markup).toContain("mcp-name");
		expect(markup).toContain("mcp-env");
	});

	it("renders MCP empty state when no servers exist", () => {
		const markup = renderToStaticMarkup(<SettingsMcpPanel />);

		expect(markup).toContain("mcp-name");
		expect(markup).toContain("mcp-transport");
	});

	it("renders hook settings with configured command hooks", () => {
		mockAgentHooks = [
			{
				id: "hook-1",
				name: "Format Hook",
				enabled: true,
				event: "PreToolUse",
				matcher: "apply_patch",
				handler: {
					type: "command",
					command: "bun",
					args: ["format"],
					cwd: "/tmp/nightworkers",
					env: { CI: "1" },
					timeoutSeconds: 30,
				},
				createdAt: "2026-07-08T00:00:00Z",
				updatedAt: "2026-07-08T00:00:00Z",
				lastRun: {
					ok: true,
					checkedAt: "2026-07-08T00:00:00Z",
					message: "ok",
					durationMs: 25,
				},
			},
		];

		const markup = renderToStaticMarkup(<SettingsHooksPanel />);

		expect(markup).toContain("Format Hook");
		expect(markup).toContain("apply_patch");
		expect(markup).toContain("hook-command");
		expect(markup).toContain("hook-env");
	});

	it("renders general, plan-mode, and test quality panels", () => {
		const generalMarkup = renderToStaticMarkup(
			<GeneralSettingsPanel
				value={generalSettings}
				message="saved"
				messageStatus="success"
				isRefreshingFx={false}
				onChange={() => undefined}
				onSave={() => undefined}
				onRefreshFx={() => undefined}
			/>,
		);
		const planModeMarkup = renderToStaticMarkup(
			<SettingsPlanModePanel
				value={generalSettings}
				message="failed"
				messageStatus="error"
				onChange={() => undefined}
				onSave={() => undefined}
			/>,
		);
		const testMarkup = renderToStaticMarkup(
			<SettingsTestPanel
				activeProject={activeProject}
				value={testQualitySettings}
				message="coverage saved"
				messageStatus="success"
				isSaving={false}
				onChange={() => undefined}
				onSave={() => undefined}
			/>,
		);

		expect(generalMarkup).toContain("Asia/Tokyo");
		expect(generalMarkup).toContain("saved");
		expect(planModeMarkup).toContain("failed");
		expect(testMarkup).toContain("NightWorkers");
		expect(testMarkup).toContain("coverage saved");
	});
});
