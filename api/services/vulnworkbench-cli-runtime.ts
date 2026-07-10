import { existsSync } from "node:fs";
import path from "node:path";

export const DEFAULT_VULNWORKBENCH_CWD = "/Users/y.noguchi/Code/vulnWorkbench";

export function resolveVulnWorkbenchBunExecutable(
	env: NodeJS.ProcessEnv = process.env,
) {
	const configured = env.NIGHTWORKERS_BUN_EXECUTABLE?.trim();
	if (configured) return configured;
	return path.basename(process.execPath).toLowerCase().startsWith("bun")
		? process.execPath
		: "bun";
}

export function buildVulnWorkbenchCliEnv(
	baseEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = {};
	for (const key of ["PATH", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL"]) {
		if (baseEnv[key]) env[key] = baseEnv[key];
	}
	const entries = [
		...(baseEnv.PATH?.split(path.delimiter).filter(Boolean) ?? []),
		path.dirname(process.execPath),
		"/opt/homebrew/bin",
		"/opt/homebrew/sbin",
		"/usr/local/bin",
		"/usr/bin",
		"/bin",
	];
	env.PATH = [...new Set(entries)].join(path.delimiter);
	return env;
}

export function isVulnWorkbenchCliConfigured(
	env: NodeJS.ProcessEnv = process.env,
) {
	if (env.NIGHTWORKERS_VULNWORKBENCH_ENABLED === "false") return false;
	const cwd = env.NIGHTWORKERS_VULNWORKBENCH_CWD || DEFAULT_VULNWORKBENCH_CWD;
	return (
		existsSync(path.join(cwd, "package.json")) &&
		existsSync(path.join(cwd, "api/cli/oracle-security.ts"))
	);
}
