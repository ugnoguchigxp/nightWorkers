import { type ChildProcess, execFile, spawn } from "node:child_process";
import { buildChildProcessEnvironment } from "../execution/child-process-environment";
import {
	HOOK_DEFAULT_TIMEOUT_SECONDS,
	HOOK_OUTPUT_LIMIT_BYTES,
	type HookExecutionResult,
} from "./hooks-execution-contract";
import type { AgentHookConfig, AgentHookInput } from "./types";

const TERMINATION_GRACE_MS = 500;

export async function runCommandHook(
	hook: AgentHookConfig,
	input: AgentHookInput,
	repoRoot?: string,
	signal?: AbortSignal,
): Promise<HookExecutionResult> {
	signal?.throwIfAborted();
	if (hook.handler.type !== "command")
		throw new Error("Hook handler is not command.");
	const args = [...(hook.handler.args || [])];
	if (
		(hook as { source?: string }).source === "codex_global" &&
		hook.name === "Codex notify" &&
		input.hook_event_name === "SessionEnd"
	)
		args.push(JSON.stringify(input.payload ?? input));
	const stdin = `${JSON.stringify(input)}\n`;
	const child = spawn(hook.handler.command, args, {
		cwd: hook.handler.cwd || repoRoot || input.cwd || process.cwd(),
		env: buildChildProcessEnvironment({
			purpose: "hook",
			overrides: hook.handler.env,
		}),
		shell: args.length === 0,
		// Shell hooks and their children share a group so cancellation stops both.
		detached: process.platform !== "win32",
		stdio: ["pipe", "pipe", "pipe"],
	});
	return collectChildProcess(
		child,
		stdin,
		hook.handler.timeoutSeconds ?? HOOK_DEFAULT_TIMEOUT_SECONDS,
		signal,
	);
}

function collectChildProcess(
	child: ChildProcess,
	stdin: string,
	timeoutSeconds: number,
	signal?: AbortSignal,
): Promise<HookExecutionResult> {
	return new Promise((resolve, reject) => {
		const stdout: Buffer[] = [];
		const stderr: Buffer[] = [];
		let outputBytes = 0;
		let failure: Error | undefined;
		let closed = false;
		let forceKill: ReturnType<typeof setTimeout> | undefined;
		let drainTimeout: ReturnType<typeof setTimeout> | undefined;
		let treeStopped: Promise<void> | undefined;
		const forceTerminate = () => {
			killProcessGroup(child, "SIGKILL");
			// A detached descendant can keep inherited pipes open after the hook exits.
			// Bound draining as well as execution, while still waiting for child.close.
			drainTimeout = setTimeout(() => {
				child.stdin?.destroy();
				child.stdout?.destroy();
				child.stderr?.destroy();
			}, TERMINATION_GRACE_MS);
		};
		const terminate = (error: Error) => {
			if (failure || closed) return;
			failure = error;
			if (process.platform === "win32" && child.pid) {
				// Windows has no POSIX process groups. Stop the tree before its parent exits.
				treeStopped = new Promise((done) => {
					execFile(
						"taskkill",
						["/pid", String(child.pid), "/T", "/F"],
						{ windowsHide: true, timeout: 2000 },
						() => {
							if (!closed) forceTerminate();
							done();
						},
					);
				});
				return;
			}
			killProcessGroup(child, "SIGTERM");
			forceKill = setTimeout(forceTerminate, TERMINATION_GRACE_MS);
		};
		const abort = () =>
			terminate(
				new Error("Hook execution cancelled", { cause: signal?.reason }),
			);
		const timeout = setTimeout(
			() => terminate(new Error(`Hook timed out after ${timeoutSeconds}s`)),
			timeoutSeconds * 1000,
		);
		const collect = (target: Buffer[], chunk: Buffer) => {
			const remaining = HOOK_OUTPUT_LIMIT_BYTES - outputBytes;
			outputBytes += chunk.length;
			if (remaining > 0) target.push(chunk.subarray(0, remaining));
			if (outputBytes > HOOK_OUTPUT_LIMIT_BYTES)
				terminate(
					new Error(`Hook output exceeded ${HOOK_OUTPUT_LIMIT_BYTES} bytes`),
				);
		};
		child.stdout?.on("data", (chunk: Buffer) => collect(stdout, chunk));
		child.stderr?.on("data", (chunk: Buffer) => collect(stderr, chunk));
		child.stdout?.on("error", terminate);
		child.stderr?.on("error", terminate);
		// Install before writing: early stdin closure emits EPIPE asynchronously.
		child.stdin?.on("error", terminate);
		child.on("error", terminate);
		child.once("close", (code, exitSignal) => {
			closed = true;
			clearTimeout(timeout);
			clearTimeout(forceKill);
			clearTimeout(drainTimeout);
			signal?.removeEventListener("abort", abort);
			// A shell may exit on TERM before its descendants close. Reap its group.
			if (failure || exitSignal) killProcessGroup(child, "SIGKILL");
			if (failure) {
				if (treeStopped) void treeStopped.then(() => reject(failure));
				else reject(failure);
			} else if (exitSignal)
				reject(new Error(`Hook terminated by ${exitSignal}`));
			else if (code === null)
				reject(new Error("Hook exited without an exit code"));
			else
				resolve({
					stdout: Buffer.concat(stdout).toString("utf8"),
					stderr: Buffer.concat(stderr).toString("utf8"),
					exitCode: code,
				});
		});
		signal?.addEventListener("abort", abort, { once: true });
		if (signal?.aborted) abort();
		else child.stdin?.end(stdin);
	});
}

function killProcessGroup(child: ChildProcess, signal: NodeJS.Signals) {
	try {
		if (process.platform !== "win32" && child.pid)
			process.kill(-child.pid, signal);
		else child.kill(signal);
	} catch (error) {
		// A group may already have exited between the close and abort events.
		if ((error as NodeJS.ErrnoException).code !== "ESRCH") child.kill(signal);
	}
}
