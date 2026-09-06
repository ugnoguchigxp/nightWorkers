import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, expect, it, vi } from "vitest";
import { runCommandHook } from "../api/services/hooks/hooks-command";
import type {
	AgentHookConfig,
	AgentHookInput,
} from "../api/services/hooks/types";

const processMocks = vi.hoisted(() => ({ spawn: vi.fn(), execFile: vi.fn() }));
vi.mock("node:child_process", () => processMocks);
const platform = process.platform;
afterEach(() => {
	Object.defineProperty(process, "platform", { value: platform });
	vi.useRealTimers();
	vi.clearAllMocks();
});

it("waits for Windows tree termination after the parent closes and leaves no cleanup timer", async () => {
	Object.defineProperty(process, "platform", { value: "win32" });
	vi.useFakeTimers();
	const child = Object.assign(new EventEmitter(), {
		pid: 4242,
		stdin: new PassThrough(),
		stdout: new PassThrough(),
		stderr: new PassThrough(),
		kill: vi.fn(),
	});
	processMocks.spawn.mockReturnValue(child);
	const controller = new AbortController();
	const hook: AgentHookConfig = {
		id: "test",
		name: "test",
		event: "SessionStart",
		enabled: true,
		createdAt: "",
		updatedAt: "",
		handler: { type: "command", command: "hook.exe", args: ["--input"] },
	};
	const input: AgentHookInput = {
		hook_event_name: "SessionStart",
		source: "run_start",
		session_id: "session",
		run_id: "run",
		task_id: "task",
		cwd: process.cwd(),
		timestamp: "",
	};
	const running = runCommandHook(hook, input, undefined, controller.signal);
	let settled = false;
	void running.catch(() => {
		settled = true;
	});
	controller.abort();
	expect(processMocks.execFile).toHaveBeenCalledWith(
		"taskkill",
		["/pid", "4242", "/T", "/F"],
		{ windowsHide: true, timeout: 2000 },
		expect.any(Function),
	);
	child.emit("close", null, "SIGTERM");
	await Promise.resolve();
	expect(settled).toBe(false);
	processMocks.execFile.mock.calls[0][3](null, "", "");
	await expect(running).rejects.toThrow("cancelled");
	expect(vi.getTimerCount()).toBe(0);
	child.stdin.destroy();
	child.stdout.destroy();
	child.stderr.destroy();
});
