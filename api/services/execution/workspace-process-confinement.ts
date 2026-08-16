import { execFile, execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { listExistingProjectSecretPaths } from "../security/project-secret-paths";

const execFileAsync = promisify(execFile);

export async function prepareWorkspaceConstrainedCommand(input: {
	command: { program: string; args: readonly string[] };
	workspaceRoot: string;
	environment: NodeJS.ProcessEnv;
}) {
	const workspaceRoot = await fs.realpath(input.workspaceRoot);
	const gitCommonDir = await resolveGitCommonDir(
		workspaceRoot,
		input.environment,
	);
	const runtimePaths = writableRuntimePaths(input.environment);
	const secretPaths = await listExistingProjectSecretPaths(workspaceRoot);
	if (process.platform === "darwin") {
		await assertMacSandboxAvailable();
		return {
			executable: "/usr/bin/sandbox-exec",
			args: [
				"-p",
				buildMacSandboxProfile({
					workspaceRoot,
					gitCommonDir,
					environment: input.environment,
					runtimePaths,
					secretPaths,
				}),
				input.command.program,
				...input.command.args,
			],
		};
	}
	if (process.platform === "linux" && commandExists("bwrap")) {
		const args = [
			"--die-with-parent",
			"--new-session",
			"--proc",
			"/proc",
			"--dev",
			"/dev",
		];
		for (const readPath of readableSystemPaths(input.environment)) {
			if (await pathExists(readPath))
				args.push("--ro-bind", readPath, readPath);
		}
		for (const writePath of [workspaceRoot, gitCommonDir, ...runtimePaths]) {
			if (await pathExists(writePath))
				args.push("--bind", writePath, writePath);
		}
		const secretMaskPaths = new Set<string>();
		for (const secretPath of secretPaths) {
			secretMaskPaths.add(
				await fs.realpath(secretPath).catch(() => secretPath),
			);
		}
		for (const secretPath of secretMaskPaths) {
			if (await pathExists(secretPath)) {
				args.push("--ro-bind", "/dev/null", secretPath);
			}
		}
		args.push(
			"--chdir",
			workspaceRoot,
			input.command.program,
			...input.command.args,
		);
		return { executable: "bwrap", args };
	}
	throw new Error(
		"WORKSPACE_PROCESS_CONFINEMENT_UNAVAILABLE: sandbox-exec or bubblewrap is required",
	);
}

async function assertMacSandboxAvailable() {
	try {
		await execFileAsync(
			"/usr/bin/sandbox-exec",
			["-p", "(version 1)", "/usr/bin/true"],
			{ timeout: 2_000, maxBuffer: 64 * 1024 },
		);
	} catch (cause) {
		throw new Error(
			"WORKSPACE_PROCESS_CONFINEMENT_UNAVAILABLE: sandbox-exec cannot apply a profile in this runtime",
			{ cause },
		);
	}
}

async function resolveGitCommonDir(
	workspaceRoot: string,
	environment: NodeJS.ProcessEnv,
) {
	const result = await execFileAsync(
		"git",
		["-C", workspaceRoot, "rev-parse", "--git-common-dir"],
		{ env: environment, maxBuffer: 1024 * 1024, timeout: 10_000 },
	);
	const resolved = path.resolve(workspaceRoot, result.stdout.trim());
	return fs.realpath(resolved).catch(() => resolved);
}

function buildMacSandboxProfile(input: {
	workspaceRoot: string;
	gitCommonDir: string;
	environment: NodeJS.ProcessEnv;
	runtimePaths: string[];
	secretPaths: string[];
}) {
	const readPaths = new Set([
		...readableSystemPaths(input.environment),
		input.workspaceRoot,
		input.gitCommonDir,
		...input.runtimePaths,
	]);
	const writePaths = new Set([
		input.workspaceRoot,
		input.gitCommonDir,
		...input.runtimePaths,
	]);
	// Bun resolves cwd by reading every ancestor directory. Keep that traversal
	// limited to the workspace, Git common directory, and isolated runtime paths;
	// descendants outside the explicitly allowed roots remain denied.
	const readableAncestors = ancestorDirectories(writePaths);
	return [
		"(version 1)",
		"(allow default)",
		...sensitiveReadRoots().map(
			(value) => `(deny file-read* (subpath "${escapeSandboxString(value)}"))`,
		),
		"(deny file-write*)",
		...Array.from(readableAncestors, (value) =>
			sandboxLiteralRule("file-read-metadata", value),
		),
		...Array.from(readableAncestors, (value) =>
			sandboxLiteralRule("file-read-data", value),
		),
		...Array.from(readPaths, (value) => sandboxRule("file-read*", value)),
		...Array.from(writePaths, (value) => sandboxRule("file-write*", value)),
		...input.secretPaths.map((value) =>
			sandboxLiteralDenyRule("file-read*", value),
		),
		...input.secretPaths.map((value) => sandboxDenyRule("file-read*", value)),
		'(allow file-write* (literal "/dev/null"))',
	].join("\n");
}

function ancestorDirectories(paths: Iterable<string>) {
	const ancestors = new Set<string>();
	for (const targetPath of paths) {
		let current = path.resolve(targetPath);
		while (true) {
			const parent = path.dirname(current);
			if (parent === current) break;
			ancestors.add(parent);
			current = parent;
		}
	}
	return ancestors;
}

function sensitiveReadRoots() {
	const roots = [
		os.homedir(),
		"/Users",
		"/home",
		"/root",
		"/Volumes",
		"/tmp",
		"/private/tmp",
		os.tmpdir(),
	];
	return Array.from(
		new Set(
			roots.flatMap((value) => {
				try {
					return [value, realpathSync(value)];
				} catch {
					return [value];
				}
			}),
		),
	);
}

function readableSystemPaths(environment: NodeJS.ProcessEnv) {
	const paths = new Set([
		"/System",
		"/Library",
		"/usr",
		"/bin",
		"/sbin",
		"/etc",
		"/private/etc",
		"/private/var/db",
	]);
	for (const entry of (environment.PATH ?? "").split(path.delimiter)) {
		if (entry) paths.add(path.resolve(entry));
	}
	return [...paths];
}

function writableRuntimePaths(environment: NodeJS.ProcessEnv) {
	return Array.from(
		new Set(
			[
				environment.HOME,
				environment.USERPROFILE,
				environment.TMPDIR,
				environment.TMP,
				environment.TEMP,
				environment.XDG_CONFIG_HOME,
				environment.XDG_CACHE_HOME,
			]
				.filter((value): value is string => Boolean(value))
				.flatMap(pathAliases),
		),
	);
}

function pathAliases(value: string) {
	const resolved = path.resolve(value);
	try {
		return [resolved, realpathSync(resolved)];
	} catch {
		return [resolved];
	}
}

function sandboxRule(operation: string, targetPath: string) {
	return `(allow ${operation} (subpath "${escapeSandboxString(targetPath)}"))`;
}

function sandboxDenyRule(operation: string, targetPath: string) {
	return `(deny ${operation} (subpath "${escapeSandboxString(targetPath)}"))`;
}

function sandboxLiteralRule(operation: string, targetPath: string) {
	return `(allow ${operation} (literal "${escapeSandboxString(targetPath)}"))`;
}

function sandboxLiteralDenyRule(operation: string, targetPath: string) {
	return `(deny ${operation} (literal "${escapeSandboxString(targetPath)}"))`;
}

function escapeSandboxString(value: string) {
	return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function commandExists(command: string) {
	try {
		execFileSync(command, ["--version"], {
			stdio: "ignore",
			timeout: 2_000,
		});
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code !== "ENOENT";
	}
}

async function pathExists(targetPath: string) {
	return fs
		.stat(targetPath)
		.then(() => true)
		.catch(() => false);
}
