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
	taskError: null as Error | null,
	runsError: null as Error | null,
	runDetailsError: null as Error | null,
	refetchTask: vi.fn(),
	refetchRuns: vi.fn(),
	refetchRunDetails: vi.fn(),
	startMutation: { isPending: false, mutate: vi.fn() },
	reviewMutation: { isPending: false, mutate: vi.fn() },
	queryOptions: [] as Array<Record<string, unknown>>,
	reviewOptions: null as null | Record<string, unknown>,
	queryClient: { invalidateQueries: vi.fn() },
}));

const translations: Record<string, string> = {
	"taskConsole.notFound": "Task not found.",
	"taskConsole.id": "ID",
	"taskConsole.repository": "Repository",
	"taskConsole.status.completed": "Completed",
	"taskConsole.status.finalizing": "Finalizing",
	"taskConsole.loadFailed": "Failed to refresh task execution data.",
	"taskConsole.retry": "Retry",
	"taskConsole.rerun": "Re-run Agent",
	"taskConsole.goalInstructions": "Goal & Instructions",
	"taskConsole.noDescription": "No instruction description provided.",
	"taskConsole.runtimePrompt": "Runtime Prompt",
	"taskConsole.runtimePromptHelp": "Prompt snapshot used for execution:",
	"taskConsole.noPrompt":
		"(No runtime prompt snapshot yet. Run the agent first.)",
	"taskConsole.boundaries": "Execution Boundaries",
	"taskConsole.timeout": "Timeout",
	"taskConsole.safeMode": "Safe Mode",
	"taskConsole.commandBlocklists": "Command blocklists active",
	"taskConsole.memoryLoop": "Memory Loop",
	"taskConsole.postEvaluation": "Post-evaluation active",
	"taskConsole.logTab": "Agent Terminal Console",
	"taskConsole.diffTab": "Review Diffs",
	"taskConsole.monitoring": "LIVE MONITORING",
	"taskConsole.localWorkerActive": "SYSTEM: Native local worker active",
	"taskConsole.modelStream": "Model stream",
	"taskConsole.defaultPhase": "Plan",
	"taskConsole.supervisorPhase": "Supervisor: Phase {{phase}}",
	"taskConsole.rationale": "Rationale",
	"taskConsole.expectedEvidence": "Expected Evidence",
	"taskConsole.workerRunningTool": 'Worker: Running tool "{{toolName}}"',
	"taskConsole.workerToolResult": 'Worker: Tool "{{toolName}}" {{result}}',
	"taskConsole.toolSucceeded": "success",
	"taskConsole.toolFailed": "failed",
	"taskConsole.error": "Error",
	"taskConsole.finalReport": "Execution Final Report",
	"taskConsole.changeStats": "Change stats",
	"taskConsole.viewRawOutput": "View raw standard output",
	"taskConsole.approvedNote": "Approved and finalized",
	"taskConsole.discardedNote": "Discarded by user",
	"taskConsole.noLogs":
		'No run logs generated yet. Click "Run Agent" to begin execution.',
	"taskConsole.finalizing": "Final judgment is being prepared...",
	"taskConsole.working": "Agent is working inside the workspace sandbox...",
	"taskConsole.generatedPatch": "Generated Git Patch",
	"taskConsole.readyReview": "READY TO REVIEW",
	"taskConsole.approve": "Approve & Merge Diff",
	"taskConsole.completing": "Completing...",
	"taskConsole.discard": "Discard Diff",
	"taskConsole.discarding": "Discarding...",
	"taskConsole.noDiff":
		"No diff was generated. This run might be pending, running, or failed.",
};

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
	state.taskError = null;
	state.runsError = null;
	state.runDetailsError = null;
	state.refetchTask = vi.fn();
	state.refetchRuns = vi.fn();
	state.refetchRunDetails = vi.fn();
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
	vi.doMock("react-i18next", () => ({
		useTranslation: () => ({
			t: (key: string, values?: Record<string, unknown>) =>
				key === "taskConsole.ended"
					? `Ended: ${values?.time}`
					: (translations[key] ?? key)
							.replace("{{phase}}", String(values?.phase ?? ""))
							.replace("{{toolName}}", String(values?.toolName ?? ""))
							.replace("{{result}}", String(values?.result ?? "")),
		}),
	}));
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
				return {
					data: state.task,
					isLoading: state.isTaskLoading,
					isError: Boolean(state.taskError),
					error: state.taskError,
					refetch: state.refetchTask,
				};
			if (key === "repository") return { data: state.repository };
			if (key === "taskRuns")
				return {
					data: state.runs,
					isError: Boolean(state.runsError),
					error: state.runsError,
					refetch: state.refetchRuns,
				};
			if (key === "taskOperatorView") return { data: state.taskOperatorView };
			if (key === "runDetails")
				return {
					data: state.runDetails,
					isError: Boolean(state.runDetailsError),
					error: state.runDetailsError,
					refetch: state.refetchRunDetails,
				};
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
		reviewTaskRun: () => fetch("/api/runs/run-1/review"),
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
		expect(html).toContain("Task not found.");
	});

	it("renders every log event card", async () => {
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

	it("polls only active task and Run snapshots and retries every affected resource", async () => {
		resetState();
		state.runs = [{ id: "run-1", status: "completed" }];
		state.runDetails = { id: "run-1", status: "completed", events: [] };
		state.taskError = new Error("Task service unavailable");
		const module = await loadPage();
		const element = module.TaskConsolePage({ id: "task-1" }) as ReactElement;
		const html = renderToStaticMarkup(element);
		expect(html).toContain('role="alert"');
		expect(html).toContain("Task service unavailable");

		visit(element, (child) => {
			const onClick = (child.props as Record<string, unknown>).onClick;
			if (typeof onClick === "function") (onClick as () => void)();
		});
		expect(state.refetchTask).toHaveBeenCalledTimes(1);
		expect(state.refetchRuns).toHaveBeenCalledTimes(1);
		expect(state.refetchRunDetails).toHaveBeenCalledTimes(1);

		resetState();
		state.runs = [{ id: "run-1", status: "completed" }];
		state.runDetails = { id: "run-1", status: "completed", events: [] };
		const pollingModule = await loadPage();
		pollingModule.TaskConsolePage({ id: "task-1" });
		const polling = state.queryOptions.filter(
			(option) => typeof option.refetchInterval === "function",
		);
		expect(polling).toHaveLength(3);
		const [taskPolling, runsPolling, runDetailsPolling] = polling;
		if (!taskPolling || !runsPolling || !runDetailsPolling) {
			throw new Error("Expected terminal-aware polling options");
		}
		expect(
			(taskPolling.refetchInterval as (query: unknown) => unknown)({
				state: { data: { status: "completed" } },
			}),
		).toBe(false);
		expect(
			(taskPolling.refetchInterval as (query: unknown) => unknown)({
				state: { data: { status: "ready" } },
			}),
		).toBe(false);
		expect(
			(taskPolling.refetchInterval as (query: unknown) => unknown)({
				state: { data: { status: "verifying" } },
			}),
		).toBe(3000);
		expect(
			(runsPolling.refetchInterval as (query: unknown) => unknown)({
				state: { data: [{ status: "completed" }] },
			}),
		).toBe(false);
		expect(
			(runDetailsPolling.refetchInterval as (query: unknown) => unknown)({
				state: { data: { status: "verifying" } },
			}),
		).toBe(1500);
		expect(
			(runDetailsPolling.refetchInterval as (query: unknown) => unknown)({
				state: { data: { status: "completed" } },
			}),
		).toBe(false);
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
		);
		if (!repositoryQuery) throw new Error("Expected repository query");
		await expect(
			(repositoryQuery.queryFn as () => unknown)(),
		).resolves.toBeNull();

		const runQuery = state.queryOptions.find(
			(option) => (option.queryKey as unknown[])[0] === "runDetails",
		);
		if (!runQuery) throw new Error("Expected run details query");
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
			mock.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						error: { code: "TEST_FAILURE", message: "Failed to fetch" },
					}),
					{ status: 500, headers: { "content-type": "application/json" } },
				),
			);
		}
		const queries = state.queryOptions.filter(
			(option) =>
				typeof option.queryFn === "function" &&
				(option.queryKey as unknown[])[0] !== "taskOperatorView",
		);
		for (const query of queries) {
			await expect((query.queryFn as () => unknown)()).rejects.toMatchObject({
				code: "TEST_FAILURE",
				status: 500,
			});
		}
		const reviewOptions = state.reviewOptions;
		if (!reviewOptions) throw new Error("Expected review mutation options");

		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(
						JSON.stringify({
							error: {
								code: "REVIEW_FAILED",
								message: "Failed to submit review",
							},
						}),
						{ status: 500, headers: { "content-type": "application/json" } },
					),
			),
		);
		await expect(
			(reviewOptions.mutationFn as (input: unknown) => Promise<unknown>)({
				action: "cancel",
			}),
		).rejects.toMatchObject({ code: "REVIEW_FAILED", status: 500 });
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(JSON.stringify({ ok: true }), {
						status: 200,
						headers: { "content-type": "application/json" },
					}),
			),
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
