import { spawn } from "node:child_process";
import {
	isSecretEnvironmentKey,
	redactSecretText,
} from "../../../services/security/secret-redaction";
import type {
	WorkspaceBootstrapCommand,
	WorkspaceBootstrapComponent,
} from "./types";
import { WorkspaceBootstrapError } from "./types";

const MAX_OUTPUT_CHARS = 32_000;
const MAX_REDACTION_OVERLAP_CHARS = 64_000;

export type WorkspaceBootstrapProcessResult = {
	exitCode: number | null;
	stdout: string;
	stderr: string;
	timedOut: boolean;
	cancelled: boolean;
	spawnErrorCode?: string;
};

export async function runWorkspaceBootstrapCommand(input: {
	command: WorkspaceBootstrapCommand;
	cwd: string;
	signal?: AbortSignal;
	timeoutMs: number;
}): Promise<WorkspaceBootstrapProcessResult> {
	if (input.signal?.aborted) {
		throw new WorkspaceBootstrapError(
			"DEPENDENCY_INSTALL_CANCELLED",
			"Workspace dependency initialization was cancelled.",
			{ stage: "install", retryable: true },
		);
	}
	return new Promise((resolve, reject) => {
		let stdout = "";
		let stderr = "";
		let timedOut = false;
		let cancelled = false;
		let settled = false;
		let forceKillTimer: NodeJS.Timeout | undefined;
		let forceSettleTimer: NodeJS.Timeout | undefined;
		const child = spawn(input.command.executable, input.command.args, {
			cwd: input.cwd,
			env: input.command.env,
			shell: false,
			detached: process.platform !== "win32",
			stdio: ["ignore", "pipe", "pipe"],
		});
		const secretValues = Object.entries(input.command.env)
			.filter(([key]) => isSecretEnvironmentKey(key))
			.map(([, value]) => value);
		const rawOutputLimit =
			MAX_OUTPUT_CHARS +
			Math.min(
				MAX_REDACTION_OVERLAP_CHARS,
				Math.max(4_096, ...secretValues.map((value) => value.length)),
			);
		const append = (current: string, chunk: Buffer) =>
			`${current}${chunk.toString("utf8")}`.slice(-rawOutputLimit);
		child.stdout?.on("data", (chunk: Buffer) => {
			stdout = append(stdout, chunk);
		});
		child.stderr?.on("data", (chunk: Buffer) => {
			stderr = append(stderr, chunk);
		});
		const stop = (signal: NodeJS.Signals) => {
			if (!child.pid) return;
			try {
				if (process.platform !== "win32") process.kill(-child.pid, signal);
				else child.kill(signal);
			} catch {
				// The process may already have exited.
			}
		};
		const finish = (
			result: Omit<WorkspaceBootstrapProcessResult, "stdout" | "stderr">,
		) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			if (forceKillTimer) clearTimeout(forceKillTimer);
			if (forceSettleTimer) clearTimeout(forceSettleTimer);
			input.signal?.removeEventListener("abort", abort);
			const options = { secretValues };
			const completed = {
				...result,
				stdout: redactSecretText(stdout, options).slice(-MAX_OUTPUT_CHARS),
				stderr: redactSecretText(stderr, options).slice(-MAX_OUTPUT_CHARS),
			};
			if (timedOut) {
				reject(
					new WorkspaceBootstrapError(
						"DEPENDENCY_INSTALL_TIMEOUT",
						"Workspace dependency initialization timed out.",
						{
							stage: "install",
							retryable: true,
							redactedStdoutExcerpt: completed.stdout,
							redactedStderrExcerpt: completed.stderr,
						},
					),
				);
				return;
			}
			if (cancelled) {
				reject(
					new WorkspaceBootstrapError(
						"DEPENDENCY_INSTALL_CANCELLED",
						"Workspace dependency initialization was cancelled.",
						{
							stage: "install",
							retryable: true,
							redactedStdoutExcerpt: completed.stdout,
							redactedStderrExcerpt: completed.stderr,
						},
					),
				);
				return;
			}
			resolve(completed);
		};
		const terminate = (reason: "timeout" | "cancelled") => {
			if (settled || timedOut || cancelled) return;
			if (reason === "timeout") timedOut = true;
			else cancelled = true;
			stop("SIGTERM");
			forceKillTimer = setTimeout(() => stop("SIGKILL"), 2_000);
			forceKillTimer.unref();
			forceSettleTimer = setTimeout(
				() => finish({ exitCode: null, timedOut, cancelled }),
				3_000,
			);
			forceSettleTimer.unref();
		};
		const timeout = setTimeout(() => terminate("timeout"), input.timeoutMs);
		const abort = () => terminate("cancelled");
		input.signal?.addEventListener("abort", abort, { once: true });
		if (input.signal?.aborted) abort();
		child.on("error", (error: NodeJS.ErrnoException) => {
			finish({
				exitCode: null,
				timedOut,
				cancelled,
				spawnErrorCode: error.code,
			});
		});
		child.on("close", (exitCode) => {
			finish({ exitCode, timedOut, cancelled });
		});
	});
}

export function workspaceBootstrapCommandFailure(
	component: WorkspaceBootstrapComponent,
	result: WorkspaceBootstrapProcessResult,
) {
	const executableUnavailable = ["ENOENT", "EACCES"].includes(
		result.spawnErrorCode ?? "",
	);
	return new WorkspaceBootstrapError(
		executableUnavailable
			? "BOOTSTRAP_EXECUTABLE_NOT_FOUND"
			: "DEPENDENCY_INSTALL_FAILED",
		`Dependency initialization failed for ${component.rootRelativePath}.`,
		{
			stage: "install",
			adapterId: component.adapterId,
			componentRoot: component.rootRelativePath,
			exitCode: result.exitCode,
			retryable: !executableUnavailable,
			redactedStdoutExcerpt: result.stdout,
			redactedStderrExcerpt: result.stderr,
		},
	);
}
