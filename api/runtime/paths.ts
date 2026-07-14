import path from "node:path";

export type NightWorkersRuntimePaths = {
	runtimeRoot: string;
	databasePath: string;
	settingsDir: string;
	logsDir: string;
	secretsDir: string;
	artifactsDir: string;
	backupsDir: string;
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
	return {
		runtimeRoot,
		databasePath: path.join(runtimeRoot, "sqlite.db"),
		settingsDir,
		logsDir: path.join(runtimeRoot, "logs"),
		secretsDir: path.join(runtimeRoot, "secrets"),
		artifactsDir: path.join(runtimeRoot, "artifacts"),
		backupsDir: path.join(runtimeRoot, "backups"),
	};
}

export function getResourceRoot(env: NodeJS.ProcessEnv = process.env): string {
	if (env.NIGHTWORKERS_RESOURCE_DIR?.trim()) {
		return path.resolve(env.NIGHTWORKERS_RESOURCE_DIR);
	}
	return path.resolve(process.cwd());
}
