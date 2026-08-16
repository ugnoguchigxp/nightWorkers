import { spawn } from "node:child_process";
import { buildChildProcessEnvironment } from "../../services/execution/child-process-environment";

export type GitCliFailureReason =
	| "git_not_found"
	| "git_probe_timed_out"
	| "git_probe_failed"
	| "git_command_timed_out"
	| "git_output_too_large"
	| "git_command_failed";

export class GitCliError extends Error {
	constructor(
		public readonly reason: GitCliFailureReason,
		message: string,
		public readonly stderr = "",
		public readonly exitCode: number | null = null,
		public readonly stdout = "",
	) {
		super(message);
		this.name = "GitCliError";
	}
}

export type GitCommandResult = {
	stdout: string;
	stderr: string;
	exitCode: number;
};

export type GitCommandOptions = {
	cwd?: string;
	timeoutMs?: number;
	maxOutputBytes?: number;
	executable?: string;
};

export type GitCommandRunner = (
	args: string[],
	options?: GitCommandOptions,
) => Promise<GitCommandResult>;

export const runGitCommand: GitCommandRunner = (args, options = {}) =>
	new Promise((resolve, reject) => {
		const timeoutMs = options.timeoutMs ?? 15_000;
		const maxOutputBytes = options.maxOutputBytes ?? 4 * 1024 * 1024;
		const child = spawn(
			options.executable || process.env.NIGHTWORKERS_GIT_EXECUTABLE || "git",
			args,
			{
				cwd: options.cwd,
				shell: false,
				stdio: ["ignore", "pipe", "pipe"],
				env: {
					...buildChildProcessEnvironment({
						purpose: "workspace_bootstrap",
					}),
					GIT_TERMINAL_PROMPT: "0",
				},
			},
		);
		const stdout: Buffer[] = [];
		const stderr: Buffer[] = [];
		let totalBytes = 0;
		let settled = false;
		let timedOut = false;
		let oversized = false;
		let escalationTimer: ReturnType<typeof setTimeout> | null = null;

		const terminate = () => {
			child.kill("SIGTERM");
			escalationTimer = setTimeout(() => {
				if (!settled) child.kill("SIGKILL");
			}, 1_000);
			escalationTimer.unref();
		};

		const finishWithError = (error: GitCliError) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			if (escalationTimer) clearTimeout(escalationTimer);
			reject(error);
		};
		const collect = (target: Buffer[], chunk: Buffer) => {
			totalBytes += chunk.byteLength;
			if (totalBytes > maxOutputBytes) {
				oversized = true;
				terminate();
				return;
			}
			target.push(chunk);
		};

		child.stdout.on("data", (chunk: Buffer) => collect(stdout, chunk));
		child.stderr.on("data", (chunk: Buffer) => collect(stderr, chunk));

		const timer = setTimeout(() => {
			timedOut = true;
			terminate();
		}, timeoutMs);
		timer.unref();

		child.on("error", (error: NodeJS.ErrnoException) => {
			finishWithError(
				new GitCliError(
					error.code === "ENOENT" ? "git_not_found" : "git_command_failed",
					error.message,
				),
			);
		});
		child.on("close", (code) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			if (escalationTimer) clearTimeout(escalationTimer);
			const stdoutText = Buffer.concat(stdout).toString("utf8");
			const stderrText = Buffer.concat(stderr).toString("utf8");
			if (timedOut) {
				reject(
					new GitCliError(
						"git_command_timed_out",
						`git command timed out after ${timeoutMs}ms`,
						stderrText,
						code,
						stdoutText,
					),
				);
				return;
			}
			if (oversized) {
				reject(
					new GitCliError(
						"git_output_too_large",
						`git command output exceeded ${maxOutputBytes} bytes`,
						stderrText,
						code,
						stdoutText,
					),
				);
				return;
			}
			if (code !== 0) {
				reject(
					new GitCliError(
						"git_command_failed",
						stderrText.trim() || `git exited with code ${code ?? "unknown"}`,
						stderrText,
						code,
						stdoutText,
					),
				);
				return;
			}
			resolve({ stdout: stdoutText, stderr: stderrText, exitCode: 0 });
		});
	});

export async function probeGit(
	runner: GitCommandRunner = runGitCommand,
): Promise<{
	available: boolean;
	version: string | null;
	reason: "git_not_found" | "git_probe_timed_out" | "git_probe_failed" | null;
}> {
	try {
		const result = await runner(["--version"], { timeoutMs: 5_000 });
		const version = result.stdout.trim();
		return version
			? { available: true, version, reason: null }
			: { available: false, version: null, reason: "git_probe_failed" };
	} catch (error) {
		if (error instanceof GitCliError) {
			return {
				available: false,
				version: null,
				reason:
					error.reason === "git_not_found"
						? "git_not_found"
						: error.reason === "git_command_timed_out"
							? "git_probe_timed_out"
							: "git_probe_failed",
			};
		}
		return { available: false, version: null, reason: "git_probe_failed" };
	}
}
