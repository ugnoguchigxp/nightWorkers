import { describe, expect, it } from "vitest";
import {
	buildChildProcessEnvironment,
	isForbiddenChildEnvironmentEntry,
} from "../api/services/execution/child-process-environment";
import {
	buildMacOsKeychainWriteInvocation,
	clearSessionSecretStoreForTests,
	readSecretStoreValue,
	writeSecretStoreValue,
} from "../api/services/security/os-secret-store";
import { redactSecretText } from "../api/services/security/secret-redaction";
import { sanitizeCodexProviderEnv } from "../api/services/structured-llm/codex-provider";

describe("child process environment boundary", () => {
	it("inherits public runtime variables without inheriting provider credentials", () => {
		const environment = buildChildProcessEnvironment({
			purpose: "workspace_command",
			source: {
				PATH: "/usr/bin",
				LANG: "ja_JP.UTF-8",
				OPENAI_API_KEY: "host-provider-secret",
				NIGHTWORKERS_ANTHROPIC_API_KEY: "nightworkers-provider-secret",
				DATABASE_URL: "sqlite://control-plane.db",
			},
		});

		expect(environment).toEqual({
			PATH: "/usr/bin",
			LANG: "ja_JP.UTF-8",
		});
	});

	it("accepts explicit run variables but rejects secret and credential overrides", () => {
		const environment = buildChildProcessEnvironment({
			purpose: "workspace_command",
			source: { PATH: "/usr/bin" },
			overrides: {
				PROJECT_MODE: "test",
				PROJECT_TOKEN: "must-not-cross",
				NPM_CONFIG_USERCONFIG: "/tmp/private-npmrc",
			},
		});

		expect(environment).toEqual({
			PATH: "/usr/bin",
			PROJECT_MODE: "test",
		});
	});

	it("passes worker control-plane paths without passing provider keys", () => {
		const environment = buildChildProcessEnvironment({
			purpose: "task_worker",
			source: {
				PATH: "/usr/bin",
				DATABASE_URL: "file:/tmp/nightworkers.db",
				NIGHTWORKERS_RUNTIME_DIR: "/tmp/nightworkers-runtime",
				OPENAI_API_KEY: "must-not-cross",
			},
			overrides: { NIGHTWORKERS_EXECUTION_ROLE: "worker" },
		});

		expect(environment).toMatchObject({
			PATH: "/usr/bin",
			DATABASE_URL: "file:/tmp/nightworkers.db",
			NIGHTWORKERS_RUNTIME_DIR: "/tmp/nightworkers-runtime",
			NIGHTWORKERS_EXECUTION_ROLE: "worker",
		});
		expect(environment.OPENAI_API_KEY).toBeUndefined();
	});

	it("passes only explicitly assigned MCP integration credentials", () => {
		const environment = buildChildProcessEnvironment({
			purpose: "mcp_stdio",
			source: {
				PATH: "/usr/bin",
				OPENAI_API_KEY: "ambient-nightworkers-provider-secret",
				CODEX_HOME: "/host/codex-auth",
			},
			credentialOverrides: {
				MCP_INTEGRATION_TOKEN: "explicit-mcp-secret",
				NIGHTWORKERS_OPENAI_API_KEY: "control-plane-secret",
				CODEX_HOME: "/host/codex-auth",
				NPM_CONFIG_REGISTRY: "https://user:password@registry.example.test",
			},
		});

		expect(environment).toEqual({
			PATH: "/usr/bin",
			MCP_INTEGRATION_TOKEN: "explicit-mcp-secret",
		});
	});

	it("exposes CODEX_HOME only to the provider runtime", () => {
		const source = { PATH: "/usr/bin", CODEX_HOME: "/host/codex-auth" };

		expect(
			buildChildProcessEnvironment({
				purpose: "workspace_command",
				source,
			}).CODEX_HOME,
		).toBeUndefined();
		expect(
			buildChildProcessEnvironment({
				purpose: "provider_runtime",
				source,
			}).CODEX_HOME,
		).toBe("/host/codex-auth");
	});

	it("sanitizes the structured Codex SDK child environment", () => {
		expect(
			sanitizeCodexProviderEnv({
				PATH: "/usr/bin",
				CODEX_HOME: "/host/codex-auth",
				CODEX_ACCESS_TOKEN: "ambient-codex-token",
				OPENAI_API_KEY: "ambient-openai-key",
				NIGHTWORKERS_CODEX_API_KEY: "control-plane-key",
				DATABASE_URL: "file:/control-plane.sqlite",
			}),
		).toEqual({
			PATH: "/usr/bin",
			CODEX_HOME: "/host/codex-auth",
		});
	});

	it("classifies provider and embedded registry credentials as forbidden", () => {
		expect(
			isForbiddenChildEnvironmentEntry("CODEX_ACCESS_TOKEN", "secret"),
		).toBe(true);
		expect(
			isForbiddenChildEnvironmentEntry(
				"NPM_CONFIG_REGISTRY",
				"https://user:password@registry.example.test",
			),
		).toBe(true);
	});

	it("redacts project-prefixed secret assignments from command output", () => {
		expect(redactSecretText("PROJECT_TOKEN=project-secret-value\n")).toBe(
			"PROJECT_TOKEN=[REDACTED]\n",
		);
	});

	it("does not let an isolated task worker resolve the parent secret store", () => {
		clearSessionSecretStoreForTests();
		writeSecretStoreValue("test/provider", "parent-only-secret");
		const previousRole = process.env.NIGHTWORKERS_EXECUTION_ROLE;
		process.env.NIGHTWORKERS_EXECUTION_ROLE = "worker";
		try {
			expect(readSecretStoreValue("test/provider")).toBeNull();
			expect(() =>
				writeSecretStoreValue("test/provider", "worker-secret"),
			).toThrow("WORKER_SECRET_STORE_ACCESS_DENIED");
		} finally {
			if (previousRole === undefined) {
				delete process.env.NIGHTWORKERS_EXECUTION_ROLE;
			} else {
				process.env.NIGHTWORKERS_EXECUTION_ROLE = previousRole;
			}
		}
	});

	it("keeps macOS Keychain secret bytes out of process arguments", () => {
		const secret = 'provider-secret-"quoted"';
		const invocation = buildMacOsKeychainWriteInvocation(
			'application-settings/"llm"',
			secret,
		);

		expect(invocation.command).toBe("security");
		expect(invocation.args).toEqual(["-i"]);
		expect(invocation.args.join(" ")).not.toContain(secret);
		expect(invocation.input).not.toContain(secret);
		expect(invocation.input).toContain(
			Buffer.from(secret, "utf-8").toString("hex"),
		);
	});
});
