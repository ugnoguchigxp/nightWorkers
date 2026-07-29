import { createHash } from "node:crypto";
import path from "node:path";
import { getRuntimePaths } from "../../../runtime/paths";
import { assertWorkspaceBootstrapId } from "./path-policy";
import type {
	WorkspaceBootstrapAdapterId,
	WorkspaceDependencyBootstrapEvidence,
} from "./types";

export function buildWorkspaceRuntimeEnvironment(input: {
	workspaceId: string;
	evidence: WorkspaceDependencyBootstrapEvidence;
	baseEnv?: NodeJS.ProcessEnv;
}) {
	assertWorkspaceBootstrapId(input.workspaceId);
	const baseEnv = input.baseEnv ?? process.env;
	const paths = getRuntimePaths(baseEnv);
	const env: Record<string, string> = {};
	if (baseEnv.PATH) env.PATH = baseEnv.PATH;
	const workspaceTmp = path.join(
		paths.workspaceBootstrapTmpDir,
		input.workspaceId,
		"runtime",
	);
	env.TMPDIR = workspaceTmp;
	env.TMP = workspaceTmp;
	env.TEMP = workspaceTmp;
	const agentHome = path.join(
		paths.workspaceBootstrapEnvironmentsDir,
		input.workspaceId,
		"agent-home",
	);
	env.HOME = agentHome;
	env.USERPROFILE = agentHome;
	env.XDG_CONFIG_HOME = path.join(agentHome, ".config");
	env.XDG_CACHE_HOME = path.join(agentHome, ".cache");
	const configuredAdapters = new Set<WorkspaceBootstrapAdapterId>();
	for (const item of input.evidence.components) {
		if (configuredAdapters.has(item.component.adapterId)) continue;
		configuredAdapters.add(item.component.adapterId);
		const digest = createHash("sha256")
			.update(`${item.component.adapterId}:${item.component.rootRelativePath}`)
			.digest("hex")
			.slice(0, 24);
		const environmentDir = path.join(
			paths.workspaceBootstrapEnvironmentsDir,
			input.workspaceId,
			digest,
		);
		const cacheDir = path.join(
			paths.workspaceBootstrapCacheDir,
			item.component.adapterId,
		);
		applyAdapterEnvironment(
			env,
			item.component.adapterId,
			environmentDir,
			cacheDir,
		);
	}
	return env;
}

function applyAdapterEnvironment(
	env: Record<string, string>,
	adapterId: WorkspaceBootstrapAdapterId,
	environmentDir: string,
	cacheDir: string,
) {
	switch (adapterId) {
		case "bun":
			env.BUN_INSTALL_CACHE_DIR = cacheDir;
			break;
		case "npm":
			env.npm_config_cache = cacheDir;
			break;
		case "yarn":
			env.YARN_CACHE_FOLDER = cacheDir;
			break;
		case "uv":
			env.UV_CACHE_DIR = cacheDir;
			env.UV_PROJECT_ENVIRONMENT = environmentDir;
			env.VIRTUAL_ENV = environmentDir;
			prependPath(env, environmentBinDir(environmentDir));
			break;
		case "pip":
			env.PIP_CACHE_DIR = cacheDir;
			env.VIRTUAL_ENV = environmentDir;
			prependPath(env, environmentBinDir(environmentDir));
			break;
		case "poetry":
			env.POETRY_CACHE_DIR = cacheDir;
			env.POETRY_VIRTUALENVS_PATH = environmentDir;
			break;
		case "bundler":
			env.BUNDLE_PATH = environmentDir;
			env.BUNDLE_CACHE_PATH = cacheDir;
			env.BUNDLE_FROZEN = "true";
			break;
		case "composer":
			env.COMPOSER_CACHE_DIR = cacheDir;
			break;
		case "go":
			env.GOMODCACHE = path.join(cacheDir, "modules");
			env.GOCACHE = path.join(cacheDir, "build");
			break;
		case "cargo":
			env.CARGO_HOME = cacheDir;
			env.CARGO_TARGET_DIR = environmentDir;
			break;
		case "dotnet":
			env.NUGET_PACKAGES = cacheDir;
			break;
		case "gradle":
			env.GRADLE_USER_HOME = cacheDir;
			break;
		case "pnpm":
		case "maven":
			break;
	}
}

function prependPath(env: Record<string, string>, value: string) {
	env.PATH = env.PATH ? `${value}${path.delimiter}${env.PATH}` : value;
}

function environmentBinDir(environmentDir: string) {
	return path.join(
		environmentDir,
		process.platform === "win32" ? "Scripts" : "bin",
	);
}
