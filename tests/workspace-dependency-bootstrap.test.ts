import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	buildWorkspaceRuntimeEnvironment,
	detectWorkspaceBootstrapComponents,
	runWorkspaceDependencyBootstrap,
	WorkspaceBootstrapError,
} from "../api/modules/gitworktree/workspace-bootstrap";
import {
	redactSecretRecord,
	redactSecretText,
} from "../api/services/security/secret-redaction";

const temporaryDirectories: string[] = [];
const originalRuntimeDirectory = process.env.NIGHTWORKERS_RUNTIME_DIR;
const originalPath = process.env.PATH;
const originalFakeBunCalls = process.env.FAKE_BUN_CALLS;
const originalNpmToken = process.env.NPM_TOKEN;

async function createTemporaryDirectory(prefix: string) {
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
	temporaryDirectories.push(directory);
	return directory;
}

async function writeFixture(root: string, files: Record<string, string>) {
	for (const [relativePath, content] of Object.entries(files)) {
		const target = path.join(root, relativePath);
		await fs.mkdir(path.dirname(target), { recursive: true });
		await fs.writeFile(target, content);
	}
}

afterEach(async () => {
	if (originalRuntimeDirectory === undefined) {
		delete process.env.NIGHTWORKERS_RUNTIME_DIR;
	} else {
		process.env.NIGHTWORKERS_RUNTIME_DIR = originalRuntimeDirectory;
	}
	if (originalPath === undefined) delete process.env.PATH;
	else process.env.PATH = originalPath;
	if (originalFakeBunCalls === undefined) delete process.env.FAKE_BUN_CALLS;
	else process.env.FAKE_BUN_CALLS = originalFakeBunCalls;
	if (originalNpmToken === undefined) delete process.env.NPM_TOKEN;
	else process.env.NPM_TOKEN = originalNpmToken;
	for (const directory of temporaryDirectories.splice(0)) {
		await fs.rm(directory, { recursive: true, force: true });
	}
});

describe("workspace dependency bootstrap detection", () => {
	it("detects polyglot locked components structurally", async () => {
		const root = await createTemporaryDirectory("nw-bootstrap-detect-");
		await writeFixture(root, {
			"package.json": JSON.stringify({ name: "root" }),
			"bun.lock": "{}",
			"services/api/pyproject.toml": '[project]\nname = "api"\n',
			"services/api/uv.lock": "version = 1\n",
		});

		await expect(detectWorkspaceBootstrapComponents(root)).resolves.toEqual([
			{
				adapterId: "bun",
				rootRelativePath: ".",
				evidencePaths: ["package.json", "bun.lock"],
			},
			{
				adapterId: "uv",
				rootRelativePath: path.join("services", "api"),
				evidencePaths: [
					path.join("services", "api", "pyproject.toml"),
					path.join("services", "api", "uv.lock"),
				],
			},
		]);
	});

	it("fails closed for ambiguous managers or a missing lockfile", async () => {
		const ambiguousRoot = await createTemporaryDirectory(
			"nw-bootstrap-ambiguous-",
		);
		await writeFixture(ambiguousRoot, {
			"package.json": "{}",
			"bun.lock": "{}",
			"package-lock.json": "{}",
		});
		await expect(
			detectWorkspaceBootstrapComponents(ambiguousRoot),
		).rejects.toMatchObject({ code: "BOOTSTRAP_MANAGER_AMBIGUOUS" });

		const unlockedRoot = await createTemporaryDirectory(
			"nw-bootstrap-unlocked-",
		);
		await writeFixture(unlockedRoot, { "package.json": "{}" });
		await expect(
			detectWorkspaceBootstrapComponents(unlockedRoot),
		).rejects.toMatchObject({ code: "BOOTSTRAP_LOCK_REQUIRED" });

		const duplicateLockRoot = await createTemporaryDirectory(
			"nw-bootstrap-duplicate-lock-",
		);
		await writeFixture(duplicateLockRoot, {
			"package.json": "{}",
			"package-lock.json": "{}",
			"npm-shrinkwrap.json": "{}",
		});
		await expect(
			detectWorkspaceBootstrapComponents(duplicateLockRoot),
		).rejects.toMatchObject({ code: "BOOTSTRAP_MANAGER_AMBIGUOUS" });
	});

	it("includes workspace package manifests in the install fingerprint", async () => {
		const root = await createTemporaryDirectory("nw-bootstrap-workspace-");
		await writeFixture(root, {
			"package.json": JSON.stringify({
				name: "root",
				packageManager: "bun@1.2.3",
				workspaces: ["packages/*"],
			}),
			"bun.lock": "{}",
			"packages/ui/package.json": JSON.stringify({ name: "ui" }),
		});

		await expect(detectWorkspaceBootstrapComponents(root)).resolves.toEqual([
			{
				adapterId: "bun",
				rootRelativePath: ".",
				evidencePaths: [
					"package.json",
					"bun.lock",
					path.join("packages", "ui", "package.json"),
				],
			},
		]);
	});

	it("does not hide an unlocked nested package outside workspace patterns", async () => {
		const root = await createTemporaryDirectory("nw-bootstrap-nested-");
		await writeFixture(root, {
			"package.json": JSON.stringify({
				name: "root",
				workspaces: ["packages/*"],
			}),
			"bun.lock": "{}",
			"examples/demo/package.json": JSON.stringify({ name: "demo" }),
		});

		await expect(
			detectWorkspaceBootstrapComponents(root),
		).rejects.toMatchObject({
			code: "BOOTSTRAP_LOCK_REQUIRED",
			details: { componentRoot: path.join("examples", "demo") },
		});
	});

	it("rejects a packageManager declaration that disagrees with the lockfile", async () => {
		const root = await createTemporaryDirectory("nw-bootstrap-manager-");
		await writeFixture(root, {
			"package.json": JSON.stringify({ packageManager: "pnpm@10.0.0" }),
			"bun.lock": "{}",
		});

		await expect(
			detectWorkspaceBootstrapComponents(root),
		).rejects.toMatchObject({ code: "BOOTSTRAP_MANAGER_AMBIGUOUS" });
	});

	it("treats a .NET solution as covered by its locked projects", async () => {
		const root = await createTemporaryDirectory("nw-bootstrap-dotnet-");
		await writeFixture(root, {
			"App.sln": "solution",
			"src/App/App.csproj": "<Project />",
			"src/App/packages.lock.json": "{}",
		});

		await expect(detectWorkspaceBootstrapComponents(root)).resolves.toEqual([
			{
				adapterId: "dotnet",
				rootRelativePath: path.join("src", "App"),
				evidencePaths: [
					path.join("src", "App", "App.csproj"),
					path.join("src", "App", "packages.lock.json"),
				],
			},
		]);
	});
});

describe("workspace dependency bootstrap execution", () => {
	it("installs once and skips only when the exact stamp and dependency state match", async () => {
		const root = await createTemporaryDirectory("nw-bootstrap-run-");
		const runtimeRoot = await createTemporaryDirectory("nw-bootstrap-runtime-");
		const binDirectory = await createTemporaryDirectory("nw-bootstrap-bin-");
		const callLog = path.join(root, "bun-calls.log");
		await writeFixture(root, {
			"package.json": JSON.stringify({ name: "fixture", devDependencies: {} }),
			"bun.lock": "{}",
		});
		await writeFixture(binDirectory, {
			bun: [
				"#!/bin/sh",
				'if [ "$1" = "--version" ]; then',
				"  echo 1.2.3",
				"  exit 0",
				"fi",
				"mkdir -p node_modules",
				'echo install >> "$FAKE_BUN_CALLS"',
			].join("\n"),
		});
		await fs.chmod(path.join(binDirectory, "bun"), 0o755);
		process.env.NIGHTWORKERS_RUNTIME_DIR = runtimeRoot;
		process.env.PATH = `${binDirectory}${path.delimiter}${originalPath ?? ""}`;
		process.env.FAKE_BUN_CALLS = callLog;

		const first = await runWorkspaceDependencyBootstrap({
			workspaceId: "workspace-1",
			workspaceRoot: root,
		});
		const second = await runWorkspaceDependencyBootstrap({
			workspaceId: "workspace-1",
			workspaceRoot: root,
			previousEvidence: first,
		});

		expect(first.status).toBe("ready");
		expect(first.components[0]?.status).toBe("installed");
		expect(second.components[0]?.status).toBe("skipped");
		expect((await fs.readFile(callLog, "utf8")).trim().split("\n")).toEqual([
			"install",
		]);
		await expect(
			fs.stat(
				path.join(
					runtimeRoot,
					"workspace-bootstrap",
					"environments",
					"workspace-1",
				),
			),
		).resolves.toBeDefined();
	});

	it("rejects a parent dependency symlink before invoking an installer", async () => {
		const root = await createTemporaryDirectory("nw-bootstrap-symlink-");
		const external = await createTemporaryDirectory("nw-bootstrap-external-");
		await writeFixture(root, {
			"package.json": "{}",
			"bun.lock": "{}",
		});
		await fs.symlink(external, path.join(root, "node_modules"), "dir");

		await expect(
			runWorkspaceDependencyBootstrap({
				workspaceId: "workspace-symlink",
				workspaceRoot: root,
			}),
		).rejects.toMatchObject({
			code: "WORKSPACE_DEPENDENCY_ROOT_SYMLINK_FORBIDDEN",
		});
	});

	it("rejects symlinks inside the managed bootstrap runtime", async () => {
		const root = await createTemporaryDirectory("nw-bootstrap-runtime-link-");
		const runtimeRoot = await createTemporaryDirectory("nw-bootstrap-runtime-");
		const external = await createTemporaryDirectory(
			"nw-bootstrap-cache-target-",
		);
		await writeFixture(root, {
			"package.json": "{}",
			"bun.lock": "{}",
		});
		const cacheRoot = path.join(runtimeRoot, "workspace-bootstrap", "cache");
		await fs.mkdir(cacheRoot, { recursive: true });
		await fs.symlink(external, path.join(cacheRoot, "bun"), "dir");
		process.env.NIGHTWORKERS_RUNTIME_DIR = runtimeRoot;

		await expect(
			runWorkspaceDependencyBootstrap({
				workspaceId: "workspace-runtime-link",
				workspaceRoot: root,
			}),
		).rejects.toMatchObject({ code: "DEPENDENCY_STATE_INVALID" });
	});

	it("returns not_required for repositories without dependency manifests", async () => {
		const root = await createTemporaryDirectory("nw-bootstrap-empty-");
		await writeFixture(root, { "README.md": "# fixture\n" });

		await expect(
			runWorkspaceDependencyBootstrap({
				workspaceId: "workspace-empty",
				workspaceRoot: root,
			}),
		).resolves.toMatchObject({
			status: "not_required",
			components: [],
		});
	});

	it("rejects an already-aborted request with a structured cancellation", async () => {
		const root = await createTemporaryDirectory("nw-bootstrap-aborted-");
		const controller = new AbortController();
		controller.abort();

		await expect(
			runWorkspaceDependencyBootstrap({
				workspaceId: "workspace-aborted",
				workspaceRoot: root,
				signal: controller.signal,
			}),
		).rejects.toMatchObject({ code: "DEPENDENCY_INSTALL_CANCELLED" });
	});

	it("supports a local Yarn Plug'n'Play install without node_modules", async () => {
		const root = await createTemporaryDirectory("nw-bootstrap-yarn-pnp-");
		const runtimeRoot = await createTemporaryDirectory("nw-bootstrap-runtime-");
		const binDirectory = await createTemporaryDirectory("nw-bootstrap-bin-");
		await writeFixture(root, {
			"package.json": JSON.stringify({ packageManager: "yarn@4.1.0" }),
			"yarn.lock": "# lock",
			".yarnrc.yml": "nodeLinker: pnp\n",
		});
		await writeFixture(binDirectory, {
			yarn: [
				"#!/bin/sh",
				'if [ "$1" = "--version" ]; then echo 4.1.0; exit 0; fi',
				"touch .pnp.cjs",
			].join("\n"),
		});
		await fs.chmod(path.join(binDirectory, "yarn"), 0o755);
		process.env.NIGHTWORKERS_RUNTIME_DIR = runtimeRoot;
		process.env.PATH = `${binDirectory}${path.delimiter}${originalPath ?? ""}`;

		await expect(
			runWorkspaceDependencyBootstrap({
				workspaceId: "workspace-yarn-pnp",
				workspaceRoot: root,
			}),
		).resolves.toMatchObject({
			status: "ready",
			components: [{ status: "installed" }],
		});
	});

	it("rejects an install when its lock inputs change during execution", async () => {
		const root = await createTemporaryDirectory("nw-bootstrap-lock-race-");
		const runtimeRoot = await createTemporaryDirectory("nw-bootstrap-runtime-");
		const binDirectory = await createTemporaryDirectory("nw-bootstrap-bin-");
		await writeFixture(root, {
			"package.json": "{}",
			"bun.lock": "before",
		});
		await writeFixture(binDirectory, {
			bun: [
				"#!/bin/sh",
				'if [ "$1" = "--version" ]; then echo 1.2.3; exit 0; fi',
				"mkdir -p node_modules",
				"echo after > bun.lock",
			].join("\n"),
		});
		await fs.chmod(path.join(binDirectory, "bun"), 0o755);
		process.env.NIGHTWORKERS_RUNTIME_DIR = runtimeRoot;
		process.env.PATH = `${binDirectory}${path.delimiter}${originalPath ?? ""}`;

		await expect(
			runWorkspaceDependencyBootstrap({
				workspaceId: "workspace-lock-race",
				workspaceRoot: root,
			}),
		).rejects.toMatchObject({ code: "BOOTSTRAP_LOCK_MISMATCH" });
	});

	it("returns a structured timeout and cancellation instead of leaving the installer running", async () => {
		const root = await createTemporaryDirectory("nw-bootstrap-stop-");
		const runtimeRoot = await createTemporaryDirectory("nw-bootstrap-runtime-");
		const binDirectory = await createTemporaryDirectory("nw-bootstrap-bin-");
		await writeFixture(root, {
			"package.json": "{}",
			"bun.lock": "{}",
		});
		await writeFixture(binDirectory, {
			bun: [
				"#!/bin/sh",
				'if [ "$1" = "--version" ]; then echo 1.2.3; exit 0; fi',
				"sleep 5",
			].join("\n"),
		});
		await fs.chmod(path.join(binDirectory, "bun"), 0o755);
		process.env.NIGHTWORKERS_RUNTIME_DIR = runtimeRoot;
		process.env.PATH = `${binDirectory}${path.delimiter}${originalPath ?? ""}`;

		await expect(
			runWorkspaceDependencyBootstrap({
				workspaceId: "workspace-timeout",
				workspaceRoot: root,
				timeoutMs: 25,
			}),
		).rejects.toMatchObject({ code: "DEPENDENCY_INSTALL_TIMEOUT" });

		const controller = new AbortController();
		const cancelled = runWorkspaceDependencyBootstrap({
			workspaceId: "workspace-cancelled",
			workspaceRoot: root,
			signal: controller.signal,
		});
		setTimeout(() => controller.abort(), 25);
		await expect(cancelled).rejects.toMatchObject({
			code: "DEPENDENCY_INSTALL_CANCELLED",
		});
	});

	it("redacts installer credentials in structured failure evidence", async () => {
		const root = await createTemporaryDirectory("nw-bootstrap-redact-");
		const runtimeRoot = await createTemporaryDirectory("nw-bootstrap-runtime-");
		const binDirectory = await createTemporaryDirectory("nw-bootstrap-bin-");
		const secret = "registry-secret-value-123";
		await writeFixture(root, {
			"package.json": "{}",
			"bun.lock": "{}",
		});
		await writeFixture(binDirectory, {
			bun: [
				"#!/bin/sh",
				'if [ "$1" = "--version" ]; then echo 1.2.3; exit 0; fi',
				'echo "Authorization: Bearer $NPM_TOKEN" >&2',
				"exit 7",
			].join("\n"),
		});
		await fs.chmod(path.join(binDirectory, "bun"), 0o755);
		process.env.NIGHTWORKERS_RUNTIME_DIR = runtimeRoot;
		process.env.PATH = `${binDirectory}${path.delimiter}${originalPath ?? ""}`;
		process.env.NPM_TOKEN = secret;

		const failure = await runWorkspaceDependencyBootstrap({
			workspaceId: "workspace-redacted",
			workspaceRoot: root,
		}).catch((error: unknown) => error);

		expect(failure).toMatchObject({
			code: "DEPENDENCY_INSTALL_FAILED",
			details: {
				exitCode: 7,
				redactedStderrExcerpt: expect.stringContaining("[REDACTED]"),
			},
		});
		expect(JSON.stringify(failure)).not.toContain(secret);
	});
});

describe("workspace bootstrap log redaction", () => {
	it("redacts exact secrets and common registry credential forms", () => {
		const secret = "secret/registry+token:123";
		const value = [
			`Authorization: Bearer ${secret}`,
			`npm_authToken=${secret}`,
			`https://user:${secret}@registry.example.test/package`,
			`?access_token=${secret}`,
			`encoded=${encodeURIComponent(secret)}`,
		].join("\n");

		const redacted = redactSecretText(value, { secretValues: [secret] });

		expect(redacted).not.toContain(secret);
		expect(redacted).toContain("[REDACTED]");
	});

	it("redacts registry config assignments and nested structured values", () => {
		const secret = "nested-secret-token-123";
		const text = [
			`//registry.example.test/:_authToken=${secret}`,
			`npmAuthToken: "${secret}"`,
			`proxy-authorization: Basic ${secret}`,
		].join("\n");
		const record = redactSecretRecord({
			bootstrap: {
				output: text,
				credentials: { password: secret },
			},
		});

		expect(JSON.stringify(record)).not.toContain(secret);
		expect(JSON.stringify(record)).toContain("[REDACTED]");
	});

	it("keeps the system PATH after activating a managed environment", () => {
		const environment = buildWorkspaceRuntimeEnvironment({
			workspaceId: "workspace-runtime",
			baseEnv: {
				PATH: `/system/bin${path.delimiter}/tool/bin`,
				NIGHTWORKERS_RUNTIME_DIR: "/runtime",
			},
			evidence: {
				version: 1,
				status: "ready",
				startedAt: new Date(0).toISOString(),
				completedAt: new Date(0).toISOString(),
				components: [
					{
						component: {
							adapterId: "pip",
							rootRelativePath: ".",
							evidencePaths: ["requirements.lock"],
						},
						status: "installed",
						durationMs: 1,
						commands: [],
						stamp: {
							schemaVersion: 1,
							adapterId: "pip",
							adapterContractVersion: 1,
							componentRoot: ".",
							inputDigest: "sha256:test",
							toolVersion: "3",
							platform: "test",
							architecture: "test",
							environmentDigest: "sha256:test",
							validationKind: "nightworkers-managed-environment-v1",
							completedAt: new Date(0).toISOString(),
						},
					},
				],
			},
		});

		expect(environment.PATH).toContain("/system/bin");
		expect(environment.PATH).toContain("/tool/bin");
	});

	it("exposes structured bootstrap error metadata without raw credentials", () => {
		const error = new WorkspaceBootstrapError(
			"DEPENDENCY_INSTALL_FAILED",
			"Dependency initialization failed.",
			{
				stage: "install",
				retryable: true,
				redactedStderrExcerpt: "Bearer [REDACTED]",
			},
		);

		expect(error).toMatchObject({
			code: "DEPENDENCY_INSTALL_FAILED",
			details: {
				stage: "install",
				retryable: true,
				redactedStderrExcerpt: "Bearer [REDACTED]",
			},
		});
	});
});
