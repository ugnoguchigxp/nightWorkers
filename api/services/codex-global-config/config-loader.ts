import fs from "node:fs";
import path from "node:path";
import { parse as parseToml } from "smol-toml";
import type { McpServerSettingsDiagnostic } from "../mcp/mcp-config-schema";
import { getCodexGlobalAgentsPath, getCodexGlobalConfigPath } from "./paths";

export type CodexGlobalConfig = {
	configPath: string;
	agentsPath: string;
	config: Record<string, unknown>;
	globalAgentsText: string | null;
	projectAgentsText: string | null;
	diagnostics: McpServerSettingsDiagnostic[];
};

export function loadCodexGlobalConfig(
	projectRoot = process.cwd(),
): CodexGlobalConfig {
	const diagnostics: McpServerSettingsDiagnostic[] = [];
	const configPath = getCodexGlobalConfigPath();
	const agentsPath = getCodexGlobalAgentsPath();
	const config = readTomlConfig(configPath, diagnostics);
	const globalAgentsText = readOptionalText(agentsPath, diagnostics);
	const projectAgentsText = readProjectAgentsText(projectRoot, diagnostics);

	return {
		configPath,
		agentsPath,
		config,
		globalAgentsText,
		projectAgentsText,
		diagnostics,
	};
}

function readTomlConfig(
	filePath: string,
	diagnostics: McpServerSettingsDiagnostic[],
): Record<string, unknown> {
	if (!fs.existsSync(filePath)) return {};
	try {
		const parsed = parseToml(fs.readFileSync(filePath, "utf-8"));
		return parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: {};
	} catch (err) {
		diagnostics.push({
			level: "warning",
			path: filePath,
			message: `Failed to parse Codex global config: ${sanitizeDiagnosticMessage(
				err instanceof Error ? err.message : String(err),
			)}`,
		});
		return {};
	}
}

function readProjectAgentsText(
	projectRoot: string,
	diagnostics: McpServerSettingsDiagnostic[],
): string | null {
	for (const fileName of ["AGENTS.md", "AGENT.md"]) {
		const filePath = path.join(projectRoot, fileName);
		const text = readOptionalText(filePath, diagnostics);
		if (text !== null) return text;
	}
	return null;
}

function readOptionalText(
	filePath: string,
	diagnostics: McpServerSettingsDiagnostic[],
): string | null {
	try {
		if (!fs.existsSync(filePath)) return null;
		return fs.readFileSync(filePath, "utf-8");
	} catch (err) {
		diagnostics.push({
			level: "warning",
			path: filePath,
			message: `Failed to read Codex guidance file: ${sanitizeDiagnosticMessage(
				err instanceof Error ? err.message : String(err),
			)}`,
		});
		return null;
	}
}

export function sanitizeDiagnosticMessage(message: string): string {
	return message.replace(
		/(?:api[_-]?key|token|password|secret|authorization|bearer)\s*[:=]\s*['"]?[^\s'"]+/gi,
		"[redacted]",
	);
}
