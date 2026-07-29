import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";

export type NightWorkersRuntimePaths = {
	runtimeRoot: string;
	databasePath: string;
	settingsDir: string;
	logsDir: string;
	secretsDir: string;
	artifactsDir: string;
	backupsDir: string;
	workspaceBootstrapDir: string;
	workspaceBootstrapTmpDir: string;
	workspaceBootstrapCacheDir: string;
	workspaceBootstrapEnvironmentsDir: string;
	workspaceBootstrapLogsDir: string;
};

export function isDesktopMode(env: NodeJS.ProcessEnv = process.env): boolean {
	return (
		env.NIGHTWORKERS_DESKTOP === "1" || env.NIGHTWORKERS_DESKTOP === "true"
	);
}

export function getRuntimeRoot(env: NodeJS.ProcessEnv = process.env): string {
	if (env.NIGHTWORKERS_RUNTIME_DIR?.trim()) {
		return path.resolve(env.NIGHTWORKERS_RUNTIME_DIR);
	}
	if (isDesktopMode(env)) {
		return path.join(getResourceRoot(env), ".nightworkers");
	}
	return path.resolve(process.cwd(), ".nightworkers");
}

export function getRuntimePaths(
	env: NodeJS.ProcessEnv = process.env,
): NightWorkersRuntimePaths {
	const runtimeRoot = getRuntimeRoot(env);
	const settingsDir = path.join(runtimeRoot, "settings");
	const workspaceBootstrapDir = env.NIGHTWORKERS_WORKSPACE_BOOTSTRAP_DIR?.trim()
		? path.resolve(env.NIGHTWORKERS_WORKSPACE_BOOTSTRAP_DIR)
		: env.NIGHTWORKERS_RUNTIME_DIR?.trim() || isDesktopMode(env)
			? path.join(runtimeRoot, "workspace-bootstrap")
			: path.join(
					os.tmpdir(),
					"nightworkers",
					"workspace-bootstrap",
					createHash("sha256")
						.update(path.resolve(process.cwd()))
						.digest("hex")
						.slice(0, 16),
				);
	return {
		runtimeRoot,
		databasePath: path.join(runtimeRoot, "sqlite.db"),
		settingsDir,
		logsDir: path.join(runtimeRoot, "logs"),
		secretsDir: path.join(runtimeRoot, "secrets"),
		artifactsDir: path.join(runtimeRoot, "artifacts"),
		backupsDir: path.join(runtimeRoot, "backups"),
		workspaceBootstrapDir,
		workspaceBootstrapTmpDir: path.join(workspaceBootstrapDir, "tmp"),
		workspaceBootstrapCacheDir: path.join(workspaceBootstrapDir, "cache"),
		workspaceBootstrapEnvironmentsDir: path.join(
			workspaceBootstrapDir,
			"environments",
		),
		workspaceBootstrapLogsDir: path.join(workspaceBootstrapDir, "logs"),
	};
}

export function getResourceRoot(env: NodeJS.ProcessEnv = process.env): string {
	if (env.NIGHTWORKERS_RESOURCE_DIR?.trim()) {
		return path.resolve(env.NIGHTWORKERS_RESOURCE_DIR);
	}
	return path.resolve(process.cwd());
}
