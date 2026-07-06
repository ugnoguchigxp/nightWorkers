import crypto from "node:crypto";
import type {
	McpServerConfig,
	McpServerSettingsDiagnostic,
} from "../mcp/mcp-config-schema";
import { mcpServerConfigSchema } from "../mcp/mcp-config-schema";
import { inputFromRawMcpServer } from "../mcp/mcp-settings";
import {
	loadCodexGlobalConfig,
	sanitizeDiagnosticMessage,
} from "./config-loader";

export type EffectiveMcpServerSource = "nightworkers_settings" | "codex_global";

export type EffectiveMcpServer = McpServerConfig & {
	source: EffectiveMcpServerSource;
};

export type CodexGlobalMcpServersResult = {
	servers: EffectiveMcpServer[];
	diagnostics: McpServerSettingsDiagnostic[];
};

export function listCodexGlobalMcpServers(
	projectRoot = process.cwd(),
): CodexGlobalMcpServersResult {
	const loaded = loadCodexGlobalConfig(projectRoot);
	const diagnostics = [...loaded.diagnostics];
	const mcpServers = readMcpServersObject(loaded.config);
	if (!mcpServers) return { servers: [], diagnostics };

	const servers: EffectiveMcpServer[] = [];
	for (const [name, rawServer] of Object.entries(mcpServers)) {
		try {
			const input = inputFromRawMcpServer(name, rawServer);
			const now = new Date(0).toISOString();
			const server = mcpServerConfigSchema.parse({
				...input,
				id: deterministicUuid(`codex_global:mcp:${name}`),
				createdAt: now,
				updatedAt: now,
			});
			servers.push({ ...server, source: "codex_global" });
		} catch (err) {
			diagnostics.push({
				level: "warning",
				path: `mcp_servers.${name}`,
				message: `Skipped Codex global MCP server ${name}: ${sanitizeDiagnosticMessage(
					err instanceof Error ? err.message : String(err),
				)}`,
			});
		}
	}

	return { servers, diagnostics };
}

function readMcpServersObject(
	config: Record<string, unknown>,
): Record<string, unknown> | null {
	const snake = config.mcp_servers;
	if (snake && typeof snake === "object" && !Array.isArray(snake)) {
		return snake as Record<string, unknown>;
	}
	const camel = config.mcpServers;
	if (camel && typeof camel === "object" && !Array.isArray(camel)) {
		return camel as Record<string, unknown>;
	}
	return null;
}

export function deterministicUuid(seed: string): string {
	const bytes = crypto
		.createHash("sha256")
		.update(seed)
		.digest()
		.subarray(0, 16);
	bytes[6] = (bytes[6] & 0x0f) | 0x50;
	bytes[8] = (bytes[8] & 0x3f) | 0x80;
	const hex = bytes.toString("hex");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(
		16,
		20,
	)}-${hex.slice(20)}`;
}
