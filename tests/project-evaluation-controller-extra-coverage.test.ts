import { beforeEach, describe, expect, it, vi } from "vitest";

type Effect = () => undefined | (() => void);

let stateSlots: unknown[] = [];
let stateCursor = 0;
let effects: Effect[] = [];
let sessionsCache: unknown[] = [];
let intervalCallback: (() => void) | null = null;

const queryClient = {
	setQueryData: vi.fn((_: unknown, value: unknown) => {
		sessionsCache =
			typeof value === "function"
				? (value as (current: unknown[]) => unknown[])(sessionsCache)
				: (value as unknown[]);
		return sessionsCache;
	}),
	invalidateQueries: vi.fn(async () => undefined),
};
const api = {
	createTasks: vi.fn(),
	fetchActivity: vi.fn(),
	fetchDetail: vi.fn(),
	fetchHistory: vi.fn(),
	generateImprovements: vi.fn(),
	startEvaluation: vi.fn(),
};

function response(
	value: unknown,
	options: { ok?: boolean; statusText?: string; text?: string } = {},
) {
	return {
		ok: options.ok ?? true,
		statusText: options.statusText ?? "Bad Request",
		json: vi.fn(async () => value),
		text: vi.fn(async () => options.text ?? "plain failure"),
	} as Response;
}

function brokenJsonResponse(text = "broken json") {
	return {
		ok: false,
		statusText: "Bad Response",
		json: vi.fn(async () => {
			throw new Error("not json");
		}),
		text: vi.fn(async () => text),
	} as unknown as Response;
}

function evaluation(id: string, status = "completed") {
	return { id, repositoryId: "repo-1", status, createdAt: id, updatedAt: id };
}

function event(
	id: string,
	seq: number,
	createdAt = `2026-08-09T00:00:0${seq}.000Z`,
) {
	return { id, evaluationId: "evaluation-1", seq, createdAt, type: "info" };
}

function detail(
	id = "evaluation-1",
	status = "completed",
	overrides: Record<string, unknown> = {},
) {
	return {
		evaluation: evaluation(id, status),
		scores: [],
		improvements: [],
		taskLinks: [],
		activityEvents: [],
		...overrides,
	};
}

async function createHarness(initialState: unknown[] = []) {
	stateSlots = [...initialState];
	stateCursor = 0;
	effects = [];
	sessionsCache = [];
	intervalCallback = null;
	queryClient.setQueryData.mockClear();
	queryClient.invalidateQueries.mockClear();
	for (const mock of Object.values(api)) mock.mockReset();
	vi.resetModules();
	vi.doMock("react", async () => {
		const actual = await vi.importActual<typeof import("react")>("react");
		return {
			...actual,
			useCallback: <T extends (...args: never[]) => unknown>(callback: T) =>
				callback,
			useEffect: (effect: Effect) => effects.push(effect),
			useMemo: <T>(factory: () => T) => factory(),
			useState: <T>(initial: T | (() => T)) => {
				const index = stateCursor++;
				if (stateSlots.length <= index) {
					stateSlots[index] =
						typeof initial === "function" ? (initial as () => T)() : initial;
				}
				const setter = vi.fn((next: T | ((current: T) => T)) => {
					stateSlots[index] =
						typeof next === "function"
							? (next as (current: T) => T)(stateSlots[index] as T)
							: next;
				});
				return [stateSlots[index] as T, setter] as const;
			},
		};
	});
	vi.doMock("@tanstack/react-query", () => ({
		useQueryClient: () => queryClient,
	}));
	vi.doMock(
		"../src/modules/project-evaluation/api/projectEvaluationCommands",
		() => ({
			createProjectEvaluationTasks: api.createTasks,
			fetchProjectEvaluationActivityEvents: api.fetchActivity,
			fetchProjectEvaluationDetail: api.fetchDetail,
			fetchProjectEvaluationHistory: api.fetchHistory,
			generateProjectImprovements: api.generateImprovements,
			startProjectEvaluation: api.startEvaluation,
		}),
	);
	vi.stubGlobal("window", {
		setInterval: vi.fn((callback: () => void) => {
			intervalCallback = callback;
			return 7;
		}),
		clearInterval: vi.fn(),
	});
	const module = await import(
		"../src/modules/project-evaluation/hooks/useProjectEvaluationController"
	);
	return {
		...module,
		useController(
			repositoryId = "repo-1",
			onTasksCreated?: (tasks: unknown[]) => Promise<void> | void,
		) {
			stateCursor = 0;
			effects = [];
			return module.useProjectEvaluationController(repositoryId, {
				onTasksCreated: onTasksCreated as never,
			});
		},
	};
}

async function flushPromises() {
	for (let index = 0; index < 12; index += 1) await Promise.resolve();
}

describe("useProjectEvaluationController extra coverage", () => {
	beforeEach(() => vi.restoreAllMocks());

	it("merges created tasks without duplicates and preserves empty input identity", async () => {
		const harness = await createHarness();
		const current = [
			{ id: "one", title: "old one" },
			{ id: "two", title: "two" },
		];
		expect(
			harness.mergeCreatedProjectEvaluationTasks(current as never, []),
		).toBe(current);
		expect(
			harness.mergeCreatedProjectEvaluationTasks(
				current as never,
				[
					{ id: "one", title: "new one" },
					{ id: "three", title: "three" },
				] as never,
			),
		).toEqual([
			{ id: "one", title: "new one" },
			{ id: "three", title: "three" },
			{ id: "two", title: "two" },
		]);
	});

	it("refreshes empty, completed, and running history states", async () => {
		const harness = await createHarness();
		let controller = harness.useController();
		api.fetchHistory.mockResolvedValueOnce(response([]));
		effects[0]();
		await flushPromises();
		expect(stateSlots[0]).toEqual([]);
		expect(stateSlots[1]).toBeNull();
		expect(stateSlots[5]).toBe(false);

		api.fetchHistory.mockResolvedValueOnce(
			response([evaluation("evaluation-1")]),
		);
		api.fetchDetail.mockResolvedValueOnce(response(detail()));
		controller = harness.useController();
		effects[0]();
		await flushPromises();
		expect(stateSlots[1]).toEqual(detail());
		expect(stateSlots[3]).toEqual(new Set());
		expect(stateSlots[4]).toEqual(new Set());

		api.fetchHistory.mockResolvedValueOnce(
			response([evaluation("evaluation-running", "running")]),
		);
		api.fetchDetail.mockResolvedValueOnce(
			response(detail("evaluation-running", "running")),
		);
		controller = harness.useController();
		effects[0]();
		await flushPromises();
		expect(stateSlots[6]).toBe(true);
		expect(stateSlots[2]).toBe("evaluation-running");
		expect(controller.isLoading).toBe(false);
	});

	it("reports JSON error, message, status, text, and non-Error refresh failures", async () => {
		const harness = await createHarness();
		harness.useController();
		const refreshEffect = effects[0];
		const failures = [
			response({ error: "error body" }, { ok: false }),
			response({ message: "message body" }, { ok: false }),
			response({}, { ok: false, statusText: "status text" }),
			brokenJsonResponse("text body"),
		];
		for (const failure of failures) {
			api.fetchHistory.mockResolvedValueOnce(failure);
			refreshEffect();
			await flushPromises();
		}
		expect(stateSlots[9]).toBe("text body");

		api.fetchHistory.mockRejectedValueOnce("string failure");
		refreshEffect();
		await flushPromises();
		expect(stateSlots[9]).toBe("string failure");
	});

	it("starts and selects evaluations through success and failure paths", async () => {
		const harness = await createHarness();
		let controller = harness.useController();
		api.startEvaluation.mockResolvedValueOnce(
			response({
				evaluationId: "evaluation-started",
				detail: detail("evaluation-started", "running"),
			}),
		);
		api.fetchHistory.mockResolvedValueOnce(
			response([evaluation("evaluation-started", "running")]),
		);
		await controller.runEvaluation();
		expect(stateSlots[1]).toEqual(detail("evaluation-started", "running"));
		expect(stateSlots[2]).toBe("evaluation-started");
		expect(stateSlots[0]).toHaveLength(1);

		api.startEvaluation.mockRejectedValueOnce("start string");
		await controller.runEvaluation();
		expect(stateSlots[9]).toBe("start string");
		expect(stateSlots[6]).toBe(false);
		expect(stateSlots[2]).toBeNull();

		api.fetchDetail.mockResolvedValueOnce(
			response(detail("evaluation-selected", "running")),
		);
		await controller.selectEvaluation("evaluation-selected");
		expect(stateSlots[6]).toBe(true);
		expect(stateSlots[2]).toBe("evaluation-selected");
		api.fetchDetail.mockResolvedValueOnce(response(detail("completed")));
		await controller.selectEvaluation("completed");
		api.fetchDetail.mockRejectedValueOnce("select string");
		await controller.selectEvaluation("bad");
		expect(stateSlots[9]).toBe("select string");

		controller = harness.useController();
		expect(controller.isViewingRunningEvaluation).toBe(false);
	});

	it("generates ideas only with a detail and selected dimensions", async () => {
		const harness = await createHarness();
		let controller = harness.useController();
		await controller.generateIdeas();
		expect(api.generateImprovements).not.toHaveBeenCalled();

		stateSlots[1] = detail("evaluation-1", "completed", {
			improvements: [{ id: "old" }],
		});
		stateSlots[3] = new Set(["maintainability"]);
		controller = harness.useController();
		api.generateImprovements.mockResolvedValueOnce(
			response({ ideas: [{ id: "idea-new" }] }),
		);
		api.fetchDetail.mockResolvedValueOnce(
			response(detail("evaluation-1", "completed", { improvements: [] })),
		);
		await controller.generateIdeas();
		expect(api.generateImprovements).toHaveBeenCalledWith("evaluation-1", {
			dimensionKeys: ["maintainability"],
		});
		expect(stateSlots[1]).toMatchObject({ improvements: [{ id: "idea-new" }] });
		expect(stateSlots[8]).toBe(false);

		api.generateImprovements.mockRejectedValueOnce("generate string");
		await controller.generateIdeas();
		expect(stateSlots[9]).toBe("generate string");
		expect(stateSlots[7]).toBe(false);
	});

	it("creates tasks, updates caches, invokes optional callbacks, and toggles ideas", async () => {
		const harness = await createHarness();
		let controller = harness.useController();
		await controller.createTasks();
		expect(api.createTasks).not.toHaveBeenCalled();

		stateSlots[1] = detail("evaluation-1", "completed", {
			taskLinks: [],
		});
		stateSlots[4] = new Set(["idea-1"]);
		sessionsCache = [{ id: "old" }, { id: "task-new", title: "old title" }];
		const onTasksCreated = vi.fn(async () => undefined);
		controller = harness.useController("repo-1", onTasksCreated);
		api.createTasks.mockResolvedValueOnce(
			response({
				tasks: [{ id: "task-new", title: "new title" }],
				taskLinks: [{ id: "link-1" }],
			}),
		);
		await controller.createTasks();
		expect(api.createTasks).toHaveBeenCalledWith("evaluation-1", {
			ideaIds: ["idea-1"],
			mode: "draft",
		});
		expect(sessionsCache).toEqual([
			{ id: "task-new", title: "new title" },
			{ id: "old" },
		]);
		expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(2);
		expect(onTasksCreated).toHaveBeenCalledWith([
			{ id: "task-new", title: "new title" },
		]);
		expect(stateSlots[8]).toBe(false);

		controller.toggleIdea("idea-2");
		expect(stateSlots[4]).toEqual(new Set(["idea-2"]));
		controller = harness.useController();
		controller.toggleIdea("idea-2");
		expect(stateSlots[4]).toEqual(new Set());

		stateSlots[4] = new Set(["idea-1"]);
		controller = harness.useController();
		api.createTasks.mockRejectedValueOnce("tasks string");
		await controller.createTasks();
		expect(stateSlots[9]).toBe("tasks string");
	});

	it("polls, merges, sorts, completes, catches, and cancels activity replays", async () => {
		const currentDetail = detail("evaluation-1", "running", {
			activityEvents: [event("existing", 2)],
		});
		const harness = await createHarness([
			[evaluation("evaluation-1", "running")],
			currentDetail,
			"evaluation-1",
			new Set(),
			new Set(),
			false,
			true,
			false,
			false,
			null,
		]);
		harness.useController();
		api.fetchActivity.mockResolvedValueOnce(
			response({
				status: "running",
				events: [
					event("later", 3, "2026-08-09T00:00:04.000Z"),
					event("earlier", 1, "2026-08-09T00:00:01.000Z"),
					event("existing", 2, "2026-08-09T00:00:03.000Z"),
				],
			}),
		);
		const cleanup = effects[1]();
		await flushPromises();
		expect(api.fetchActivity).toHaveBeenCalledWith("evaluation-1", 2);
		expect(
			(stateSlots[1] as ReturnType<typeof detail>).activityEvents.map(
				(item: { id: string }) => item.id,
			),
		).toEqual(["earlier", "existing", "later"]);
		expect(intervalCallback).toBeTypeOf("function");

		api.fetchActivity.mockResolvedValueOnce(
			response({ status: "running", events: [] }),
		);
		intervalCallback?.();
		await flushPromises();
		expect((stateSlots[1] as ReturnType<typeof detail>).evaluation.status).toBe(
			"running",
		);

		api.fetchActivity.mockResolvedValueOnce(
			response({ status: "completed", events: [] }),
		);
		api.fetchDetail.mockResolvedValueOnce(
			response(detail("evaluation-1", "completed")),
		);
		api.fetchHistory.mockResolvedValueOnce(
			response([evaluation("evaluation-1", "completed")]),
		);
		intervalCallback?.();
		await flushPromises();
		expect(stateSlots[6]).toBe(false);
		expect(stateSlots[2]).toBeNull();

		cleanup?.();
		expect(window.clearInterval).toHaveBeenCalledWith(7);

		stateSlots[2] = "evaluation-1";
		harness.useController();
		api.fetchActivity.mockRejectedValueOnce("poll string");
		effects[1]();
		await flushPromises();
		expect(stateSlots[9]).toBe("poll string");
		expect(stateSlots[6]).toBe(false);

		let resolveReplay: ((value: Response) => void) | undefined;
		api.fetchActivity.mockImplementationOnce(
			() =>
				new Promise<Response>((resolve) => {
					resolveReplay = resolve;
				}),
		);
		stateSlots[2] = "evaluation-1";
		harness.useController();
		const cancel = effects[1]();
		cancel?.();
		resolveReplay?.(response({ status: "running", events: [] }));
		await flushPromises();
	});

	it("derives previous evaluation and running-view flags", async () => {
		const harness = await createHarness([
			[evaluation("new"), evaluation("old")],
			detail("new", "running"),
			"new",
		]);
		let controller = harness.useController();
		expect(controller.previousEvaluation?.id).toBe("old");
		expect(controller.isViewingRunningEvaluation).toBe(true);
		expect(controller.activityEvents).toEqual([]);

		stateSlots[1] = detail("missing");
		controller = harness.useController();
		expect(controller.previousEvaluation).toBeNull();
		stateSlots[1] = null;
		controller = harness.useController();
		expect(controller.previousEvaluation).toBeNull();
		expect(controller.activityEvents).toEqual([]);
	});
});
