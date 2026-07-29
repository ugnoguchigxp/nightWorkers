import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getRuntimePaths } from "../../../runtime/paths";
import { buildChildProcessEnvironment } from "../../../services/execution/child-process-environment";
import {
	adapterVersionCommand,
	buildWorkspaceBootstrapCommands,
} from "./adapters";
import { detectWorkspaceBootstrapComponents } from "./detector";
import { assertWorkspaceBootstrapId } from "./path-policy";
import {
	runWorkspaceBootstrapCommand,
	workspaceBootstrapCommandFailure,
} from "./process-runner";
import type {
	WorkspaceBootstrapComponent,
	WorkspaceBootstrapComponentEvidence,
	WorkspaceBootstrapStamp,
	WorkspaceDependencyBootstrapEvidence,
} from "./types";
import {
	WorkspaceBootstrapError,
	workspaceDependencyBootstrapEvidenceSchema,
} from "./types";

const DEFAULT_COMPONENT_TIMEOUT_MS = 10 * 60 * 1_000;

export async function runWorkspaceDependencyBootstrap(input: {
	workspaceId: string;
	workspaceRoot: string;
	previousEvidence?: unknown;
	signal?: AbortSignal;
	timeoutMs?: number;
}): Promise<WorkspaceDependencyBootstrapEvidence> {
	assertNotAborted(input.signal);
	assertWorkspaceBootstrapId(input.workspaceId);
	const startedAt = new Date().toISOString();
	const components = await detectWorkspaceBootstrapComponents(
		input.workspaceRoot,
	);
	if (components.length === 0) {
		return {
			version: 1,
			status: "not_required",
			startedAt,
			completedAt: new Date().toISOString(),
			components: [],
		};
	}
	const previous = readPreviousEvidence(input.previousEvidence);
	const results: WorkspaceBootstrapComponentEvidence[] = [];
	for (const component of components) {
		assertNotAborted(input.signal);
		results.push(
			await bootstrapComponent({
				...input,
				component,
				previous: previous?.components.find(
					(entry) =>
						entry.component.adapterId === component.adapterId &&
						entry.component.rootRelativePath === component.rootRelativePath,
				),
			}),
		);
	}
	return {
		version: 1,
		status: "ready",
		startedAt,
		completedAt: new Date().toISOString(),
		components: results,
	};
}

async function bootstrapComponent(input: {
	workspaceId: string;
	workspaceRoot: string;
	component: WorkspaceBootstrapComponent;
	previous?: WorkspaceBootstrapComponentEvidence;
	signal?: AbortSignal;
	timeoutMs?: number;
}) {
	const started = Date.now();
	const runtimePaths = getRuntimePaths();
	const attemptId = randomUUID();
	const componentDigest = createHash("sha256")
		.update(`${input.component.adapterId}:${input.component.rootRelativePath}`)
		.digest("hex")
		.slice(0, 24);
	const componentRoot = path.resolve(
		input.workspaceRoot,
		input.component.rootRelativePath,
	);
	assertInside(input.workspaceRoot, componentRoot);
	const tmpDir = path.join(
		runtimePaths.workspaceBootstrapTmpDir,
		input.workspaceId,
		attemptId,
	);
	const cacheDir = path.join(
		runtimePaths.workspaceBootstrapCacheDir,
		input.component.adapterId,
	);
	const environmentDir = path.join(
		runtimePaths.workspaceBootstrapEnvironmentsDir,
		input.workspaceId,
		componentDigest,
	);
	let tmpReady = false;
	try {
		await ensureManagedDirectory(
			runtimePaths.workspaceBootstrapDir,
			runtimePaths.workspaceBootstrapDir,
		);
		await ensureManagedDirectory(tmpDir, runtimePaths.workspaceBootstrapDir);
		tmpReady = true;
		for (const directory of [cacheDir, path.dirname(environmentDir)]) {
			await ensureManagedDirectory(
				directory,
				runtimePaths.workspaceBootstrapDir,
			);
		}
		await assertDependencyRootPolicy(input.component, componentRoot);
		const version = await readToolVersion(
			input.component,
			componentRoot,
			input.signal,
		);
		const stampBase = await buildStamp({
			workspaceRoot: input.workspaceRoot,
			component: input.component,
			toolVersion: version,
			environmentDir,
		});
		if (
			input.previous &&
			sameStamp(input.previous.stamp, stampBase) &&
			(await validateComponent(input.component, componentRoot, environmentDir))
		) {
			return {
				component: input.component,
				status: "skipped" as const,
				durationMs: Date.now() - started,
				commands: [],
				stamp: {
					...stampBase,
					completedAt: new Date().toISOString(),
				},
			};
		}
		await prepareManagedEnvironment(input.component, environmentDir);
		let commands = buildWorkspaceBootstrapCommands({
			component: input.component,
			componentRoot,
			tmpDir,
			cacheDir,
			environmentDir,
			baseEnv: buildChildProcessEnvironment({
				purpose: "workspace_bootstrap",
			}),
		});
		if (input.component.adapterId === "yarn" && /^1\./.test(version)) {
			commands = commands.map((command) => ({
				...command,
				args: command.args.map((arg) =>
					arg === "--immutable" ? "--frozen-lockfile" : arg,
				),
			}));
		}
		const installDeadline =
			Date.now() + (input.timeoutMs ?? DEFAULT_COMPONENT_TIMEOUT_MS);
		for (const command of commands) {
			const result = await runWorkspaceBootstrapCommand({
				command,
				cwd: componentRoot,
				signal: input.signal,
				timeoutMs: Math.max(1, installDeadline - Date.now()),
			});
			if (result.exitCode !== 0) {
				throw workspaceBootstrapCommandFailure(input.component, result);
			}
		}
		const completedStamp = await buildStamp({
			workspaceRoot: input.workspaceRoot,
			component: input.component,
			toolVersion: version,
			environmentDir,
		});
		if (!sameStampInput(stampBase, completedStamp)) {
			throw new WorkspaceBootstrapError(
				"BOOTSTRAP_LOCK_MISMATCH",
				`Dependency inputs changed while initializing ${input.component.rootRelativePath}.`,
				{
					stage: "fingerprint",
					adapterId: input.component.adapterId,
					componentRoot: input.component.rootRelativePath,
					retryable: true,
				},
			);
		}
		if (
			!(await validateComponent(input.component, componentRoot, environmentDir))
		) {
			throw new WorkspaceBootstrapError(
				"DEPENDENCY_STATE_INVALID",
				`Dependency state validation failed for ${input.component.rootRelativePath}.`,
				{
					stage: "validation",
					adapterId: input.component.adapterId,
					componentRoot: input.component.rootRelativePath,
					retryable: true,
				},
			);
		}
		return {
			component: input.component,
			status: "installed" as const,
			durationMs: Date.now() - started,
			commands: commands.map(({ executable, args }) => ({ executable, args })),
			stamp: {
				...completedStamp,
				completedAt: new Date().toISOString(),
			},
		};
	} finally {
		if (tmpReady) {
			await fs
				.rm(tmpDir, { recursive: true, force: true })
				.catch(() => undefined);
		}
	}
}

async function readToolVersion(
	component: WorkspaceBootstrapComponent,
	componentRoot: string,
	signal?: AbortSignal,
) {
	const versionCommand = adapterVersionCommand(component, componentRoot);
	const result = await runWorkspaceBootstrapCommand({
		command: {
			...versionCommand,
			env: buildChildProcessEnvironment({
				purpose: "workspace_bootstrap",
			}) as Record<string, string>,
		},
		cwd: componentRoot,
		signal,
		timeoutMs: 15_000,
	});
	if (result.spawnErrorCode === "ENOENT") {
		throw new WorkspaceBootstrapError(
			"BOOTSTRAP_EXECUTABLE_NOT_FOUND",
			`${versionCommand.executable} is required to initialize this workspace.`,
			{
				stage: "fingerprint",
				adapterId: component.adapterId,
				componentRoot: component.rootRelativePath,
				retryable: false,
			},
		);
	}
	if (result.exitCode !== 0) {
		throw workspaceBootstrapCommandFailure(component, result);
	}
	const version =
		result.stdout.trim().split(/\r?\n/)[0] ||
		result.stderr.trim().split(/\r?\n/)[0] ||
		"unknown";
	return Array.from(version, (character) => {
		const code = character.charCodeAt(0);
		return code < 32 || code === 127 ? " " : character;
	})
		.join("")
		.trim()
		.slice(0, 256);
}

async function buildStamp(input: {
	workspaceRoot: string;
	component: WorkspaceBootstrapComponent;
	toolVersion: string;
	environmentDir: string;
}): Promise<Omit<WorkspaceBootstrapStamp, "completedAt">> {
	const hash = createHash("sha256");
	hash.update("workspace-bootstrap-input-v1\0");
	for (const relativePath of [...input.component.evidencePaths].sort()) {
		const absolutePath = path.resolve(input.workspaceRoot, relativePath);
		assertInside(input.workspaceRoot, absolutePath);
		hash.update(relativePath);
		hash.update("\0");
		try {
			hash.update(await fs.readFile(absolutePath));
		} catch {
			throw new WorkspaceBootstrapError(
				"BOOTSTRAP_LOCK_MISMATCH",
				`Dependency input disappeared while fingerprinting ${input.component.rootRelativePath}.`,
				{
					stage: "fingerprint",
					adapterId: input.component.adapterId,
					componentRoot: input.component.rootRelativePath,
					retryable: true,
				},
			);
		}
		hash.update("\0");
	}
	return {
		schemaVersion: 1,
		adapterId: input.component.adapterId,
		adapterContractVersion: 1,
		componentRoot: input.component.rootRelativePath,
		inputDigest: `sha256:${hash.digest("hex")}`,
		toolVersion: input.toolVersion,
		platform: os.platform(),
		architecture: os.arch(),
		environmentDigest: `sha256:${createHash("sha256")
			.update(`workspace-environment-v1:${input.environmentDir}`)
			.digest("hex")}`,
		validationKind: validationKind(input.component),
	};
}

function sameStamp(
	previous: WorkspaceBootstrapStamp,
	current: Omit<WorkspaceBootstrapStamp, "completedAt">,
) {
	return (
		previous.schemaVersion === current.schemaVersion &&
		previous.adapterId === current.adapterId &&
		previous.adapterContractVersion === current.adapterContractVersion &&
		previous.componentRoot === current.componentRoot &&
		previous.inputDigest === current.inputDigest &&
		previous.toolVersion === current.toolVersion &&
		previous.platform === current.platform &&
		previous.architecture === current.architecture &&
		previous.environmentDigest === current.environmentDigest &&
		previous.validationKind === current.validationKind
	);
}

function sameStampInput(
	left: Omit<WorkspaceBootstrapStamp, "completedAt">,
	right: Omit<WorkspaceBootstrapStamp, "completedAt">,
) {
	return (
		left.schemaVersion === right.schemaVersion &&
		left.adapterId === right.adapterId &&
		left.adapterContractVersion === right.adapterContractVersion &&
		left.componentRoot === right.componentRoot &&
		left.inputDigest === right.inputDigest &&
		left.toolVersion === right.toolVersion &&
		left.platform === right.platform &&
		left.architecture === right.architecture &&
		left.environmentDigest === right.environmentDigest &&
		left.validationKind === right.validationKind
	);
}

async function prepareManagedEnvironment(
	component: WorkspaceBootstrapComponent,
	environmentDir: string,
) {
	if (["uv", "poetry", "pip", "bundler"].includes(component.adapterId)) {
		await fs.rm(environmentDir, { recursive: true, force: true });
	}
	await fs.mkdir(environmentDir, { recursive: true, mode: 0o700 });
}

async function ensureManagedDirectory(directory: string, managedRoot: string) {
	const resolvedRoot = path.resolve(managedRoot);
	const resolvedDirectory = path.resolve(directory);
	const relative = path.relative(resolvedRoot, resolvedDirectory);
	if (relative.startsWith("..") || path.isAbsolute(relative)) {
		throw new WorkspaceBootstrapError(
			"DEPENDENCY_STATE_INVALID",
			"Workspace bootstrap managed path escaped its runtime root.",
			{ stage: "validation", retryable: false },
		);
	}
	await fs.mkdir(resolvedRoot, { recursive: true, mode: 0o700 });
	await assertManagedDirectory(resolvedRoot);
	const segments = relative ? relative.split(path.sep) : [];
	let cursor = resolvedRoot;
	for (const segment of segments) {
		cursor = path.join(cursor, segment);
		const existing = await fs
			.lstat(cursor)
			.catch((error: NodeJS.ErrnoException) => {
				if (error.code === "ENOENT") return null;
				throw error;
			});
		if (!existing) {
			await fs
				.mkdir(cursor, { mode: 0o700 })
				.catch((error: NodeJS.ErrnoException) => {
					if (error.code !== "EEXIST") throw error;
				});
		}
		await assertManagedDirectory(cursor);
	}
	await fs.chmod(resolvedDirectory, 0o700).catch(() => undefined);
}

async function assertManagedDirectory(directory: string) {
	const stat = await fs.lstat(directory);
	if (stat.isDirectory() && !stat.isSymbolicLink()) return;
	throw new WorkspaceBootstrapError(
		"DEPENDENCY_STATE_INVALID",
		"Workspace bootstrap managed directory is invalid.",
		{ stage: "validation", retryable: false },
	);
}

async function assertDependencyRootPolicy(
	component: WorkspaceBootstrapComponent,
	componentRoot: string,
) {
	const dependencyRoot = ["bun", "npm", "pnpm", "yarn"].includes(
		component.adapterId,
	)
		? path.join(componentRoot, "node_modules")
		: component.adapterId === "composer"
			? path.join(componentRoot, "vendor")
			: null;
	if (!dependencyRoot) return;
	const stat = await fs.lstat(dependencyRoot).catch(() => null);
	if (stat?.isSymbolicLink()) {
		throw new WorkspaceBootstrapError(
			"WORKSPACE_DEPENDENCY_ROOT_SYMLINK_FORBIDDEN",
			`Dependency root must not be a symlink: ${component.rootRelativePath}.`,
			{
				stage: "validation",
				adapterId: component.adapterId,
				componentRoot: component.rootRelativePath,
				retryable: false,
			},
		);
	}
}

async function validateComponent(
	component: WorkspaceBootstrapComponent,
	componentRoot: string,
	environmentDir: string,
) {
	await assertDependencyRootPolicy(component, componentRoot);
	if (["bun", "npm", "pnpm", "yarn"].includes(component.adapterId)) {
		const stat = await fs
			.lstat(path.join(componentRoot, "node_modules"))
			.catch(() => null);
		if (!stat?.isDirectory() || stat.isSymbolicLink()) {
			if (component.adapterId !== "yarn") return false;
			return validateYarnPlugAndPlay(componentRoot);
		}
		return validateDirectJavaScriptDependencies(componentRoot);
	}
	if (component.adapterId === "composer") {
		const stat = await fs
			.lstat(path.join(componentRoot, "vendor"))
			.catch(() => null);
		return Boolean(stat?.isDirectory() && !stat.isSymbolicLink());
	}
	if (["uv", "poetry", "pip", "bundler"].includes(component.adapterId)) {
		const entries = await fs.readdir(environmentDir).catch(() => []);
		return entries.length > 0;
	}
	return true;
}

async function validateDirectJavaScriptDependencies(componentRoot: string) {
	const manifestPath = path.join(componentRoot, "package.json");
	const manifest = await fs
		.readFile(manifestPath, "utf8")
		.then((content) => JSON.parse(content) as Record<string, unknown>)
		.catch(() => null);
	if (!manifest) return false;
	const dependencyNames = new Set<string>();
	for (const field of ["dependencies", "devDependencies"] as const) {
		const dependencies = manifest[field];
		if (
			!dependencies ||
			typeof dependencies !== "object" ||
			Array.isArray(dependencies)
		) {
			continue;
		}
		for (const name of Object.keys(dependencies)) dependencyNames.add(name);
	}
	for (const dependencyName of dependencyNames) {
		const packageManifest = path.join(
			componentRoot,
			"node_modules",
			...dependencyName.split("/"),
			"package.json",
		);
		const stat = await fs.stat(packageManifest).catch(() => null);
		if (!stat?.isFile()) return false;
	}
	return true;
}

async function validateYarnPlugAndPlay(componentRoot: string) {
	for (const filename of [".pnp.cjs", ".pnp.js"]) {
		const stat = await fs
			.lstat(path.join(componentRoot, filename))
			.catch(() => null);
		if (stat?.isFile() && !stat.isSymbolicLink()) return true;
	}
	return false;
}

function validationKind(component: WorkspaceBootstrapComponent) {
	if (component.adapterId === "yarn") {
		return "worktree-local-yarn-install-v1";
	}
	if (["bun", "npm", "pnpm"].includes(component.adapterId)) {
		return "worktree-local-node-modules-v1";
	}
	if (component.adapterId === "composer") {
		return "worktree-local-composer-vendor-v1";
	}
	if (["uv", "poetry", "pip", "bundler"].includes(component.adapterId)) {
		return "nightworkers-managed-environment-v1";
	}
	return "locked-restore-command-v1";
}

function readPreviousEvidence(
	value: unknown,
): WorkspaceDependencyBootstrapEvidence | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const record = value as Record<string, unknown>;
	const candidate =
		record.dependencyBootstrap &&
		typeof record.dependencyBootstrap === "object" &&
		!Array.isArray(record.dependencyBootstrap)
			? record.dependencyBootstrap
			: record;
	const parsed =
		workspaceDependencyBootstrapEvidenceSchema.safeParse(candidate);
	return parsed.success ? parsed.data : null;
}

function assertNotAborted(signal?: AbortSignal) {
	if (!signal?.aborted) return;
	throw new WorkspaceBootstrapError(
		"DEPENDENCY_INSTALL_CANCELLED",
		"Workspace dependency initialization was cancelled.",
		{ stage: "install", retryable: true },
	);
}

function assertInside(root: string, target: string) {
	const relative = path.relative(path.resolve(root), path.resolve(target));
	if (relative.startsWith("..") || path.isAbsolute(relative)) {
		throw new WorkspaceBootstrapError(
			"DEPENDENCY_STATE_INVALID",
			"Workspace bootstrap path escaped the registered worktree.",
			{ stage: "validation", retryable: false },
		);
	}
}
