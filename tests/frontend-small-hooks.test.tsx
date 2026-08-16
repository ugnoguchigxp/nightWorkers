import { describe, expect, it, vi } from "vitest";
import {
	formatCurrency,
	formatDateTime,
	formatTokenCount,
} from "../src/i18n/format";

function jsonResponse(body: unknown, init?: ResponseInit) {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { "content-type": "application/json" },
		...init,
	});
}

describe("frontend small hooks coverage", () => {
	it("formats localized values", () => {
		expect(formatTokenCount(1234567)).toBe("1,234,567");
		expect(formatCurrency(null, "USD", "en")).toBe("N/A");
		expect(formatCurrency(12.34567, "USD", "en")).toContain("$");
		expect(formatCurrency(1234, "JPY", "ja")).toContain("￥");
		expect(formatDateTime(null, "ja", "Asia/Tokyo")).toBe("N/A");
		expect(formatDateTime("2026-07-08T00:00:00Z", "en", "UTC")).toContain("26");
	});

	it("runs LLM settings hook actions", async () => {
		const queryClient = { invalidateQueries: vi.fn(), setQueryData: vi.fn() };
		const llmSettings = {
			ACTIVE_LLM_PROVIDER: "openai",
			OPENAI_ENABLED: true,
			OPENAI_MODEL: "gpt-5",
			AZURE_OPENAI_ENABLED: false,
			AZURE_OPENAI_DEPLOYMENT_NAME: "gpt-5-mini",
			AWS_BEDROCK_ENABLED: false,
			AWS_BEDROCK_MODEL: "claude",
			CODEX_ENABLED: false,
			CODEX_MODEL: "gpt-5-codex",
		};
		vi.resetModules();
		vi.doMock("@tanstack/react-query", () => ({
			queryOptions: <T,>(options: T) => options,
			useQueryClient: () => queryClient,
			useQuery: ({ queryKey }: { queryKey: unknown[] }) => ({
				data:
					queryKey[0] === "llmSettings"
						? llmSettings
						: [{ value: "gpt-5", label: "GPT-5" }],
			}),
		}));
		vi.doMock("../src/modules/settings/settingsCommands", () => ({
			fetchLlmSettings: vi.fn(),
			fetchLlmModelOptions: vi.fn(),
			saveLlmSettings: vi.fn(async () => jsonResponse({ ok: true })),
			runLlmSmokeTest: vi.fn(async () =>
				jsonResponse({ ok: true, provider: "openai", message: "ok" }),
			),
		}));
		const { useLlmSettings } = await import(
			"../src/modules/settings/useLlmSettings"
		);

		const settings = useLlmSettings();
		await settings.setActiveProvider("azure");
		await settings.toggleProviderEnabled("openai", false);
		await settings.updateProviderModel("gpt-5.1");
		await expect(settings.runLlmSmokeTest()).resolves.toMatchObject({
			ok: true,
		});
		expect(queryClient.invalidateQueries).toHaveBeenCalled();
	});

	it("runs MCP and Agent Hook settings hook actions", async () => {
		const queryClient = { invalidateQueries: vi.fn() };
		vi.resetModules();
		vi.doMock("@tanstack/react-query", () => ({
			useQueryClient: () => queryClient,
			useQuery: ({ queryKey }: { queryKey: unknown[] }) => ({
				data:
					queryKey[0] === "mcpServers" ? [{ id: "mcp-1" }] : [{ id: "hook-1" }],
			}),
		}));
		vi.doMock("../src/modules/mcp/mcpCommands", () => ({
			fetchMcpServers: vi.fn(),
			createMcpServer: vi.fn(async () => jsonResponse({ id: "mcp-created" })),
			importMcpServers: vi.fn(async () =>
				jsonResponse({ servers: [{ id: "mcp-imported" }], results: [] }),
			),
			updateMcpServer: vi.fn(async () => jsonResponse({ id: "mcp-1" })),
			deleteMcpServer: vi.fn(async () => jsonResponse({ ok: true })),
			testMcpServer: vi.fn(async () =>
				jsonResponse({ ok: true, message: "ok" }),
			),
		}));
		vi.doMock("../src/modules/hooks/hooksCommands", () => ({
			fetchAgentHooks: vi.fn(),
			createAgentHook: vi.fn(async () => jsonResponse({ id: "hook-created" })),
			updateAgentHook: vi.fn(async () => jsonResponse({ id: "hook-1" })),
			deleteAgentHook: vi.fn(async () => jsonResponse({ ok: true })),
			testAgentHook: vi.fn(async () =>
				jsonResponse({ ok: false, message: "ng" }),
			),
		}));
		const { useMcpSettings } = await import(
			"../src/modules/mcp/useMcpSettings"
		);
		const { useAgentHooks } = await import(
			"../src/modules/hooks/useAgentHooks"
		);

		const mcp = useMcpSettings();
		await mcp.createMcpServer({
			name: "mcp",
			enabled: true,
			transport: "stdio",
			args: [],
			env: {},
			toolPrefix: "mcp",
		});
		await mcp.importMcpServers("{}", false);
		await mcp.updateMcpServer("mcp-1", { enabled: false });
		await mcp.testMcpServer("mcp-1");
		await mcp.deleteMcpServer("mcp-1");
		const hooks = useAgentHooks();
		await hooks.createAgentHook({
			name: "hook",
			enabled: true,
			event: "Stop",
			handler: {
				type: "command",
				command: "true",
				args: [],
				timeoutSeconds: 1,
				failClosed: false,
			},
		});
		await hooks.updateAgentHook("hook-1", { enabled: false });
		await hooks.testAgentHook("hook-1");
		await hooks.deleteAgentHook("hook-1");
		expect(queryClient.invalidateQueries).toHaveBeenCalled();
	});
});
