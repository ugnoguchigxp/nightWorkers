import os from "node:os";
import path from "node:path";

export function getCodexGlobalHome(
	env: NodeJS.ProcessEnv = process.env,
): string {
	const configuredHome =
		env.NIGHTWORKERS_CODEX_HOME?.trim() || env.CODEX_HOME?.trim();
	return configuredHome
		? path.resolve(configuredHome)
		: path.join(os.homedir(), ".codex");
}

export function getCodexGlobalConfigPath(): string {
	return path.join(getCodexGlobalHome(), "config.toml");
}

export function getCodexGlobalAgentsPath(): string {
	return path.join(getCodexGlobalHome(), "AGENTS.md");
}
