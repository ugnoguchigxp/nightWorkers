import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	runHooks: vi.fn(),
	listTodos: vi.fn(),
	createRunEvent: vi.fn(),
}));

vi.mock("../api/services/hooks/hooks-runner", () => ({
	runAgentHooks: mocks.runHooks,
}));
vi.mock("../api/modules/nightworkers/nightworkers.runs.repository", () => ({
	listTaskRunTodosForRun: mocks.listTodos,
}));
vi.mock(
	"../api/modules/nightworkers/nightworkers.runs-event.repository",
	() => ({ createRunEvent: mocks.createRunEvent }),
);

import { configureCodingAgentHost } from "../api/modules/codingAgent/ports/coding-agent-host.binding";
import type { CodingAgentHostPorts } from "../api/modules/codingAgent/ports/coding-agent-host.port";
import { NativeAgentRuntime } from "../api/modules/codingAgent/runtime/NativeAgentRuntime";

function context(overrides: Record<string, unknown> = {}) {
	return {
		runId: "run-1",
		taskId: "task-1",
		repositoryId: "repo-1",
		repoRoot: "/repo",
		compiledPrompt: "compiled",
		latestUserMessage: "latest",
		...overrides,
	} as never;
}

function runner(overrides: Record<string, unknown> = {}) {
	return {
		run: vi.fn(async () => ({
			terminalState: "completed",
			summary: "done",
			finalReport: "report",
			stoppedBy: "completed",
			riskLevel: "low",
		})),
		stop: vi.fn(async () => undefined),
		suspendForHostShutdown: vi.fn(async () => undefined),
		...overrides,
	};
}

function hostFake(): CodingAgentHostPorts {
	return {
		taskReader: {
			getTask: async () => null,
			getRepository: async () => null,
			readArtifactContent: async () => null,
		},
		runReader: {
			getRun: async () => null,
			listRunTodos: mocks.listTodos,
		},
		runLifecycle: {
			startRun: async () => {
				throw new Error("not used");
			},
			resumeRunTodo: async () => {
				throw new Error("not used");
			},
			resumeInterruptedRun: async () => {
				throw new Error("not used");
			},
			updateRunContext: async () => ({ kind: "not_found" }),
		},
		runJournal: {
			appendRunEvent: mocks.createRunEvent,
			appendTaskMessage: async () => {},
			publishRun: async () => {},
			appendTaskEvent: async () => {},
		},
		verificationReader: {
			getLatestActiveDocument: async () => null,
			runCompletionCheck: async () => ({
				ok: false,
				reason: null,
				suggestedAction: null,
				sourceStateHash: null,
				verify: { status: "not_run" },
				confirmation: { status: "not_required" },
			}),
		},
	};
}

function nativeRuntime(testRunner: ReturnType<typeof runner>) {
	return new NativeAgentRuntime({
		runner: testRunner,
		runHooks: mocks.runHooks,
	});
}

describe("NativeAgentRuntime coverage", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		configureCodingAgentHost(hostFake());
		mocks.listTodos.mockResolvedValue([]);
		mocks.createRunEvent.mockResolvedValue(undefined);
		mocks.runHooks.mockResolvedValue({ decision: "allow" });
	});

	it("returns cancellation without opening hooks when already aborted", async () => {
		const controller = new AbortController();
		controller.abort();
		const runtime = nativeRuntime(runner());
		await expect(
			runtime.start(context(), { emit: vi.fn() }, controller.signal),
		).resolves.toMatchObject({
			terminalState: "cancelled",
			stoppedBy: "cancelled",
			logContent: "",
		});
		expect(mocks.runHooks).not.toHaveBeenCalled();
	});

	it("runs the full lifecycle and enriches object and primitive events with current Todo", async () => {
		mocks.listTodos.mockResolvedValue([
			{
				id: "later",
				seq: 3,
				title: "Later",
				status: "running",
				taskType: "test",
				procedureId: null,
			},
			{
				id: "current",
				seq: 1,
				title: "Current",
				status: "running",
				taskType: "implementation",
				procedureId: "p",
			},
			{ id: "done", seq: 0, title: "Done", status: "completed" },
		]);
		const testRunner = runner();
		testRunner.run.mockImplementation(async (_context, sink) => {
			await sink.emit({
				type: "tool_call_progress",
				message: "object",
				payload: { keep: true },
			});
			await sink.emit({
				type: "tool_call_progress",
				message: "primitive",
				payload: "value",
			});
			return {
				terminalState: "completed",
				summary: "done",
				finalReport: "report",
				stoppedBy: "completed",
				riskLevel: "low",
			};
		});
		const sink = { emit: vi.fn(async () => undefined) };
		const result = await nativeRuntime(testRunner).start(context(), sink);
		expect(result).toMatchObject({
			terminalState: "completed",
			logContent: expect.stringContaining("primitive"),
		});
		expect(sink.emit).toHaveBeenCalledWith(
			expect.objectContaining({
				payload: expect.objectContaining({ todoId: "current", keep: true }),
			}),
		);
		expect(sink.emit).toHaveBeenCalledWith(
			expect.objectContaining({
				payload: expect.objectContaining({
					todoId: "current",
					payload: "value",
				}),
			}),
		);
		expect(
			mocks.runHooks.mock.calls.map((call) => call[0].input.hook_event_name),
		).toEqual(["SessionStart", "UserPromptSubmit", "SessionEnd"]);
	});

	it("blocks the prompt with explicit and fallback reasons", async () => {
		for (const reason of ["blocked by policy", ""] as const) {
			mocks.runHooks.mockImplementation(async ({ input }) =>
				input.hook_event_name === "UserPromptSubmit"
					? { decision: "block", reason }
					: { decision: "allow" },
			);
			const testRunner = runner();
			const result = await nativeRuntime(testRunner).start(
				context({ latestUserMessage: "" }),
				{ emit: vi.fn() },
			);
			expect(result).toMatchObject({
				terminalState: "blocked",
				stoppedBy: "hook",
				finalReport: reason || "User prompt was blocked by an agent hook.",
			});
			expect(testRunner.run).not.toHaveBeenCalled();
		}
	});

	it("handles runner failures, Todo lookup failures, and SessionEnd hook errors", async () => {
		mocks.listTodos.mockRejectedValue(new Error("todo unavailable"));
		mocks.runHooks.mockImplementation(async ({ input }) => {
			if (input.hook_event_name === "SessionEnd")
				throw new Error("hook failed");
			return { decision: "allow" };
		});
		const testRunner = runner({
			run: vi.fn(async () => {
				throw new Error("runner failed");
			}),
		});
		const sink = { emit: vi.fn(async () => undefined) };
		const result = await nativeRuntime(testRunner).start(context(), sink);
		expect(result).toMatchObject({
			terminalState: "failed",
			summary: "Runtime failed: runner failed",
			logContent: expect.stringContaining("SessionEnd hook failed"),
		});
		expect(sink.emit).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "runtime_error",
				payload: { error: "runner failed" },
			}),
		);
	});

	it("normalizes non-Error runner and hook failures", async () => {
		mocks.runHooks.mockImplementation(async ({ input }) => {
			if (input.hook_event_name === "SessionEnd")
				throw { message: "hook object" };
			return { decision: "allow" };
		});
		const testRunner = runner({
			run: vi.fn(async () => {
				throw { message: "object failure" };
			}),
		});
		const result = await nativeRuntime(testRunner).start(context(), {
			emit: vi.fn(),
		});
		expect(result.summary).toBe("Runtime failed: object failure");
		expect(result.logContent).toContain("hook object");
	});

	it("delegates stop and host shutdown suspension", async () => {
		const testRunner = runner();
		const runtime = nativeRuntime(testRunner);
		await runtime.stop("run-1");
		await runtime.suspendForHostShutdown("run-2");
		expect(testRunner.stop).toHaveBeenCalledWith("run-1");
		expect(testRunner.suspendForHostShutdown).toHaveBeenCalledWith("run-2");
	});
});
