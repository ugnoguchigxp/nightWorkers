import { execFile, execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function prepareWorkspaceConstrainedShell(input: {
	command: string;
	workspaceRoot: string;
	environment: NodeJS.ProcessEnv;
}) {
	const workspaceRoot = await fs.realpath(input.workspaceRoot);
	const gitCommonDir = await resolveGitCommonDir(
		workspaceRoot,
		input.environment,
	);
	const runtimePaths = writableRuntimePaths(input.environment);
	if (process.platform === "darwin") {
		return {
			executable: "/usr/bin/sandbox-exec",
			args: [
				"-p",
				buildMacSandboxProfile({
					workspaceRoot,
					gitCommonDir,
					environment: input.environment,
					runtimePaths,
				}),
				"/bin/bash",
				"--noprofile",
				"--norc",
				"-c",
				`set -o pipefail\n${input.command}`,
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
		args.push(
			"--chdir",
			workspaceRoot,
			"/bin/bash",
			"--noprofile",
			"--norc",
			"-c",
			`set -o pipefail\n${input.command}`,
		);
		return { executable: "bwrap", args };
	}
	throw new Error(
		"WORKSPACE_PROCESS_CONFINEMENT_UNAVAILABLE: sandbox-exec or bubblewrap is required",
	);
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
	return [
		"(version 1)",
		"(allow default)",
		...sensitiveReadRoots().map(
			(value) => `(deny file-read* (subpath "${escapeSandboxString(value)}"))`,
		),
		"(deny file-write*)",
		...Array.from(readPaths, (value) => sandboxRule("file-read*", value)),
		...Array.from(writePaths, (value) => sandboxRule("file-write*", value)),
		'(allow file-write* (literal "/dev/null"))',
	].join("\n");
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
			].filter((value): value is string => Boolean(value)),
		),
	);
}

function sandboxRule(operation: string, targetPath: string) {
	return `(allow ${operation} (subpath "${escapeSandboxString(targetPath)}"))`;
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
