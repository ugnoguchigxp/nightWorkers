// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { buttonByLabel, clickDom, flushDom, mountDom } from "./dom-test-utils";

async function loadTaskConsole() {
	vi.resetModules();
	const refetchTask = vi.fn();
	const refetchRuns = vi.fn();
	const refetchRunDetails = vi.fn();
	const start = vi.fn();
	const queryOptions: Array<Record<string, unknown>> = [];
	const state = {
		error: new Error("Task execution is unavailable") as Error | null,
	};

	vi.doMock("react-i18next", () => ({
		useTranslation: () => ({ t: (key: string) => key }),
	}));
	vi.doMock("@tanstack/react-query", async () => {
		const actual = await vi.importActual<
			typeof import("@tanstack/react-query")
		>("@tanstack/react-query");
		return {
			...actual,
			useQueryClient: () => ({ invalidateQueries: vi.fn() }),
			useMutation: () => ({ isPending: false, mutate: vi.fn() }),
			useQuery: (options: Record<string, unknown>) => {
				queryOptions.push(options);
				const key = (options.queryKey as string[])[0];
				if (key === "task")
					return {
						data: state.error
							? null
							: {
									id: "task-1",
									repositoryId: "repo-1",
									status: "completed",
									title: "Run a behavior test",
									description: "Test the console",
								},
						isLoading: false,
						isError: Boolean(state.error),
						error: state.error,
						refetch: refetchTask,
					};
				if (key === "repository") return { data: { name: "NightWorkers" } };
				if (key === "taskRuns")
					return {
						data: [{ id: "run-1", status: "completed" }],
						isError: false,
						error: null,
						refetch: refetchRuns,
					};
				if (key === "runDetails")
					return {
						data: { id: "run-1", status: "completed", events: [] },
						isError: false,
						error: null,
						refetch: refetchRunDetails,
					};
				return {
					data: {
						task: { revision: 4 },
						commandCatalog: { availableIds: ["run.implementation.start"] },
					},
				};
			},
		};
	});
	vi.doMock("../src/modules/codingAgent", () => ({
		useCodingAgentCommandClient: () => ({ send: vi.fn() }),
		useCodingAgentCommandMutations: () => ({
			startRunMutation: { isPending: false, mutate: start },
		}),
	}));
	vi.doMock("../src/modules/taskOperator", () => ({
		taskOperatorProjectionQueryOptions: (taskId: string) => ({
			queryKey: ["taskOperatorView", taskId],
			queryFn: vi.fn(),
		}),
	}));
	vi.doMock(
		"../src/modules/nightworkers/realtime/nightWorkersRealtimeConnection",
		() => ({ getActiveNightWorkersRealtimeConnection: vi.fn() }),
	);
	vi.doMock("../src/modules/nightworkers/nightWorkersCommands", () => ({
		reviewTaskRun: vi.fn(),
	}));
	vi.doMock("../src/lib/api", () => ({
		client: {
			tasks: { ":id": { $get: vi.fn(), runs: { $get: vi.fn() } } },
			repositories: { ":id": { $get: vi.fn() } },
			runs: { ":id": { $get: vi.fn() } },
		},
	}));

	const { TaskConsolePage } = await import(
		"../src/modules/nightworkers/components/TaskConsolePage"
	);
	return {
		TaskConsolePage,
		queryOptions,
		refetchTask,
		refetchRuns,
		refetchRunDetails,
		start,
		setError(error: Error | null) {
			state.error = error;
		},
	};
}

describe("TaskConsolePage behavior", () => {
	afterEach(() => document.body.replaceChildren());

	it("renders an actionable query error, then recovers to a terminal console without resuming polling", async () => {
		const module = await loadTaskConsole();
		const screen = await mountDom(<module.TaskConsolePage id="task-1" />);
		expect(
			screen.container.querySelector('[role="alert"]')?.textContent,
		).toContain("Task execution is unavailable");
		await clickDom(buttonByLabel(screen.container, "taskConsole.retry"));
		expect(module.refetchTask).toHaveBeenCalledOnce();
		expect(module.refetchRuns).toHaveBeenCalledOnce();
		expect(module.refetchRunDetails).toHaveBeenCalledOnce();

		module.setError(null);
		await screen.rerender(<module.TaskConsolePage id="task-1" />);
		await flushDom();
		expect(screen.container.textContent).toContain("Run a behavior test");
		await clickDom(buttonByLabel(screen.container, "taskConsole.rerun"));
		expect(module.start).toHaveBeenCalledWith({
			taskId: "task-1",
			expectedTaskRevision: 4,
		});

		const taskPolling = module.queryOptions.find(
			(options) => (options.queryKey as string[])[0] === "task",
		)?.refetchInterval as (query: { state: { data: unknown } }) => unknown;
		const runPolling = module.queryOptions.find(
			(options) => (options.queryKey as string[])[0] === "runDetails",
		)?.refetchInterval as (query: { state: { data: unknown } }) => unknown;
		expect(taskPolling({ state: { data: { status: "completed" } } })).toBe(
			false,
		);
		expect(taskPolling({ state: { data: { status: "ready" } } })).toBe(false);
		expect(taskPolling({ state: { data: { status: "running" } } })).toBe(3000);
		expect(runPolling({ state: { data: { status: "completed" } } })).toBe(
			false,
		);
		await screen.unmount();
	});
});
