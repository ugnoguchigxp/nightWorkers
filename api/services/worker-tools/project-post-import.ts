import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { getDeepRecordString } from "../../../shared/json-record";
import { buildChildProcessEnvironment } from "../execution/child-process-environment";

const INSTALL_TIMEOUT_MS = 180_000;
const INSTALL_MAX_BUFFER = 10 * 1024 * 1024;
const GIT_INIT_TIMEOUT_MS = 120_000;
const GIT_COMMIT_TIMEOUT_MS = 120_000;
const GIT_INIT_MAX_BUFFER = 5 * 1024 * 1024;
const GIT_COMMIT_MAX_BUFFER = 5 * 1024 * 1024;
const BASELINE_COMMIT_MESSAGE = "Initialize project from template";

export type PackageManager = "bun" | "npm" | "pnpm" | "yarn";
export * from "./project-post-import-inspection";

import {
	inspectLlmContext,
	inspectPackageManifest,
	packageScriptCommandFor,
} from "./project-post-import-inspection";

export type ProjectManifestInspection = {
	status: "found" | "missing" | "parse_failed";
	path: string;
	rawContent: string | null;
	parseError?: string;
	makefile?: {
		targets: string[];
	} | null;
	packageJson: {
		name?: string;
		packageManager?: string;
		scripts: Record<string, string>;
		dependencies: Record<string, string>;
		devDependencies: Record<string, string>;
	} | null;
	lockfiles: string[];
	detectedPackageManager: PackageManager | null;
	installCommand: string[] | null;
	recommendedVerificationCommands: string[];
};

export type ProjectInitializationResult = {
	status: "passed" | "failed" | "skipped";
	skippedReason?:
		| "disabled"
		| "git_init_failed"
		| "manifest_missing"
		| "manifest_parse_failed"
		| "unsupported_manifest";
	cwd: string;
	command: string[] | null;
	startedAt: string | null;
	finishedAt: string | null;
	durationMs: number | null;
	exitCode: number | null;
	signal: string | null;
	stdout: string;
	stderr: string;
	errorMessage?: string;
};

export type ProjectGitInitializationResult = {
	status: "passed" | "failed";
	cwd: string;
	command: string[];
	gitDirPath: string;
	removedExistingGitDir: boolean;
	startedAt: string;
	finishedAt: string;
	durationMs: number;
	exitCode: number | null;
	signal: string | null;
	stdout: string;
	stderr: string;
	errorMessage?: string;
	licenseRemoval: ProjectLicenseRemovalResult;
	baselineCommit: ProjectBaselineCommitResult;
};

export type ProjectLicenseRemovalResult = {
	status: "removed" | "not_found" | "failed" | "skipped";
	path: string;
	errorMessage?: string;
};

export type ProjectBaselineCommitResult = {
	status: "passed" | "failed" | "skipped";
	skippedReason?: "disabled" | "git_init_failed" | "nothing_to_commit";
	cwd: string;
	command: string[] | null;
	startedAt: string | null;
	finishedAt: string | null;
	durationMs: number | null;
	exitCode: number | null;
	signal: string | null;
	stdout: string;
	stderr: string;
	commitHash?: string;
	errorMessage?: string;
};

export type ProjectLlmContextInspection = {
	status: "found" | "read_failed";
	path: string;
	rawContent: string | null;
	errorMessage?: string;
};

export type ProjectPostImportOutput = {
	targetPath: string;
	manifest: ProjectManifestInspection;
	llmContext?: ProjectLlmContextInspection;
	gitInitialization: ProjectGitInitializationResult;
	initialization: ProjectInitializationResult;
};

export async function inspectAndInitializeImportedProject(input: {
	targetPath: string;
	initialize?: boolean;
	removeLicenseFile?: boolean;
	createBaselineCommit?: boolean;
	requireBootstrap?: boolean;
}): Promise<ProjectPostImportOutput> {
	const targetPath = path.resolve(input.targetPath);
	const manifest = await inspectPackageManifest(targetPath);
	const llmContext = await inspectLlmContext(targetPath);
	const gitInitialization = await initializeFreshGitRepository({
		targetPath,
		removeLicenseFile: input.removeLicenseFile === true,
	});
	const initialization = await initializeProject({
		targetPath,
		manifest,
		enabled: input.initialize !== false,
		gitInitStatus: gitInitialization.status,
		requireBootstrap: input.requireBootstrap === true,
	});
	const baselineCommit = await createBaselineCommit({
		targetPath,
		enabled: input.createBaselineCommit === true,
		gitInitStatus: gitInitialization.status,
	});
	return {
		targetPath,
		manifest,
		...(llmContext ? { llmContext } : {}),
		gitInitialization: {
			...gitInitialization,
			baselineCommit,
		},
		initialization,
	};
}

async function initializeFreshGitRepository(input: {
	targetPath: string;
	removeLicenseFile: boolean;
}): Promise<Omit<ProjectGitInitializationResult, "baselineCommit">> {
	const targetPath = input.targetPath;
	const gitDirPath = path.join(targetPath, ".git");
	const command = ["git", "init"];
	const startedAt = new Date();
	let removedExistingGitDir = false;
	let licenseRemoval = skippedLicenseRemoval(targetPath);

	try {
		removedExistingGitDir = await pathExists(gitDirPath);
		await fs.rm(gitDirPath, { recursive: true, force: true });
		licenseRemoval = input.removeLicenseFile
			? await removeTemplateLicenseFile(targetPath)
			: skippedLicenseRemoval(targetPath);
	} catch (error) {
		const finishedAt = new Date();
		return {
			status: "failed",
			cwd: targetPath,
			command,
			gitDirPath,
			removedExistingGitDir,
			startedAt: startedAt.toISOString(),
			finishedAt: finishedAt.toISOString(),
			durationMs: finishedAt.getTime() - startedAt.getTime(),
			exitCode: null,
			signal: null,
			stdout: "",
			stderr: "",
			licenseRemoval,
			errorMessage: `.git removal failed: ${error instanceof Error ? error.message : String(error)}`,
		};
	}

	const result = await runGitCommand(command, targetPath);
	const finishedAt = new Date();
	return {
		status: result.exitCode === 0 ? "passed" : "failed",
		cwd: targetPath,
		command,
		gitDirPath,
		removedExistingGitDir,
		startedAt: startedAt.toISOString(),
		finishedAt: finishedAt.toISOString(),
		durationMs: finishedAt.getTime() - startedAt.getTime(),
		exitCode: result.exitCode,
		signal: result.signal,
		stdout: result.stdout,
		stderr: result.stderr,
		licenseRemoval,
		errorMessage: result.errorMessage,
	};
}

async function removeTemplateLicenseFile(
	targetPath: string,
): Promise<ProjectLicenseRemovalResult> {
	const licensePath = path.join(targetPath, "LICENSE.md");
	try {
		const exists = await pathExists(licensePath);
		if (!exists) {
			return { status: "not_found", path: licensePath };
		}
		await fs.rm(licensePath, { force: true });
		return { status: "removed", path: licensePath };
	} catch (error) {
		return {
			status: "failed",
			path: licensePath,
			errorMessage: error instanceof Error ? error.message : String(error),
		};
	}
}

function skippedLicenseRemoval(
	targetPath: string,
): ProjectLicenseRemovalResult {
	return {
		status: "skipped",
		path: path.join(targetPath, "LICENSE.md"),
	};
}

async function pathExists(targetPath: string) {
	return fs
		.stat(targetPath)
		.then(() => true)
		.catch((error: unknown) => {
			if (getDeepRecordString(error, "code") === "ENOENT") return false;
			throw error;
		});
}

async function initializeProject(input: {
	targetPath: string;
	manifest: ProjectManifestInspection;
	enabled: boolean;
	gitInitStatus: "passed" | "failed";
	requireBootstrap: boolean;
}): Promise<ProjectInitializationResult> {
	const initializationCommand = buildInitializationCommand(
		input.manifest,
		input.requireBootstrap,
	);
	const base = {
		cwd: input.targetPath,
		command: initializationCommand,
		startedAt: null,
		finishedAt: null,
		durationMs: null,
		exitCode: null,
		signal: null,
		stdout: "",
		stderr: "",
	};
	if (!input.enabled)
		return { ...base, status: "skipped", skippedReason: "disabled" };
	if (input.gitInitStatus !== "passed") {
		return { ...base, status: "skipped", skippedReason: "git_init_failed" };
	}
	if (input.manifest.status === "missing") {
		return { ...base, status: "skipped", skippedReason: "manifest_missing" };
	}
	if (input.manifest.status === "parse_failed") {
		return {
			...base,
			status: "skipped",
			skippedReason: "manifest_parse_failed",
		};
	}
	if (
		!initializationCommand &&
		input.requireBootstrap &&
		input.manifest.status === "found"
	) {
		return {
			...base,
			status: "failed",
			errorMessage: "Template manifest must define a bootstrap command.",
		};
	}
	if (!initializationCommand) {
		return {
			...base,
			status: "skipped",
			skippedReason: "unsupported_manifest",
		};
	}

	const startedAt = new Date();
	const result = await runInstallCommand(
		initializationCommand,
		input.targetPath,
	);
	const finishedAt = new Date();
	return {
		...base,
		status: result.exitCode === 0 ? "passed" : "failed",
		startedAt: startedAt.toISOString(),
		finishedAt: finishedAt.toISOString(),
		durationMs: finishedAt.getTime() - startedAt.getTime(),
		exitCode: result.exitCode,
		signal: result.signal,
		stdout: result.stdout,
		stderr: result.stderr,
		errorMessage: result.errorMessage,
	};
}

function buildInitializationCommand(
	manifest: ProjectManifestInspection,
	requireBootstrap: boolean,
) {
	if (manifest.makefile?.targets.includes("bootstrap")) {
		return ["make", "bootstrap"];
	}
	const packageManager = manifest.detectedPackageManager;
	if (!packageManager) return null;
	if (typeof manifest.packageJson?.scripts.bootstrap === "string") {
		return packageScriptCommandFor(packageManager, "bootstrap");
	}
	if (requireBootstrap) return null;
	return manifest.installCommand;
}

function runInstallCommand(command: string[], cwd: string) {
	const [file, ...args] = command;
	return new Promise<{
		exitCode: number | null;
		signal: string | null;
		stdout: string;
		stderr: string;
		errorMessage?: string;
	}>((resolve) => {
		execFile(
			file,
			args,
			{
				cwd,
				env: buildChildProcessEnvironment({ purpose: "workspace_bootstrap" }),
				timeout: INSTALL_TIMEOUT_MS,
				maxBuffer: INSTALL_MAX_BUFFER,
			},
			(error, stdout, stderr) => {
				const execError = error as
					| (Error & { code?: string | number; signal?: string | null })
					| null;
				const exitCode =
					typeof execError?.code === "number"
						? execError.code
						: error
							? null
							: 0;
				resolve({
					exitCode,
					signal: execError?.signal ?? null,
					stdout: String(stdout || ""),
					stderr: String(stderr || ""),
					errorMessage: error ? error.message : undefined,
				});
			},
		);
	});
}

async function createBaselineCommit(input: {
	targetPath: string;
	enabled: boolean;
	gitInitStatus: "passed" | "failed";
}): Promise<ProjectBaselineCommitResult> {
	const base = {
		cwd: input.targetPath,
		startedAt: null,
		finishedAt: null,
		durationMs: null,
		exitCode: null,
		signal: null,
		stdout: "",
		stderr: "",
	};
	if (!input.enabled) {
		return {
			...base,
			status: "skipped",
			skippedReason: "disabled",
			command: null,
		};
	}
	if (input.gitInitStatus !== "passed") {
		return {
			...base,
			status: "skipped",
			skippedReason: "git_init_failed",
			command: null,
		};
	}

	const status = await runGitCommand(
		["git", "status", "--porcelain"],
		input.targetPath,
	);
	if (status.exitCode !== 0) {
		return {
			...base,
			status: "failed",
			command: ["git", "status", "--porcelain"],
			exitCode: status.exitCode,
			signal: status.signal,
			stdout: status.stdout,
			stderr: status.stderr,
			errorMessage: status.errorMessage,
		};
	}
	if (status.stdout.trim().length === 0) {
		return {
			...base,
			status: "skipped",
			skippedReason: "nothing_to_commit",
			command: null,
		};
	}

	const add = await runGitCommand(["git", "add", "-A"], input.targetPath);
	if (add.exitCode !== 0) {
		return {
			...base,
			status: "failed",
			command: ["git", "add", "-A"],
			exitCode: add.exitCode,
			signal: add.signal,
			stdout: add.stdout,
			stderr: add.stderr,
			errorMessage: add.errorMessage,
		};
	}

	const command = [
		"git",
		"-c",
		"user.name=NightWorkers",
		"-c",
		"user.email=nightworkers@example.invalid",
		"commit",
		"-m",
		BASELINE_COMMIT_MESSAGE,
	];
	const startedAt = new Date();
	const commit = await runGitCommand(command, input.targetPath);
	const finishedAt = new Date();
	const commitHash =
		commit.exitCode === 0
			? (
					await runGitCommand(["git", "rev-parse", "HEAD"], input.targetPath)
				).stdout.trim() || undefined
			: undefined;

	return {
		...base,
		status: commit.exitCode === 0 ? "passed" : "failed",
		command,
		startedAt: startedAt.toISOString(),
		finishedAt: finishedAt.toISOString(),
		durationMs: finishedAt.getTime() - startedAt.getTime(),
		exitCode: commit.exitCode,
		signal: commit.signal,
		stdout: commit.stdout,
		stderr: commit.stderr,
		...(commitHash ? { commitHash } : {}),
		errorMessage: commit.errorMessage,
	};
}

function runGitCommand(command: string[], cwd: string) {
	const [file, ...args] = command;
	return new Promise<{
		exitCode: number | null;
		signal: string | null;
		stdout: string;
		stderr: string;
		errorMessage?: string;
	}>((resolve) => {
		execFile(
			file,
			args,
			{
				cwd,
				env: buildChildProcessEnvironment({ purpose: "git" }),
				timeout: command.includes("commit")
					? GIT_COMMIT_TIMEOUT_MS
					: GIT_INIT_TIMEOUT_MS,
				maxBuffer: command.includes("commit")
					? GIT_COMMIT_MAX_BUFFER
					: GIT_INIT_MAX_BUFFER,
			},
			(error, stdout, stderr) => {
				const execError = error as
					| (Error & { code?: string | number; signal?: string | null })
					| null;
				const exitCode =
					typeof execError?.code === "number"
						? execError.code
						: error
							? null
							: 0;
				resolve({
					exitCode,
					signal: execError?.signal ?? null,
					stdout: String(stdout || ""),
					stderr: String(stderr || ""),
					errorMessage: error ? error.message : undefined,
				});
			},
		);
	});
}

export { stringRecord } from "./project-post-import-inspection";
