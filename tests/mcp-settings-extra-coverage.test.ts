import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
	const state: { value: unknown } = { value: null };
	return {
		archiveLegacySettingsFile: vi.fn(async () => undefined),
		existsSync: vi.fn(() => false),
		readApplicationSetting: vi.fn(() => state.value),
		readFileSync: vi.fn(() => ""),
		state,
		writeApplicationSetting: vi.fn(async (_scope: string, value: unknown) => {
			state.value = value;
			return value;
		}),
	};
});

vi.mock("node:fs", () => ({
	default: {
		existsSync: mocks.existsSync,
		readFileSync: mocks.readFileSync,
	},
	existsSync: mocks.existsSync,
	readFileSync: mocks.readFileSync,
}));
vi.mock("../api/runtime/paths", () => ({
	getRuntimePaths: () => ({ settingsDir: "/runtime/settings" }),
}));
vi.mock("../api/services/settings/application-settings-store", () => ({
	archiveLegacySettingsFile: mocks.archiveLegacySettingsFile,
	readApplicationSetting: mocks.readApplicationSetting,
	writeApplicationSetting: mocks.writeApplicationSetting,
}));

import type { McpServerConfig } from "../api/services/mcp/mcp-config-schema";
import {
	createMcpServer,
	deleteMcpServer,
	getMcpServer,
	importMcpServersFromText,
	inputFromRawMcpServer,
	listMcpServers,
	parseMcpServerPaste,
	readMcpServerSettings,
	updateMcpServer,
	updateMcpServerStatus,
} from "../api/services/mcp/mcp-settings";

function persistedServer(
	overrides: Partial<McpServerConfig> = {},
): McpServerConfig {
	return {
		id: "00000000-0000-4000-8000-000000000001",
		name: "Local server",
		enabled: true,
		transport: "stdio",
		command: "node",
		args: ["server.js"],
		env: {},
		toolPrefix: "local_server",
		createdAt: "2026-08-09T00:00:00.000Z",
		updatedAt: "2026-08-09T00:00:00.000Z",
		...overrides,
	};
}

describe("MCP settings extra coverage", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.state.value = null;
		mocks.existsSync.mockReturnValue(false);
		mocks.readFileSync.mockReturnValue("");
		mocks.readApplicationSetting.mockImplementation(() => mocks.state.value);
		mocks.writeApplicationSetting.mockImplementation(
			async (_scope: string, value: unknown) => {
				mocks.state.value = value;
				return value;
			},
		);
	});

	it("reads SQLite settings and diagnoses non-object, missing, and invalid servers", () => {
		mocks.state.value = "not-an-object";
		expect(readMcpServerSettings()).toEqual({
			servers: [],
			diagnostics: [
				{
					level: "error",
					message: "MCP settings file must contain a JSON object.",
				},
			],
		});

		mocks.state.value = { servers: "not-an-array" };
		expect(readMcpServerSettings()).toEqual({
			servers: [],
			diagnostics: [
				{
					level: "warning",
					message: "MCP settings file does not contain a servers array.",
					path: "servers",
				},
			],
		});

		const valid = persistedServer();
		mocks.state.value = {
			servers: [valid, { id: "bad-id", name: "broken" }],
		};
		const mixed = readMcpServerSettings();
		expect(mixed.servers).toEqual([valid]);
		expect(mixed.diagnostics).toEqual([
			expect.objectContaining({
				level: "error",
				path: "servers",
				index: 1,
				message: expect.stringContaining("Invalid MCP server entry"),
			}),
		]);
	});

	it("returns empty settings when neither SQLite nor a legacy file exists", () => {
		expect(readMcpServerSettings()).toEqual({ servers: [] });
		expect(mocks.existsSync).toHaveBeenCalledWith(
			"/runtime/settings/mcp-servers.json",
		);
		expect(listMcpServers()).toEqual([]);
		expect(getMcpServer("missing")).toBeNull();
	});

	it("reads and archives a valid legacy file after migrating it", async () => {
		const server = persistedServer();
		mocks.existsSync.mockReturnValue(true);
		mocks.readFileSync.mockReturnValue(JSON.stringify({ servers: [server] }));

		expect(readMcpServerSettings()).toEqual({
			servers: [server],
			diagnostics: [],
		});
		await Promise.resolve();
		await Promise.resolve();
		expect(mocks.writeApplicationSetting).toHaveBeenCalledWith("mcp", {
			servers: [server],
			diagnostics: [],
		});
		expect(mocks.archiveLegacySettingsFile).toHaveBeenCalledWith(
			"/runtime/settings/mcp-servers.json",
		);

		mocks.state.value = null;
		mocks.archiveLegacySettingsFile.mockClear();
		mocks.writeApplicationSetting.mockRejectedValueOnce(
			new Error("store down"),
		);
		readMcpServerSettings();
		await Promise.resolve();
		await Promise.resolve();
		expect(mocks.archiveLegacySettingsFile).not.toHaveBeenCalled();
	});

	it("returns readable diagnostics for legacy JSON and file read failures", () => {
		mocks.existsSync.mockReturnValue(true);
		mocks.readFileSync.mockReturnValueOnce("{bad json");
		expect(readMcpServerSettings()).toMatchObject({
			servers: [],
			diagnostics: [
				{
					level: "error",
					message: expect.stringContaining("Failed to read MCP settings:"),
					path: "/runtime/settings/mcp-servers.json",
				},
			],
		});

		mocks.readFileSync.mockImplementationOnce(() => {
			throw "non-error failure";
		});
		expect(readMcpServerSettings()).toMatchObject({
			diagnostics: [
				{
					message: "Failed to read MCP settings: non-error failure",
				},
			],
		});

		mocks.readApplicationSetting.mockImplementationOnce(() => {
			throw new Error("SQLite unavailable");
		});
		expect(() => readMcpServerSettings()).toThrow("SQLite unavailable");
	});

	it("normalizes raw stdio fields, defaults, args, and environment values", () => {
		expect(
			inputFromRawMcpServer("9 Fancy---Server___", {
				name: "  Explicit Name  ",
				type: "STDIO",
				command: "node",
				args: [1, true, "arg"],
				cwd: "/workspace",
				enabled: false,
				env: { PORT: 3000, DEBUG: true },
			}),
		).toEqual({
			name: "Explicit Name",
			enabled: false,
			transport: "stdio",
			command: "node",
			args: ["1", "true", "arg"],
			cwd: "/workspace",
			env: { PORT: "3000", DEBUG: "true" },
			toolPrefix: "mcp_9_fancy_server",
		});

		expect(
			inputFromRawMcpServer("Simple Server", {
				name: " ",
				command: "bun",
				args: "not-array",
				env: [],
				url: 5,
				cwd: false,
			}),
		).toEqual({
			name: "Simple Server",
			enabled: true,
			transport: "stdio",
			command: "bun",
			args: [],
			env: {},
			toolPrefix: "simple_server",
		});
	});

	it.each([
		"streamable_http",
		"streamable-http",
		"http",
		"https",
	])("maps %s to streamable HTTP", (transport) => {
		expect(
			inputFromRawMcpServer(`server-${transport}`, {
				transport,
				url: "https://example.com/mcp",
			}),
		).toMatchObject({ transport: "streamable_http" });
	});

	it("handles sse and inferred transports and rejects invalid raw/auth configs", () => {
		expect(
			inputFromRawMcpServer("events", {
				transport: "sse",
				url: "http://localhost:4000/events",
			}),
		).toMatchObject({ transport: "sse", enabled: true });
		expect(
			inputFromRawMcpServer("inferred-command", { command: "node" }),
		).toMatchObject({ transport: "stdio" });
		expect(
			inputFromRawMcpServer("inferred-url", {
				url: "https://example.com/mcp",
			}),
		).toMatchObject({ transport: "streamable_http" });

		for (const invalid of [null, "text", []]) {
			expect(() => inputFromRawMcpServer("invalid", invalid)).toThrow(
				"Invalid MCP server config",
			);
		}
		expect(() => inputFromRawMcpServer("unknown", {})).toThrow(
			"transport could not be inferred",
		);
		expect(() =>
			inputFromRawMcpServer("auth", {
				command: "node",
				Authorization: "Bearer redacted",
			}),
		).toThrow("Authenticated MCP server settings are not supported yet");

		const inheritedHeaders = Object.create({
			headers: { "X-Test": "value" },
		}) as Record<string, unknown>;
		inheritedHeaders.command = "node";
		expect(() => inputFromRawMcpServer("headers", inheritedHeaders)).toThrow(
			"Authenticated MCP headers are not supported yet",
		);
	});

	it("parses every supported paste envelope and invalid JSON/value shapes", () => {
		expect(
			parseMcpServerPaste(
				JSON.stringify([
					{ command: "node" },
					{ url: "https://example.com/mcp" },
				]),
			),
		).toMatchObject([
			{ name: "server_1", toolPrefix: "server_1" },
			{ name: "server_2", toolPrefix: "server_2" },
		]);
		expect(
			parseMcpServerPaste(
				JSON.stringify({ mcpServers: { docs: { command: "node" } } }),
			),
		).toMatchObject([{ name: "docs", toolPrefix: "docs" }]);
		expect(
			parseMcpServerPaste(JSON.stringify({ servers: [{ command: "node" }] })),
		).toMatchObject([{ name: "server_1" }]);
		expect(
			parseMcpServerPaste(JSON.stringify({ server: { command: "node" } })),
		).toMatchObject([{ name: "server" }]);
		expect(
			parseMcpServerPaste(
				JSON.stringify({ name: "root", command: "node", toolPrefix: "root" }),
			),
		).toMatchObject([{ name: "root" }]);

		expect(() => parseMcpServerPaste("{bad")).toThrow(
			"MCP config paste must be valid JSON",
		);
		expect(() => parseMcpServerPaste("null")).toThrow(
			"must be a JSON object or array",
		);
		expect(() => parseMcpServerPaste("1")).toThrow(
			"must be a JSON object or array",
		);

		const parseSpy = vi.spyOn(JSON, "parse").mockImplementationOnce(() => {
			throw "non-error JSON failure";
		});
		expect(() => parseMcpServerPaste("{}"), "non-Error parse failure").toThrow(
			"MCP config paste must be valid JSON",
		);
		parseSpy.mockRestore();
	});

	it("creates, lists, retrieves, rejects duplicates, and propagates store errors", async () => {
		const created = await createMcpServer({
			name: "Created",
			enabled: true,
			transport: "stdio",
			command: "node",
			args: [],
			env: {},
			toolPrefix: "created",
		});
		expect(created.id).toEqual(expect.any(String));
		expect(created.createdAt).toBe(created.updatedAt);
		expect(listMcpServers()).toEqual([created]);
		expect(getMcpServer(created.id)).toEqual(created);

		await expect(
			createMcpServer({
				name: "Duplicate",
				enabled: true,
				transport: "stdio",
				command: "node",
				toolPrefix: "created",
			}),
		).rejects.toThrow("MCP toolPrefix already exists: created");

		mocks.state.value = { servers: [] };
		mocks.writeApplicationSetting.mockRejectedValueOnce(
			new Error("store write failed"),
		);
		await expect(
			createMcpServer({
				name: "Store failure",
				enabled: true,
				transport: "stdio",
				command: "node",
				toolPrefix: "store_failure",
			}),
		).rejects.toThrow("store write failed");
	});

	it("imports atomically and rejects empty, pasted, and persisted duplicates", async () => {
		await expect(importMcpServersFromText("[]")).rejects.toThrow(
			"No MCP servers found",
		);
		await expect(
			importMcpServersFromText(
				JSON.stringify([
					{ command: "node", toolPrefix: "same" },
					{ command: "bun", toolPrefix: "same" },
				]),
			),
		).rejects.toThrow("Duplicate MCP toolPrefix in pasted config: same");

		mocks.state.value = { servers: [persistedServer()] };
		await expect(
			importMcpServersFromText(
				JSON.stringify([{ command: "node", toolPrefix: "local_server" }]),
			),
		).rejects.toThrow("MCP toolPrefix already exists: local_server");

		mocks.state.value = { servers: [] };
		const imported = await importMcpServersFromText(
			JSON.stringify([
				{ command: "node", toolPrefix: "first" },
				{
					transport: "sse",
					url: "http://localhost:4100/events",
					toolPrefix: "second",
				},
			]),
		);
		expect(imported).toHaveLength(2);
		expect(imported[0]?.createdAt).toBe(imported[1]?.createdAt);
		expect(mocks.state.value).toMatchObject({
			servers: [
				{ toolPrefix: "first", transport: "stdio" },
				{ toolPrefix: "second", transport: "sse" },
			],
		});
	});

	it("updates every optional field and rejects missing or conflicting servers", async () => {
		const current = persistedServer();
		const other = persistedServer({
			id: "00000000-0000-4000-8000-000000000002",
			toolPrefix: "other",
		});
		mocks.state.value = { servers: [current, other] };
		await expect(updateMcpServer("missing", {})).resolves.toBeNull();

		const unchanged = await updateMcpServer(current.id, {});
		expect(unchanged).toMatchObject({
			name: current.name,
			enabled: current.enabled,
			transport: current.transport,
			command: current.command,
			args: current.args,
			toolPrefix: current.toolPrefix,
		});

		const changed = await updateMcpServer(current.id, {
			name: "Remote changed",
			enabled: false,
			transport: "streamable_http",
			command: "",
			args: ["ignored"],
			url: "https://example.com/mcp",
			cwd: "/new-cwd",
			env: { MODE: "test" },
			toolPrefix: "changed",
		});
		expect(changed).toMatchObject({
			name: "Remote changed",
			enabled: false,
			transport: "streamable_http",
			args: ["ignored"],
			url: "https://example.com/mcp",
			cwd: "/new-cwd",
			env: { MODE: "test" },
			toolPrefix: "changed",
		});

		await expect(
			updateMcpServer(current.id, { toolPrefix: "other" }),
		).rejects.toThrow("MCP toolPrefix already exists: other");
	});

	it("deletes servers and stores optional status updates", async () => {
		const server = persistedServer();
		mocks.state.value = { servers: [server] };
		await expect(deleteMcpServer("missing")).resolves.toBeNull();
		await expect(
			updateMcpServerStatus("missing", undefined),
		).resolves.toBeNull();

		const status = {
			ok: false,
			checkedAt: "2026-08-09T01:00:00.000Z",
			message: "connection failed",
		};
		await expect(
			updateMcpServerStatus(server.id, status),
		).resolves.toMatchObject({
			id: server.id,
			lastStatus: status,
		});
		await expect(deleteMcpServer(server.id)).resolves.toMatchObject({
			id: server.id,
		});
		expect(listMcpServers()).toEqual([]);
	});
});
