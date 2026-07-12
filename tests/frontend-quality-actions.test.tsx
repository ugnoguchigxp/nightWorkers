import { describe, expect, it, vi } from "vitest";

const coverageRun = {
	id: "run-1",
	repositoryId: "repo-1",
	runType: "unit" as const,
	status: "completed" as const,
	command: "bun run test",
	exitCode: 0,
	startedAt: "2026-07-10T00:00:00.000Z",
	completedAt: "2026-07-10T00:01:00.000Z",
	outputArtifactId: null,
	latestOutput: "ok",
	coverageSummary: {
		total: { lines: { pct: 80 } },
		"src/example.ts": { lines: { pct: 60 }, uncoveredLines: [10] },
	},
	e2eSummary: null,
	errorMessage: null,
	createdAt: "2026-07-10T00:00:00.000Z",
	updatedAt: "2026-07-10T00:01:00.000Z",
};

const quality = {
	capabilities: {
		projectType: "typescript" as const,
		unit: { runnable: true, missingCapabilities: [], command: "bun run test" },
		coverage: {
			runnable: true,
			missingCapabilities: [],
			command: "bun run test:coverage",
		},
		e2e: { runnable: false, missingCapabilities: ["e2e"] },
		all: { runnable: false, missingCapabilities: ["e2e"] },
	},
	latestUnitRun: coverageRun,
	latestE2eRun: null,
	latestCoverageRun: coverageRun,
	latestE2eResultRun: null,
	latestAllRun: null,
	recentRuns: [coverageRun],
	runningRuns: [],
};

function response(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

async function loadController(taskResponse: Response) {
	vi.resetModules();
	const setters: Array<ReturnType<typeof vi.fn>> = [];
	const refs: Array<{ current: unknown }> = [];
	const stateValues: unknown[] = [quality, ["src/example.ts"], null, "", ""];
	vi.doMock("react", async () => {
		const actual = await vi.importActual<typeof import("react")>("react");
		return {
			...actual,
			useCallback: <T extends (...args: never[]) => unknown>(callback: T) =>
				callback,
			useEffect: () => undefined,
			useMemo: <T,>(factory: () => T) => factory(),
			useRef: <T,>(initial: T) => {
				const ref = { current: initial };
				refs.push(ref);
				return ref;
			},
			useState: <T,>(initial: T) => {
				const value =
					stateValues.length > 0 ? (stateValues.shift() as T) : initial;
				const setter = vi.fn();
				setters.push(setter);
				return [value, setter] as const;
			},
		};
	});
	const commands = {
		fetchProjectQuality: vi.fn(async () => response(quality)),
		createProjectQualityRun: vi.fn(async () => response(coverageRun, 201)),
		createCoverageImprovementTask: vi.fn(async () => taskResponse),
	};
	vi.doMock("../src/modules/quality/api/qualityCommands", () => commands);
	const module = await import(
		"../src/modules/quality/hooks/useProjectQualityController"
	);
	return { ...module, commands, refs, setters };
}

describe("useProjectQualityController", () => {
	it("creates a draft task from the selected raw coverage key", async () => {
		const task = { id: "task-1", title: "Coverage", status: "draft" };
		const { useProjectQualityController, commands, setters } =
			await loadController(response({ task }, 201));
		const onTasksCreated = vi.fn();
		const controller = useProjectQualityController({
			repositoryId: "repo-1",
			projectRoot: "/repo",
			onTasksCreated,
		});

		await controller.createTask();

		expect(commands.createCoverageImprovementTask).toHaveBeenCalledWith(
			"repo-1",
			"run-1",
			{ fileKeys: ["src/example.ts"] },
		);
		expect(onTasksCreated).toHaveBeenCalledWith([task]);
		expect(setters[1]).toHaveBeenCalledWith([]);
	});

	it("refreshes instead of creating a session callback for a stale run", async () => {
		const { useProjectQualityController, commands, setters } =
			await loadController(response({ error: { message: "stale" } }, 409));
		const onTasksCreated = vi.fn();
		const controller = useProjectQualityController({
			repositoryId: "repo-1",
			projectRoot: "/repo",
			onTasksCreated,
		});

		await controller.createTask();

		expect(commands.fetchProjectQuality).toHaveBeenCalled();
		expect(onTasksCreated).not.toHaveBeenCalled();
		expect(setters[1]).toHaveBeenCalledWith([]);
	});

	it("keeps the selection available when task creation fails", async () => {
		const { useProjectQualityController, setters } = await loadController(
			response({ error: { message: "temporary failure" } }, 500),
		);
		const controller = useProjectQualityController({
			repositoryId: "repo-1",
			projectRoot: "/repo",
		});

		await controller.createTask();

		expect(setters[1]).not.toHaveBeenCalledWith([]);
		expect(setters[3]).toHaveBeenCalledWith("temporary failure");
	});

	it("does not report a saved task as creation failure when refresh fails", async () => {
		const task = { id: "task-1", title: "Coverage", status: "draft" };
		const { useProjectQualityController, setters } = await loadController(
			response({ task }, 201),
		);
		const controller = useProjectQualityController({
			repositoryId: "repo-1",
			projectRoot: "/repo",
			onTasksCreated: async () => {
				throw new Error("task list refresh failed");
			},
		});

		await controller.createTask();

		expect(setters[1]).toHaveBeenCalledWith([]);
		expect(setters[4]).toHaveBeenCalledWith("Draft Taskを作成しました");
		expect(setters[3]).toHaveBeenCalledWith(
			"Draft Taskは作成されましたが、画面の更新に失敗しました。再読み込みしてください",
		);
	});

	it("suppresses a second request while task creation is in flight", async () => {
		let resolveRequest: ((value: Response) => void) | undefined;
		const pendingResponse = new Promise<Response>((resolve) => {
			resolveRequest = resolve;
		});
		const { useProjectQualityController, commands } = await loadController(
			response({}, 500),
		);
		commands.createCoverageImprovementTask.mockImplementation(
			async () => pendingResponse,
		);
		const controller = useProjectQualityController({
			repositoryId: "repo-1",
			projectRoot: "/repo",
		});

		const firstRequest = controller.createTask();
		await controller.createTask();
		expect(commands.createCoverageImprovementTask).toHaveBeenCalledTimes(1);

		resolveRequest?.(response({ task: { id: "task-1" } }, 201));
		await firstRequest;
	});

	it("ignores an old task response after the repository changes", async () => {
		let resolveRequest: ((value: Response) => void) | undefined;
		const pendingResponse = new Promise<Response>((resolve) => {
			resolveRequest = resolve;
		});
		const { useProjectQualityController, commands, refs, setters } =
			await loadController(response({}, 500));
		commands.createCoverageImprovementTask.mockImplementation(
			async () => pendingResponse,
		);
		const onTasksCreated = vi.fn();
		const controller = useProjectQualityController({
			repositoryId: "repo-1",
			projectRoot: "/repo",
			onTasksCreated,
		});

		const request = controller.createTask();
		const actionGenerationRef = refs.at(-2);
		const repositoryIdRef = refs.at(-1);
		expect(actionGenerationRef).toBeDefined();
		expect(repositoryIdRef).toBeDefined();
		if (actionGenerationRef) {
			actionGenerationRef.current =
				Number(actionGenerationRef.current ?? 0) + 1;
		}
		if (repositoryIdRef) repositoryIdRef.current = "repo-2";
		resolveRequest?.(response({ task: { id: "task-1" } }, 201));
		await request;

		expect(onTasksCreated).not.toHaveBeenCalled();
		expect(setters[1]).not.toHaveBeenCalledWith([]);
	});
});
