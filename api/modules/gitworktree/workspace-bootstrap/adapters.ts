import path from "node:path";
import type {
	WorkspaceBootstrapAdapterId,
	WorkspaceBootstrapCommand,
	WorkspaceBootstrapComponent,
} from "./types";

export function buildWorkspaceBootstrapCommands(input: {
	component: WorkspaceBootstrapComponent;
	componentRoot: string;
	tmpDir: string;
	cacheDir: string;
	environmentDir: string;
	baseEnv: NodeJS.ProcessEnv;
}): WorkspaceBootstrapCommand[] {
	const commonEnv = compactEnv({
		...input.baseEnv,
		TMPDIR: input.tmpDir,
		TMP: input.tmpDir,
		TEMP: input.tmpDir,
	});
	const withEnv = (env: Record<string, string | undefined>) => ({
		...commonEnv,
		...compactEnv(env),
	});
	switch (input.component.adapterId) {
		case "bun":
			return [
				command(
					"bun",
					["install", "--frozen-lockfile"],
					withEnv({
						BUN_INSTALL_CACHE_DIR: input.cacheDir,
					}),
				),
			];
		case "npm":
			return [
				command("npm", ["ci"], withEnv({ npm_config_cache: input.cacheDir })),
			];
		case "pnpm":
			return [
				command(
					"pnpm",
					["install", "--frozen-lockfile", "--store-dir", input.cacheDir],
					commonEnv,
				),
			];
		case "yarn":
			return [
				command(
					"yarn",
					["install", "--immutable"],
					withEnv({ YARN_CACHE_FOLDER: input.cacheDir }),
				),
			];
		case "uv":
			return [
				command(
					"uv",
					["sync", "--frozen"],
					withEnv({
						UV_CACHE_DIR: input.cacheDir,
						UV_PROJECT_ENVIRONMENT: input.environmentDir,
					}),
				),
			];
		case "poetry":
			return [
				command(
					"poetry",
					["install", "--sync", "--no-interaction"],
					withEnv({
						POETRY_CACHE_DIR: input.cacheDir,
						POETRY_VIRTUALENVS_PATH: input.environmentDir,
						POETRY_VIRTUALENVS_IN_PROJECT: "false",
					}),
				),
			];
		case "pip": {
			const python = process.platform === "win32" ? "python" : "python3";
			const environmentPython =
				process.platform === "win32"
					? path.join(input.environmentDir, "Scripts", "python.exe")
					: path.join(input.environmentDir, "bin", "python");
			return [
				command(python, ["-m", "venv", input.environmentDir], commonEnv),
				command(
					environmentPython,
					[
						"-m",
						"pip",
						"install",
						"--require-hashes",
						"-r",
						"requirements.lock",
					],
					withEnv({ PIP_CACHE_DIR: input.cacheDir }),
				),
			];
		}
		case "bundler":
			return [
				command(
					"bundle",
					["install"],
					withEnv({
						BUNDLE_PATH: input.environmentDir,
						BUNDLE_FROZEN: "true",
						BUNDLE_CACHE_PATH: input.cacheDir,
					}),
				),
			];
		case "composer":
			return [
				command(
					"composer",
					["install", "--no-interaction", "--no-progress"],
					withEnv({ COMPOSER_CACHE_DIR: input.cacheDir }),
				),
			];
		case "go":
			return [
				command(
					"go",
					["mod", "download"],
					withEnv({
						GOMODCACHE: path.join(input.cacheDir, "modules"),
						GOCACHE: path.join(input.cacheDir, "build"),
					}),
				),
			];
		case "cargo":
			return [
				command(
					"cargo",
					["fetch", "--locked"],
					withEnv({
						CARGO_HOME: input.cacheDir,
						CARGO_TARGET_DIR: input.environmentDir,
					}),
				),
			];
		case "dotnet":
			return [
				command(
					"dotnet",
					["restore", "--locked-mode"],
					withEnv({ NUGET_PACKAGES: input.cacheDir }),
				),
			];
		case "maven":
			return [
				command(
					"mvn",
					[
						"--batch-mode",
						`-Dmaven.repo.local=${input.cacheDir}`,
						"dependency:go-offline",
					],
					commonEnv,
				),
			];
		case "gradle":
			return [
				command(
					path.join(input.componentRoot, "gradlew"),
					["--no-daemon", "dependencies"],
					withEnv({ GRADLE_USER_HOME: input.cacheDir }),
				),
			];
	}
}

export function adapterVersionCommand(
	component: WorkspaceBootstrapComponent,
	componentRoot: string,
) {
	if (component.adapterId === "pip") {
		return {
			executable: process.platform === "win32" ? "python" : "python3",
			args: ["--version"],
		};
	}
	if (component.adapterId === "gradle") {
		return {
			executable: path.join(componentRoot, "gradlew"),
			args: ["--version"],
		};
	}
	const executable =
		(
			{
				bundler: "bundle",
				composer: "composer",
				dotnet: "dotnet",
				maven: "mvn",
			} as Partial<Record<WorkspaceBootstrapAdapterId, string>>
		)[component.adapterId] ?? component.adapterId;
	return { executable, args: ["--version"] };
}

function command(
	executable: string,
	args: string[],
	env: Record<string, string>,
): WorkspaceBootstrapCommand {
	return { executable, args, env };
}

function compactEnv(
	value: NodeJS.ProcessEnv | Record<string, string | undefined>,
) {
	return Object.fromEntries(
		Object.entries(value).filter(
			(entry): entry is [string, string] => typeof entry[1] === "string",
		),
	);
}
