import { listCodexGlobalMcpServers } from "../codex-global-config/mcp-bridge";
import type {
	McpServerConfig,
	McpServerSettingsDiagnostic,
} from "./mcp-config-schema";
import { listMcpServers, readMcpServerSettings } from "./mcp-settings";

export type EffectiveMcpServer = McpServerConfig & {
	source: "nightworkers_settings" | "codex_global";
};

export type EffectiveMcpServerSettings = {
	servers: EffectiveMcpServer[];
	diagnostics: McpServerSettingsDiagnostic[];
};

export function readEffectiveMcpServerSettings(
	projectRoot = process.cwd(),
): EffectiveMcpServerSettings {
	const localSettings = readMcpServerSettings();
	const localServers: EffectiveMcpServer[] = localSettings.servers.map(
		(server) => ({
			...server,
			source: "nightworkers_settings",
		}),
	);
	const globalSettings = listCodexGlobalMcpServers(projectRoot);
	const diagnostics = [
		...(localSettings.diagnostics || []),
		...globalSettings.diagnostics,
	];
	const usedPrefixes = new Set(localServers.map((server) => server.toolPrefix));
	const usedIds = new Set(localServers.map((server) => server.id));
	const globalServers = globalSettings.servers.flatMap((server) => {
		if (usedPrefixes.has(server.toolPrefix)) {
			diagnostics.push({
				level: "warning",
				path: `mcp_servers.${server.toolPrefix}`,
				message: `Skipped Codex global MCP server ${server.name}: toolPrefix conflicts with NightWorkers settings.`,
			});
			return [];
		}
		if (usedIds.has(server.id)) {
			diagnostics.push({
				level: "warning",
				path: `mcp_servers.${server.toolPrefix}`,
				message: `Skipped Codex global MCP server ${server.name}: generated id conflicts with NightWorkers settings.`,
			});
			return [];
		}
		usedPrefixes.add(server.toolPrefix);
		usedIds.add(server.id);
		return [server satisfies EffectiveMcpServer];
	});

	return {
		servers: [...localServers, ...globalServers],
		diagnostics,
	};
}

export function listEffectiveMcpServers(
	projectRoot = process.cwd(),
): EffectiveMcpServer[] {
	return readEffectiveMcpServerSettings(projectRoot).servers;
}

export function getEffectiveMcpServer(id: string): McpServerConfig | null {
	return listEffectiveMcpServers().find((server) => server.id === id) ?? null;
}

export function getLocalMcpServers(): McpServerConfig[] {
	return listMcpServers();
}
