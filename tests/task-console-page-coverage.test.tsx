import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	activeTab: "log" as "log" | "diff",
	task: null as null | Record<string, unknown>,
	repository: null as null | Record<string, unknown>,
	runs: [] as Array<Record<string, unknown>>,
	runDetails: null as null | Record<string, unknown>,
	taskOperatorView: null as null | Record<string, unknown>,
	isTaskLoading: false,
	startMutation: { isPending: false, mutate: vi.fn() },
	reviewMutation: { isPending: false, mutate: vi.fn() },
	queryOptions: [] as Array<Record<string, unknown>>,
	reviewOptions: null as null | Record<string, unknown>,
	queryClient: { invalidateQueries: vi.fn() },
}));

function resetState() {
	state.activeTab = "log";
	state.task = {
		id: "task-123456789",
		repositoryId: "repo-1",
		status: "completed",
		title: "Implement coverage",
		description: "Add focused tests",
		compiledPrompt: "Run tests",
		timeoutSeconds: 60,
	};
	state.repository = { id: "repo-1", name: "NightWorkers", localPath: "/repo" };
	state.runs = [{ id: "run-1", status: "running" }];
	state.runDetails = null;
	state.taskOperatorView = {
		task: { revision: 7 },
		commandCatalog: { availableIds: ["run.implementation.start"] },
	};
	state.isTaskLoading = false;
	state.startMutation = { isPending: false, mutate: vi.fn() };
	state.reviewMutation = { isPending: false, mutate: vi.fn() };
	state.queryOptions = [];
	state.reviewOptions = null;
	state.queryClient.invalidateQueries.mockClear();
}

async function loadPage() {
	vi.resetModules();
	vi.doMock("react", async () => {
		const actual = await vi.importActual<typeof import("react")>("react");
		return {
			...actual,
			useState: () => [state.activeTab, vi.fn()] as const,
		};
	});
	vi.doMock("@tanstack/react-query", () => ({
		useQueryClient: () => state.queryClient,
		useMutation: (options: Record<string, unknown>) => {
			state.reviewOptions = options;
			return state.reviewMutation;
		},
		useQuery: (options: Record<string, unknown>) => {
			state.queryOptions.push(options);
			const key = (options.queryKey as unknown[])[0];
			if (key === "task")
				return { data: state.task, isLoading: state.isTaskLoading };
			if (key === "repository") return { data: state.repository };
			if (key === "taskRuns") return { data: state.runs };
			if (key === "taskOperatorView") return { data: state.taskOperatorView };
			if (key === "runDetails") return { data: state.runDetails };
			return { data: null };
		},
	}));
	vi.doMock("../src/modules/codingAgent", () => ({
		useCodingAgentCommandClient: () => ({ send: vi.fn() }),
		useCodingAgentCommandMutations: (options: Record<string, unknown>) => {
			(options.onFailure as () => unknown)();
			(options.onStartSuccess as () => unknown)();
			return { startRunMutation: state.startMutation };
		},
	}));
	vi.doMock("../src/modules/taskOperator", () => ({
		taskOperatorProjectionQueryOptions: (id: string) => ({
			queryKey: ["taskOperatorView", id],
			queryFn: vi.fn(),
		}),
	}));
	vi.doMock(
		"../src/modules/nightworkers/realtime/nightWorkersRealtimeConnection",
		() => ({
			getActiveNightWorkersRealtimeConnection: vi.fn(),
		}),
	);
	vi.doMock("../src/modules/nightworkers/nightWorkersCommands", () => ({
		apiPath: (path: string) => path,
	}));
	const client = {
		tasks: {
			":id": {
				$get: vi.fn(async () => ({ ok: true, json: async () => state.task })),
				runs: {
					$get: vi.fn(async () => ({ ok: true, json: async () => state.runs })),
				},
			},
		},
		repositories: {
			":id": {
				$get: vi.fn(async () => ({
					ok: true,
					json: async () => state.repository,
				})),
			},
		},
		runs: {
			":id": {
				$get: vi.fn(async () => ({
					ok: true,
					json: async () => state.runDetails,
				})),
			},
		},
	};
	vi.doMock("../src/lib/api", () => ({ client }));
	return {
		...(await import("../src/modules/nightworkers/components/TaskConsolePage")),
		client,
	};
}

function visit(node: ReactNode, callback: (element: ReactElement) => void) {
	if (Array.isArray(node)) {
		for (const child of node) visit(child, callback);
		return;
	}
	if (!node || typeof node !== "object" || !("props" in node)) return;
	const element = node as ReactElement<{ children?: ReactNode }>;
	callback(element);
	visit(element.props.children, callback);
}

function runEvent(
	id: string,
	eventType: string,
	payloadJson: unknown,
	overrides: Record<string, unknown> = {},
) {
	return {
		id,
		type: "checkpoint",
		actor: "worker",
		eventType,
		message: `${id} message`,
		payloadJson,
		timestamp: "2026-01-01T00:00:00.000Z",
		...overrides,
	};
}

describe("TaskConsolePage coverage", () => {
	it("renders loading when task data is pending or absent", async () => {
		resetState();
		state.isTaskLoading = true;
		let module = await loadPage();
		let html = renderToStaticMarkup(<module.TaskConsolePage id="task-1" />);
		expect(html).toContain("animate-spin");

		resetState();
		state.task = null;
		module = await loadPage();
		html = renderToStaticMarkup(<module.TaskConsolePage id="task-1" />);
		expect(html).toContain("animate-spin");
	});

	it("renders every log event card and invokes run actions", async () => {
		resetState();
		state.runDetails = {
			endedAt: "2026-01-01T01:00:00.000Z",
			logContent: "raw log",
			events: [
				runEvent("delta", "checkpoint", {
					runEvent: {
						type: "model.response_delta",
						data: { text: "streamed text" },
					},
				}),
				runEvent("delta-fallback", "checkpoint", {
					runEvent: { type: "model.response_delta", data: {} },
				}),
				runEvent(
					"supervisor",
					"supervisor_decision",
					{
						phase: "Review",
						rationale: "Need evidence",
						expectedEvidence: ["tests"],
					},
					{ actor: "supervisor", message: "[Supervisor Decision] Continue" },
				),
				runEvent(
					"supervisor-default",
					"supervisor_decision",
					{ expectedEvidence: "bad" },
					{ actor: "worker" },
				),
				runEvent("tool-call", "tool_call", {
					toolName: "run_command",
					arguments: { command: "bun test" },
				}),
				runEvent("tool-call-empty", "tool_call", { toolName: null }),
				runEvent("tool-success", "tool_result", {
					ok: true,
					toolName: "run",
					payload: {
						content: "\u001b[31mcontent\u001b[0m",
						stdout: "stdout",
						stderr: "stderr",
					},
					error: { message: "partial" },
				}),
				runEvent("tool-failed", "tool_result", {
					ok: false,
					toolName: "read",
					payload: [],
				}),
				runEvent("report", "final_report", {
					finalReport: "Finished",
					diffStat: "1 file changed",
				}),
				runEvent("report-fallback", "final_report", {}),
				runEvent("error", "error", {}, { type: "error" }),
				runEvent("normal", "checkpoint", null),
			],
		};
		const module = await loadPage();
		const element = module.TaskConsolePage({ id: "task-1" }) as ReactElement;
		const html = renderToStaticMarkup(element);
		expect(html).toContain("Implement coverage");
		expect(html).toContain("NightWorkers");
		expect(html).toContain("streamed text");
		expect(html).toContain("Supervisor: Phase Review");
		expect(html).toContain("Expected Evidence");
		expect(html).toContain("Worker: Running tool");
		expect(html).toContain("success");
		expect(html).toContain("failed");
		expect(html).toContain("Execution Final Report");
		expect(html).toContain("raw log");
		expect(html).toContain("Agent is working inside");

		visit(element, (child) => {
			const onClick = (child.props as Record<string, unknown>).onClick;
			if (typeof onClick === "function") (onClick as () => void)();
		});
		expect(state.startMutation.mutate).toHaveBeenCalledWith({
			taskId: "task-1",
			expectedTaskRevision: 7,
		});
		expect(state.queryClient.invalidateQueries).toHaveBeenCalled();
	});

	it("renders finalizing, empty log, and task text fallbacks", async () => {
		resetState();
		state.task = {
			...state.task,
			status: "finalizing",
			description: "",
			compiledPrompt: "",
		};
		state.repository = null;
		state.runs = [{ id: "run-1", status: "finalizing" }];
		state.runDetails = { events: [], logContent: "" };
		const module = await loadPage();
		const html = renderToStaticMarkup(<module.TaskConsolePage id="task-1" />);
		expect(html).toContain("No instruction description provided");
		expect(html).toContain("No runtime prompt snapshot yet");
		expect(html).toContain("No run logs generated yet");
		expect(html).toContain("Final judgment is being prepared");
		expect(html).not.toContain("Re-run Agent");
	});

	it("renders diff review actions, pending labels, and no-diff fallback", async () => {
		resetState();
		state.activeTab = "diff";
		state.runDetails = { diffPatch: "diff --git a/a.ts b/a.ts\n+change" };
		let module = await loadPage();
		const element = module.TaskConsolePage({ id: "task-1" }) as ReactElement;
		let html = renderToStaticMarkup(element);
		expect(html).toContain("Generated Git Patch");
		expect(html).toContain("Approve &amp; Merge Diff");
		visit(element, (child) => {
			const onClick = (child.props as Record<string, unknown>).onClick;
			if (typeof onClick === "function") (onClick as () => void)();
		});
		expect(state.reviewMutation.mutate).toHaveBeenCalledWith({
			action: "complete",
			note: "Approved and finalized",
		});
		expect(state.reviewMutation.mutate).toHaveBeenCalledWith({
			action: "cancel",
			note: "Discarded by user",
		});

		resetState();
		state.activeTab = "diff";
		state.reviewMutation = { isPending: true, mutate: vi.fn() };
		state.runDetails = { diffPatch: "patch" };
		module = await loadPage();
		html = renderToStaticMarkup(<module.TaskConsolePage id="task-1" />);
		expect(html).toContain("Completing...");
		expect(html).toContain("Discarding...");

		resetState();
		state.activeTab = "diff";
		state.runDetails = { diffPatch: "" };
		module = await loadPage();
		html = renderToStaticMarkup(<module.TaskConsolePage id="task-1" />);
		expect(html).toContain("No diff was generated");
	});

	it("guards a start without projection and exercises query/review request failures", async () => {
		resetState();
		state.taskOperatorView = null;
		const { TaskConsolePage } = await loadPage();
		const element = TaskConsolePage({ id: "task-1" }) as ReactElement;
		visit(element, (child) => {
			const onClick = (child.props as Record<string, unknown>).onClick;
			if (typeof onClick === "function") (onClick as () => void)();
		});
		expect(state.startMutation.mutate).not.toHaveBeenCalled();

		resetState();
		state.task = { ...state.task, repositoryId: null };
		state.runs = [];
		let guardModule = await loadPage();
		guardModule.TaskConsolePage({ id: "task-1" });
		const repositoryQuery = state.queryOptions.find(
			(option) => (option.queryKey as unknown[])[0] === "repository",
		)!;
		await expect(
			(repositoryQuery.queryFn as () => unknown)(),
		).resolves.toBeNull();

		const runQuery = state.queryOptions.find(
			(option) => (option.queryKey as unknown[])[0] === "runDetails",
		)!;
		await expect((runQuery.queryFn as () => unknown)()).resolves.toBeNull();

		resetState();
		guardModule = await loadPage();
		guardModule.TaskConsolePage({ id: "task-1" });
		const failingClient = guardModule.client;
		for (const mock of [
			failingClient.tasks[":id"].$get,
			failingClient.repositories[":id"].$get,
			failingClient.tasks[":id"].runs.$get,
			failingClient.runs[":id"].$get,
		]) {
			mock.mockResolvedValueOnce({ ok: false, json: vi.fn() } as never);
		}
		const queries = state.queryOptions.filter(
			(option) =>
				typeof option.queryFn === "function" &&
				(option.queryKey as unknown[])[0] !== "taskOperatorView",
		);
		for (const query of queries) {
			await expect((query.queryFn as () => unknown)()).rejects.toThrow(
				"Failed to fetch",
			);
		}
		const reviewOptions = state.reviewOptions;
		if (!reviewOptions) throw new Error("Expected review mutation options");

		vi.stubGlobal(
			"fetch",
			vi.fn(async () => ({ ok: false, json: vi.fn() })),
		);
		await expect(
			(reviewOptions.mutationFn as (input: unknown) => Promise<unknown>)({
				action: "cancel",
			}),
		).rejects.toThrow("Failed to submit review");
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) })),
		);
		await expect(
			(reviewOptions.mutationFn as (input: unknown) => Promise<unknown>)({
				action: "complete",
			}),
		).resolves.toEqual({ ok: true });
		(reviewOptions.onSuccess as () => void)();
		expect(state.queryClient.invalidateQueries).toHaveBeenCalled();
		vi.unstubAllGlobals();
	});
});
