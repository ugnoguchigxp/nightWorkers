import {
	isCredentialFileEnvironmentKey,
	isRegistryCredentialEnvironmentKey,
	isSecretEnvironmentKey,
} from "../security/secret-redaction";

export type ChildProcessEnvironmentPurpose =
	| "workspace_command"
	| "background_command"
	| "workspace_bootstrap"
	| "git"
	| "hook"
	| "mcp_stdio"
	| "task_worker"
	| "provider_runtime";

const EXACT_PUBLIC_KEYS = new Set([
	"CI",
	"COLORTERM",
	"COMSPEC",
	"DOTNET_ROOT",
	"GOPATH",
	"GOROOT",
	"JAVA_HOME",
	"LANG",
	"LC_ALL",
	"LC_CTYPE",
	"NODE_EXTRA_CA_CERTS",
	"NO_COLOR",
	"PATH",
	"PATHEXT",
	"PNPM_HOME",
	"SHELL",
	"SSL_CERT_DIR",
	"SSL_CERT_FILE",
	"SYSTEMROOT",
	"SystemRoot",
	"TERM",
	"TMP",
	"TMPDIR",
	"TEMP",
	"USERPROFILE",
	"VOLTA_HOME",
	"WINDIR",
]);

const PUBLIC_KEY_PATTERNS = [
	/^LC_/,
	/^NVM_/,
	/^BUN_/,
	/^COREPACK_/,
	/^(HTTP|HTTPS|NO)_PROXY$/i,
	/^(DYLD_)?LIBRARY_PATH$/,
];

const NIGHTWORKERS_PROVIDER_KEY_PATTERN =
	/^(?:NIGHTWORKERS_)?(?:OPENAI|ANTHROPIC|GEMINI|GOOGLE|AZURE|OLLAMA|LMSTUDIO|CODEX|CLAUDE)_(?:API_)?(?:KEY|TOKEN|SECRET|PASSWORD|AUTH)$/i;
const NIGHTWORKERS_CONTROL_PLANE_KEY_PATTERN = /^NIGHTWORKERS_/i;

const TASK_WORKER_CONTROL_PLANE_KEYS = new Set([
	"DATABASE_URL",
	"NIGHTWORKERS_DESKTOP",
	"NIGHTWORKERS_E2E_ISOLATED",
	"NIGHTWORKERS_GIT_EXECUTABLE",
	"NIGHTWORKERS_RESOURCE_DIR",
	"NIGHTWORKERS_RUNTIME_DIR",
	"NIGHTWORKERS_SQLITE_BUSY_RETRY_PROFILE",
	"NIGHTWORKERS_VITEST_DB_PATH",
	"NIGHTWORKERS_WORKSPACE_BOOTSTRAP_DIR",
	"NODE_ENV",
]);

export function buildChildProcessEnvironment(input: {
	purpose: ChildProcessEnvironmentPurpose;
	source?: NodeJS.ProcessEnv;
	overrides?: Record<string, string>;
	/** Explicit integration-owned credentials; never populated from ambient process.env. */
	credentialOverrides?: Record<string, string>;
}): Record<string, string> {
	const source = input.source ?? process.env;
	const environment = Object.fromEntries(
		Object.entries(source).filter(
			(entry): entry is [string, string] =>
				typeof entry[1] === "string" &&
				(isPublicRuntimeEnvironmentKey(entry[0]) ||
					(input.purpose === "provider_runtime" && entry[0] === "CODEX_HOME") ||
					(input.purpose === "task_worker" &&
						TASK_WORKER_CONTROL_PLANE_KEYS.has(entry[0]))) &&
				!isForbiddenChildEnvironmentEntry(entry[0], entry[1]),
		),
	);

	for (const [key, value] of Object.entries(input.overrides ?? {})) {
		if (isForbiddenChildEnvironmentEntry(key, value)) continue;
		if (
			input.purpose === "workspace_command" ||
			input.purpose === "background_command" ||
			input.purpose === "task_worker" ||
			input.purpose === "hook" ||
			input.purpose === "mcp_stdio"
		) {
			environment[key] = value;
			continue;
		}
		if (isPublicRuntimeEnvironmentKey(key)) environment[key] = value;
	}
	if (input.purpose === "mcp_stdio") {
		for (const [key, value] of Object.entries(
			input.credentialOverrides ?? {},
		)) {
			if (
				NIGHTWORKERS_CONTROL_PLANE_KEY_PATTERN.test(key) ||
				key === "CODEX_HOME" ||
				isCredentialFileEnvironmentKey(key) ||
				(/(REGISTRY|INDEX_URL|REPOSITORY_URL)/i.test(key) &&
					isRegistryCredentialEnvironmentKey(key, value))
			) {
				continue;
			}
			environment[key] = value;
		}
	}

	return environment;
}

export function isForbiddenChildEnvironmentEntry(key: string, value?: string) {
	return (
		NIGHTWORKERS_PROVIDER_KEY_PATTERN.test(key) ||
		isSecretEnvironmentKey(key) ||
		isCredentialFileEnvironmentKey(key) ||
		isRegistryCredentialEnvironmentKey(key, value)
	);
}

function isPublicRuntimeEnvironmentKey(key: string) {
	return (
		EXACT_PUBLIC_KEYS.has(key) ||
		PUBLIC_KEY_PATTERNS.some((pattern) => pattern.test(key))
	);
}
