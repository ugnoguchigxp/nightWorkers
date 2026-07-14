import { describe, expect, it, vi } from "vitest";

let stateValues: unknown[] = [];

function mockReactState(values: unknown[]) {
	stateValues = [...values];
	vi.resetModules();
	vi.doMock("react", async () => {
		const actual = await vi.importActual<typeof import("react")>("react");
		return {
			...actual,
			useState: <T,>(initial: T | (() => T)) => {
				const value =
					stateValues.length > 0
						? (stateValues.shift() as T)
						: typeof initial === "function"
							? (initial as () => T)()
							: initial;
				const setter = vi.fn((next: T | ((previous: T) => T)) => {
					if (typeof next === "function") (next as (previous: T) => T)(value);
				});
				return [value, setter] as const;
			},
		};
	});
	vi.doMock("react-i18next", async () => ({
		...(await vi.importActual<typeof import("react-i18next")>("react-i18next")),
		useTranslation: () => ({ t: (key: string) => key }),
	}));
}

async function triggerTreeHandlers(element: unknown) {
	const seen = new Set<unknown>();
	const visit = async (node: unknown) => {
		if (!node || typeof node !== "object" || seen.has(node)) return;
		seen.add(node);
		if (Array.isArray(node)) {
			for (const child of node) await visit(child);
			return;
		}
		const props = (node as { props?: Record<string, unknown> }).props;
		const type = (node as { type?: unknown }).type;
		if (props) {
			if (typeof props.onSave === "function") {
				await props.onSave();
			}
			if (typeof props.onClick === "function") {
				await props.onClick({
					preventDefault: vi.fn(),
					currentTarget: { checked: true, value: "clicked" },
					target: { checked: true, value: "clicked" },
				});
			}
			if (typeof props.onChange === "function") {
				const isHostInput = type === "input" || type === "textarea";
				await props.onChange(
					isHostInput
						? {
								currentTarget: { checked: true, value: "changed" },
								target: { checked: true, value: "changed" },
							}
						: "changed",
				);
			}
			await visit(props.children);
		}
	};
	await visit(element);
}

function mcpServerFixture() {
	return {
		id: "mcp-1",
		name: "Local MCP",
		enabled: true,
		transport: "stdio" as const,
		command: "node",
		args: ["server.js"],
		url: "",
		cwd: "/tmp",
		env: { NODE_ENV: "test" },
		toolPrefix: "local",
		lastStatus: { ok: true, message: "ready", checkedAt: "2026-07-08" },
		createdAt: "2026-07-08T00:00:00.000Z",
		updatedAt: "2026-07-08T00:00:00.000Z",
	};
}

function agentHookFixture() {
	return {
		id: "hook-1",
		name: "Pre tool guard",
		enabled: true,
		event: "PreToolUse" as const,
		matcher: "bash",
		handler: {
			type: "command" as const,
			command: "node",
			args: ["hook.js"],
			cwd: "/tmp",
			env: { NODE_ENV: "test" },
			timeoutSeconds: 20,
			failClosed: true,
		},
		lastRun: { ok: true, message: "allowed", ranAt: "2026-07-08" },
		createdAt: "2026-07-08T00:00:00.000Z",
		updatedAt: "2026-07-08T00:00:00.000Z",
	};
}

describe("settings panel action coverage", () => {
	it("exercises MCP panel save/import/toggle/test/delete handlers", async () => {
		const server = mcpServerFixture();
		const mcpSettings = {
			mcpServers: [server],
			createMcpServer: vi.fn(async () => ({ ...server, id: "mcp-created" })),
			updateMcpServer: vi.fn(async (_id: string, input: object) => ({
				...server,
				...input,
			})),
			deleteMcpServer: vi.fn(async () => undefined),
			testMcpServer: vi.fn(async () => ({ ok: true, message: "ok" })),
			importMcpServers: vi.fn(async () => ({
				servers: [server],
				results: [{ ok: true, message: "ok" }],
			})),
		};
		mockReactState([
			{
				id: server.id,
				name: server.name,
				enabled: true,
				transport: "stdio",
				command: "node",
				argsText: "server.js",
				url: "",
				cwd: "/tmp",
				envText: "NODE_ENV=test",
				toolPrefix: "local",
			},
			'{"mcpServers":{"local":{"command":"node","args":["server.js"]}}}',
			"",
			"idle",
			false,
		]);
		vi.doMock("../src/modules/mcp/useMcpSettings", () => ({
			useMcpSettings: () => mcpSettings,
		}));
		const { SettingsMcpPanel } = await import(
			"../src/modules/mcp/SettingsMcpPanel"
		);

		await triggerTreeHandlers(SettingsMcpPanel());

		expect(mcpSettings.updateMcpServer).toHaveBeenCalled();
		expect(mcpSettings.testMcpServer).toHaveBeenCalled();
		expect(mcpSettings.importMcpServers).toHaveBeenCalled();
		expect(mcpSettings.deleteMcpServer).toHaveBeenCalledWith(server.id);
	});

	it("exercises Agent Hook panel save/test/delete handlers", async () => {
		const hook = agentHookFixture();
		const agentHooks = {
			agentHooks: [hook],
			createAgentHook: vi.fn(async () => ({ ...hook, id: "hook-created" })),
			updateAgentHook: vi.fn(async () => hook),
			deleteAgentHook: vi.fn(async () => undefined),
			testAgentHook: vi.fn(async () => ({ ok: false, message: "blocked" })),
		};
		mockReactState([
			{
				id: hook.id,
				name: hook.name,
				enabled: true,
				event: "PreToolUse",
				matcher: "bash",
				handlerType: "command",
				command: "node",
				argsText: "hook.js",
				cwd: "/tmp",
				envText: "NODE_ENV=test",
				url: "",
				headersText: "",
				timeoutSeconds: 20,
				failClosed: true,
			},
			"",
			"idle",
			false,
		]);
		vi.doMock("../src/modules/hooks/useAgentHooks", () => ({
			useAgentHooks: () => agentHooks,
		}));
		const { SettingsHooksPanel } = await import(
			"../src/modules/hooks/SettingsHooksPanel"
		);

		await triggerTreeHandlers(SettingsHooksPanel());

		expect(agentHooks.updateAgentHook).toHaveBeenCalled();
		expect(agentHooks.testAgentHook).toHaveBeenCalledWith(hook.id);
		expect(agentHooks.deleteAgentHook).toHaveBeenCalledWith(hook.id);
	});
});
