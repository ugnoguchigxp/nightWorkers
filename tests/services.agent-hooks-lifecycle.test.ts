import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCommandHook } from "../api/services/hooks/hooks-command";
import { runHttpHook } from "../api/services/hooks/hooks-http";
import { runAgentHooks } from "../api/services/hooks/hooks-runner";
import type {
	AgentHookConfig,
	AgentHookInput,
} from "../api/services/hooks/types";

const input: AgentHookInput = {
	hook_event_name: "PreToolUse",
	session_id: "session",
	run_id: "run",
	task_id: "task",
	cwd: process.cwd(),
	timestamp: new Date().toISOString(),
	tool_name: "run_command",
	tool_input: {},
	tool_use_id: "tool",
};
function command(
	script: string,
	timeoutSeconds = 5,
): AgentHookConfig & { source: string } {
	return {
		id: "lifecycle",
		name: "Lifecycle",
		enabled: true,
		event: "PreToolUse",
		createdAt: "",
		updatedAt: "",
		source: "codex_global",
		handler: {
			type: "command",
			command: process.execPath,
			args: ["-e", script],
			timeoutSeconds,
		},
	};
}

describe("Hook process lifecycle", () => {
	let directory: string;
	beforeEach(() => {
		directory = fs.mkdtempSync(path.join(os.tmpdir(), "hook-lifecycle-"));
	});
	afterEach(() => {
		for (const file of fs.readdirSync(directory)) {
			if (!file.endsWith(".pid")) continue;
			try {
				process.kill(
					Number(fs.readFileSync(path.join(directory, file), "utf8")),
					"SIGKILL",
				);
			} catch {}
		}
		fs.rmSync(directory, { recursive: true, force: true });
		vi.restoreAllMocks();
	});

	it("reports early stdin closure without an unhandled EPIPE", async () => {
		const result = await runAgentHooks({
			hooks: [command("process.exit(0)")],
			input: { ...input, tool_input: { content: "x".repeat(1024 * 1024) } },
		});
		expect(result).toMatchObject({ decision: "deny", runs: [{ ok: false }] });
		expect(result.runs[0]?.message).toMatch(/EPIPE|write|closed/i);
	});

	it.skipIf(process.platform === "win32")(
		"treats a signal exit as failure",
		async () => {
			await expect(
				runCommandHook(
					command(
						'process.stdin.resume(); process.kill(process.pid, "SIGTERM")',
					),
					input,
				),
			).rejects.toThrow("SIGTERM");
		},
	);

	it.skipIf(process.platform === "win32")(
		"escalates a timeout and waits until the process has exited",
		async () => {
			const marker = path.join(directory, "timeout.pid");
			const script = `process.stdin.resume(); process.on('SIGTERM', () => {}); require('node:fs').writeFileSync(${JSON.stringify(marker)}, String(process.pid)); setInterval(() => {}, 1000)`;
			await expect(runCommandHook(command(script, 1), input)).rejects.toThrow(
				"timed out",
			);
			const pid = Number(fs.readFileSync(marker, "utf8"));
			expect(() => process.kill(pid, 0)).toThrow();
		},
	);

	it.skipIf(process.platform === "win32")(
		"cancels a shell and its descendant before starting another hook",
		async () => {
			const marker = path.join(directory, "descendant.pid");
			const script = `process.stdin.resume(); process.on('SIGTERM', () => {}); require('node:fs').writeFileSync(${JSON.stringify(marker)}, String(process.pid)); setInterval(() => {}, 1000)`;
			const scriptPath = path.join(directory, "hook.cjs");
			fs.writeFileSync(scriptPath, script);
			const hook = command("");
			hook.handler = {
				type: "command",
				command: `"${process.execPath}" "${scriptPath}" & wait`,
				timeoutSeconds: 10,
			};
			const controller = new AbortController();
			const onEvent = vi.fn(async () => {});
			const result = runAgentHooks({
				hooks: [hook, command('console.log("second")')],
				input,
				signal: controller.signal,
				onEvent,
			});
			const assertion = expect(result).rejects.toThrow();
			await vi.waitFor(() => expect(fs.existsSync(marker)).toBe(true));
			controller.abort();
			await assertion;
			const pid = Number(fs.readFileSync(marker, "utf8"));
			await vi.waitFor(() => expect(() => process.kill(pid, 0)).toThrow());
			expect(
				onEvent.mock.calls.filter(([event]) => event.type === "hook.started"),
			).toHaveLength(1);
			expect(
				onEvent.mock.calls.some(([event]) => event.type === "hook.failed"),
			).toBe(true);
		},
	);

	it("does not start an already cancelled hook", async () => {
		const onEvent = vi.fn();
		await expect(
			runAgentHooks({
				hooks: [command("process.exit(0)")],
				input,
				signal: AbortSignal.abort(),
				onEvent,
			}),
		).rejects.toThrow();
		expect(onEvent).not.toHaveBeenCalled();
	});

	it.skipIf(process.platform === "win32")(
		"bounds pipe draining when a detached descendant inherits stdout",
		async () => {
			const marker = path.join(directory, "detached.pid");
			const script = `process.stdin.resume(); const child = require('node:child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: ['ignore', 1, 2] }); child.unref(); require('node:fs').writeFileSync(${JSON.stringify(marker)}, String(child.pid)); setInterval(() => {}, 1000)`;
			await expect(runCommandHook(command(script, 1), input)).rejects.toThrow(
				"timed out",
			);
			expect(fs.existsSync(marker)).toBe(true);
		},
	);

	it("rejects oversized output instead of accepting a truncated decision", async () => {
		await expect(
			runCommandHook(
				command(
					'process.stdin.resume(); process.stdout.write("あ".repeat(30000))',
				),
				input,
			),
		).rejects.toThrow("exceeded");
	});

	it("reports spawn failure and still runs a later hook", async () => {
		const missing = command("");
		missing.handler = {
			type: "command",
			command: path.join(directory, "missing"),
			args: ["argument"],
		};
		const result = await runAgentHooks({
			hooks: [missing, command('process.stdin.resume(); console.log("{}")')],
			input,
		});
		expect(result.runs.map((run) => run.ok)).toEqual([false, true]);
	});
});

describe("HTTP Hook lifecycle", () => {
	it.each([
		"abort",
		"timeout",
		"oversized",
	] as const)("stops reading the response on %s", async (mode) => {
		const controller = new AbortController();
		let responseClosed: Promise<void> | undefined;
		const server = http.createServer((_request, response) => {
			responseClosed = new Promise((resolve) =>
				response.once("close", resolve),
			);
			response.writeHead(200, { "Content-Type": "application/json" });
			response.write(mode === "oversized" ? "あ".repeat(30000) : "{");
			if (mode === "abort") controller.abort(new Error("user stopped"));
		});
		await new Promise<void>((resolve) =>
			server.listen(0, "127.0.0.1", resolve),
		);
		try {
			const address = server.address() as { port: number };
			const hook = command("");
			hook.handler = {
				type: "http",
				url: `http://127.0.0.1:${address.port}`,
				timeoutSeconds: 0.2,
			};
			await expect(runHttpHook(hook, input, controller.signal)).rejects.toThrow(
				mode === "abort"
					? "user stopped"
					: mode === "timeout"
						? "timed out"
						: "exceeded",
			);
			await responseClosed;
		} finally {
			server.closeAllConnections();
			await new Promise<void>((resolve) => server.close(() => resolve()));
		}
	});
});
