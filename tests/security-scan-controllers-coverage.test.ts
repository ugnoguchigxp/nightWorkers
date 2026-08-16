import { beforeEach, describe, expect, it, vi } from "vitest";

type Setter = ReturnType<typeof vi.fn>;
type QueryData = {
	providerSettings: Record<string, unknown> | null;
	capabilities: Record<string, unknown> | null;
	history: { items: Array<Record<string, unknown>> };
	detail: Record<string, unknown> | null;
	findings: Array<Record<string, unknown>>;
	reports: Array<Record<string, unknown>>;
};

let stateSetters: Setter[] = [];
let refs: Array<{ current: unknown }> = [];
let effectCleanups: Array<() => void> = [];
let pendingEffects: Array<() => undefined | (() => void)> = [];
let queryOptions: Array<Record<string, unknown>> = [];
let queryClient: {
	setQueryData: ReturnType<typeof vi.fn>;
	invalidateQueries: ReturnType<typeof vi.fn>;
	fetchQuery: ReturnType<typeof vi.fn>;
};

const baseSelection = {
	mode: "preset" as const,
	presetId: "standard" as const,
};
const baseTarget = { kind: "working_tree" as const };
const providerSettings = {
	enabled: true,
	transport: "local_cli",
	baseUrl: "http://localhost",
	tokenConfigured: false,
	localCliConfigured: true,
};
const capabilities = {
	provider: { id: "vulnworkbench", version: "1.2.3" },
	project: { ref: "project-1", displayName: "Project" },
	presets: [
		{
			id: "quick",
			displayName: "Quick",
			description: "Fast",
			recommended: true,
			targets: [
				{
					kind: "working_tree",
					profileRef: "quick",
					estimatedDurationSeconds: { min: 1, max: 2 },
					toolCategories: [],
					warnings: [],
				},
			],
		},
	],
	selectableProfiles: [],
	limits: {
		maxConcurrentScansForClient: 1,
		maxFindingPageSize: 100,
		maxEventPageSize: 100,
		maxReportBytes: 1_000,
	},
};
const preview = {
	previewRef: "preview-1",
	resolvedProfileRef: "profile-1",
	target: {
		kind: "working_tree",
		digest: "d".repeat(64),
		sourceRevision: null,
		fileCount: 2,
	},
	estimatedDurationSeconds: { min: 1, max: 2 },
	toolSteps: [],
	warnings: [],
	expiresAt: "2026-08-08T00:00:00.000Z",
};
const runningScan = {
	scanRunRef: "scan-1",
	status: "running",
	progress: null,
	summary: null,
	error: null,
};
const report = {
	reportRef: "report-1",
	scanRunRef: "scan-1",
	status: "completed",
	title: "Security report",
	createdAt: "2026-08-08T00:00:00.000Z",
};

function controllerState(overrides: Record<number, unknown> = {}) {
	const values: unknown[] = [baseSelection, baseTarget, null, null, null, ""];
	for (const [index, value] of Object.entries(overrides)) {
		values[Number(index)] = value;
	}
	return values;
}

function mockReactHooks(
	values: unknown[],
	options: {
		runEffects?: boolean;
		deferEffects?: boolean;
		refValues?: unknown[];
		queryData?: Partial<QueryData>;
		queryErrors?: Partial<Record<keyof QueryData, Error>>;
	} = {},
) {
	const stateValues = [...values];
	const refValues = [...(options.refValues ?? [])];
	const data: QueryData = {
		providerSettings,
		capabilities: null,
		history: { items: [] },
		detail: null,
		findings: [],
		reports: [],
		...options.queryData,
	};
	stateSetters = [];
	refs = [];
	effectCleanups = [];
	pendingEffects = [];
	queryOptions = [];
	queryClient = {
		setQueryData: vi.fn(),
		invalidateQueries: vi.fn(async () => undefined),
		fetchQuery: vi.fn(async () => data.detail),
	};
	vi.resetModules();
	vi.doMock("react", async () => {
		const actual = await vi.importActual<typeof import("react")>("react");
		return {
			...actual,
			useCallback: <T extends (...args: never[]) => unknown>(callback: T) =>
				callback,
			useMemo: <T>(factory: () => T) => factory(),
			useEffect: (callback: () => undefined | (() => void)) => {
				if (options.deferEffects) {
					pendingEffects.push(callback);
					return;
				}
				if (!options.runEffects) return;
				const cleanup = callback();
				if (typeof cleanup === "function") effectCleanups.push(cleanup);
			},
			useRef: <T>(initial: T) => {
				const ref = {
					current: (refValues.length ? refValues.shift() : initial) as T,
				};
				refs.push(ref as { current: unknown });
				return ref;
			},
			useState: <T>(initial: T | (() => T)) => {
				const value = stateValues.length
					? (stateValues.shift() as T)
					: typeof initial === "function"
						? (initial as () => T)()
						: initial;
				const setter = vi.fn((next: T | ((current: T) => T)) =>
					typeof next === "function"
						? (next as (current: T) => T)(value)
						: next,
				);
				stateSetters.push(setter);
				return [value, setter] as const;
			},
		};
	});
	vi.doMock("@tanstack/react-query", () => ({
		queryOptions: <T>(options: T) => options,
		useQueryClient: () => queryClient,
		useQuery: (query: Record<string, unknown>) => {
			queryOptions.push(query);
			const queryKind = (query.queryKey as readonly string[])[1];
			const key =
				queryKind === "provider-settings"
					? "providerSettings"
					: (queryKind as keyof QueryData);
			const error = options.queryErrors?.[key] ?? null;
			return {
				data: data[key],
				isPending: false,
				error,
				refetch: vi.fn(async () => ({ data: data[key], error })),
			};
		},
	}));
}

function jsonResponse(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

function mockScanCommands(overrides: Record<string, unknown> = {}) {
	const commands = {
		previewSecurityScan: vi.fn(async () => jsonResponse(preview)),
		startSecurityScan: vi.fn(async () =>
			jsonResponse({
				scanRunRef: "scan-1",
				createdAt: "2026-08-08T00:00:00.000Z",
			}),
		),
		cancelSecurityScan: vi.fn(async () =>
			jsonResponse({ ...runningScan, status: "cancelled" }),
		),
		startSecurityScanReport: vi.fn(async () => jsonResponse({ report })),
		...overrides,
	};
	vi.doMock("../src/modules/securityScan/securityScanCommands", () => commands);
	return commands;
}

describe("security scan controller coverage", () => {
	beforeEach(() => vi.restoreAllMocks());

	it("keeps every server snapshot in a keyed Query resource", async () => {
		mockReactHooks(controllerState(), {
			runEffects: true,
			queryData: {
				capabilities,
				history: {
					items: [
						{
							scanRunRef: "scan-1",
							selection: baseSelection,
							target: baseTarget,
							createdAt: "2026-08-08T00:00:00.000Z",
						},
					],
				},
			},
		});
		mockScanCommands();
		const { useSecurityScanController } = await import(
			"../src/modules/securityScan/useSecurityScanController"
		);
		const controller = useSecurityScanController("repo-1");
		expect(controller.capabilities).toEqual(capabilities);
		expect(queryOptions.map((query) => query.queryKey)).toEqual([
			["security-scan", "provider-settings"],
			["security-scan", "capabilities", "repo-1"],
			["security-scan", "history", "repo-1"],
			["security-scan", "detail", "repo-1", "none"],
			["security-scan", "findings", "repo-1", "none"],
			["security-scan", "reports", "repo-1", "none"],
		]);
		expect(stateSetters[0]).toHaveBeenCalledWith({
			mode: "preset",
			presetId: "quick",
		});
		expect(stateSetters[1]).toHaveBeenCalledWith({ kind: "working_tree" });
		expect(stateSetters[3]).toHaveBeenCalledWith("scan-1");
	});

	it("retains client draft state while preview mutations use the common decoder", async () => {
		mockReactHooks(controllerState());
		const commands = mockScanCommands();
		const { useSecurityScanController } = await import(
			"../src/modules/securityScan/useSecurityScanController"
		);
		const controller = useSecurityScanController("repo-1");
		controller.updateSelection({ mode: "custom", profileRef: "custom-1" });
		controller.updateTarget("full");
		await controller.createPreview();
		expect(commands.previewSecurityScan).toHaveBeenCalledWith("repo-1", {
			selection: baseSelection,
			target: baseTarget,
		});
		expect(stateSetters[2]).toHaveBeenCalledWith(preview);
	});

	it("updates canonical cache snapshots after start, cancel, and report actions", async () => {
		mockReactHooks(controllerState({ 2: preview, 3: "scan-1" }), {
			queryData: { detail: runningScan },
		});
		const commands = mockScanCommands();
		const { useSecurityScanController } = await import(
			"../src/modules/securityScan/useSecurityScanController"
		);
		const controller = useSecurityScanController("repo-1");
		await controller.runScan();
		expect(commands.startSecurityScan).toHaveBeenCalledWith(
			"repo-1",
			expect.objectContaining({ previewRef: "preview-1" }),
		);
		expect(queryClient.setQueryData).toHaveBeenCalledWith(
			["security-scan", "history", "repo-1"],
			expect.any(Function),
		);

		await controller.cancelScan();
		expect(commands.cancelSecurityScan).toHaveBeenCalledWith(
			"repo-1",
			"scan-1",
		);
		expect(queryClient.setQueryData).toHaveBeenCalledWith(
			["security-scan", "detail", "repo-1", "scan-1"],
			expect.objectContaining({ status: "cancelled" }),
		);
		expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
			queryKey: ["security-scan", "history", "repo-1"],
		});

		expect(await controller.createReport()).toEqual(report);
		expect(queryClient.setQueryData).toHaveBeenCalledWith(
			["security-scan", "reports", "repo-1", "scan-1"],
			expect.any(Function),
		);
	});

	it("surfaces independent query failures and stops terminal polling", async () => {
		mockReactHooks(controllerState({ 3: "scan-1" }), {
			queryData: {
				detail: { ...runningScan, status: "completed" },
				reports: [{ ...report, status: "completed" }],
			},
			queryErrors: { findings: new Error("findings unavailable") },
		});
		mockScanCommands();
		const { useSecurityScanController } = await import(
			"../src/modules/securityScan/useSecurityScanController"
		);
		const controller = useSecurityScanController("repo-1");
		expect(controller.error).toBe("findings unavailable");
		const detailQuery = queryOptions.find(
			(query) => (query.queryKey as string[])[1] === "detail",
		);
		const reportsQuery = queryOptions.find(
			(query) => (query.queryKey as string[])[1] === "reports",
		);
		if (!detailQuery || !reportsQuery)
			throw new Error("Expected scan polling queries");
		expect(
			(detailQuery.refetchInterval as (query: unknown) => unknown)({
				state: { data: { status: "completed" } },
			}),
		).toBe(false);
		expect(
			(reportsQuery.refetchInterval as (query: unknown) => unknown)({
				state: { data: [{ status: "completed" }] },
			}),
		).toBe(false);
	});
});

function mockCandidateDependencies(
	options: {
		parse?: (payload: unknown) => { success: boolean; data?: unknown };
		generate?: () => Promise<Response>;
		create?: () => Promise<Response>;
	} = {},
) {
	vi.doMock("react-i18next", () => ({
		useTranslation: () => ({
			t: (key: string, values?: { message?: string }) =>
				values?.message ? `${key}:${values.message}` : key,
		}),
	}));
	vi.doMock("../shared/schemas/security-task-generation.schema", async () => {
		const actual = await vi.importActual<object>(
			"../shared/schemas/security-task-generation.schema",
		);
		return {
			...actual,
			generateSecurityScanTaskCandidatesResponseSchema: {
				safeParse:
					options.parse ??
					((payload: unknown) => ({ success: true, data: payload })),
			},
		};
	});
	const commands = {
		generateSecurityScanTaskCandidates: vi.fn(
			options.generate ??
				(async () => jsonResponse({ status: "completed", candidates: [] })),
		),
		createTasksFromMissionCandidates: vi.fn(
			options.create ??
				(async () => jsonResponse({ tasks: [{ id: "task-1" }] })),
		),
	};
	vi.doMock("../src/modules/taskGeneration", () => commands);
	return commands;
}

describe("security task candidate controller coverage", () => {
	it("selects, toggles, clears, and caps finding selections", async () => {
		mockReactHooks([["finding-1"], null, null, ""]);
		mockCandidateDependencies();
		let module = await import(
			"../src/modules/securityScan/useSecurityTaskCandidateController"
		);
		let controller = module.useSecurityTaskCandidateController({
			repositoryId: "repo-1",
			scanRunRef: "scan-1",
		});
		controller.toggleFinding("finding-1");
		expect(stateSetters[0].mock.results[0]?.value).toEqual([]);
		controller.toggleFinding("finding-2");
		expect(stateSetters[0].mock.results[1]?.value).toEqual([
			"finding-1",
			"finding-2",
		]);
		controller.selectAll(
			Array.from({ length: 30 }, (_, index) => `finding-${index}`),
		);
		expect(stateSetters[0].mock.calls.at(-1)?.[0]).toHaveLength(25);
		controller.clearSelection();
		controller.closeDialog();
		expect(stateSetters[0]).toHaveBeenLastCalledWith([]);
		expect(stateSetters[1]).toHaveBeenLastCalledWith(null);

		mockReactHooks([
			Array.from({ length: 25 }, (_, index) => `finding-${index}`),
			null,
			null,
			"",
		]);
		mockCandidateDependencies();
		module = await import(
			"../src/modules/securityScan/useSecurityTaskCandidateController"
		);
		controller = module.useSecurityTaskCandidateController({
			repositoryId: "repo-1",
			scanRunRef: "scan-1",
		});
		controller.toggleFinding("overflow");
		expect(stateSetters[0].mock.results[0]?.value).toHaveLength(25);
	});

	it("generates candidates and handles invalid or failed responses", async () => {
		mockReactHooks([["finding-1"], null, null, ""]);
		let commands = mockCandidateDependencies();
		let module = await import(
			"../src/modules/securityScan/useSecurityTaskCandidateController"
		);
		let controller = module.useSecurityTaskCandidateController({
			repositoryId: "repo-1",
			scanRunRef: "scan-1",
		});
		await controller.requestCandidates();
		expect(commands.generateSecurityScanTaskCandidates).toHaveBeenCalledWith(
			"repo-1",
			{ scanRunRef: "scan-1", findingRefs: ["finding-1"] },
		);
		expect(stateSetters[1]).toHaveBeenCalledWith(
			expect.objectContaining({ status: "completed" }),
		);

		mockReactHooks([["finding-1"], null, null, ""]);
		commands = mockCandidateDependencies({ parse: () => ({ success: false }) });
		module = await import(
			"../src/modules/securityScan/useSecurityTaskCandidateController"
		);
		controller = module.useSecurityTaskCandidateController({
			repositoryId: "repo-1",
			scanRunRef: "scan-1",
		});
		await controller.requestCandidates();
		expect(stateSetters[3]).toHaveBeenCalledWith(
			"securityScan.taskCandidateResponseInvalid",
		);

		mockReactHooks([["finding-1"], null, null, ""]);
		mockCandidateDependencies({
			generate: async () =>
				jsonResponse(
					{
						error: { code: "GENERATION_DENIED", message: "generation denied" },
					},
					403,
				),
		});
		module = await import(
			"../src/modules/securityScan/useSecurityTaskCandidateController"
		);
		controller = module.useSecurityTaskCandidateController({
			repositoryId: "repo-1",
			scanRunRef: "scan-1",
		});
		await controller.requestCandidates();
		expect(stateSetters[3]).toHaveBeenCalledWith("generation denied");
	});

	it("guards candidate generation without scan, selection, or while busy", async () => {
		for (const [scanRunRef, selected, busy] of [
			[null, ["finding-1"], false],
			["scan-1", [], false],
			["scan-1", ["finding-1"], true],
		] as const) {
			mockReactHooks([selected, null, null, ""], {
				refValues: ["repo-1\0scan-1", 0, busy],
			});
			const commands = mockCandidateDependencies();
			const module = await import(
				"../src/modules/securityScan/useSecurityTaskCandidateController"
			);
			// biome-ignore lint/correctness/useHookAtTopLevel: this test invokes the mocked hook once per fixture.
			const controller = module.useSecurityTaskCandidateController({
				repositoryId: "repo-1",
				scanRunRef,
			});
			await controller.requestCandidates();
			expect(
				commands.generateSecurityScanTaskCandidates,
			).not.toHaveBeenCalled();
		}
	});

	it("creates draft tasks, refreshes the host, and reports refresh failures", async () => {
		const onTasksCreated = vi.fn(async () => undefined);
		mockReactHooks([["finding-1"], { status: "completed" }, null, ""]);
		let commands = mockCandidateDependencies();
		let module = await import(
			"../src/modules/securityScan/useSecurityTaskCandidateController"
		);
		let controller = module.useSecurityTaskCandidateController({
			repositoryId: "repo-1",
			scanRunRef: "scan-1",
			onTasksCreated,
		});
		await controller.createDraftTasks(["candidate-1"]);
		expect(commands.createTasksFromMissionCandidates).toHaveBeenCalledWith(
			"repo-1",
			{ candidateIds: ["candidate-1"], mode: "draft" },
		);
		expect(onTasksCreated).toHaveBeenCalledWith([{ id: "task-1" }]);
		expect(stateSetters[1]).toHaveBeenCalledWith(null);
		expect(stateSetters[0]).toHaveBeenCalledWith([]);

		mockReactHooks([["finding-1"], null, null, ""]);
		commands = mockCandidateDependencies();
		module = await import(
			"../src/modules/securityScan/useSecurityTaskCandidateController"
		);
		controller = module.useSecurityTaskCandidateController({
			repositoryId: "repo-1",
			scanRunRef: "scan-1",
			onTasksCreated: async () => {
				throw "refresh failed";
			},
		});
		await controller.createDraftTasks(["candidate-1"]);
		expect(stateSetters[3]).toHaveBeenCalledWith(
			"securityScan.taskRefreshFailed:refresh failed",
		);
	});

	it("handles invalid task payloads, HTTP fallbacks, and empty/busy guards", async () => {
		mockReactHooks([[], null, null, ""]);
		let commands = mockCandidateDependencies({
			create: async () => jsonResponse({ nope: true }),
		});
		let module = await import(
			"../src/modules/securityScan/useSecurityTaskCandidateController"
		);
		let controller = module.useSecurityTaskCandidateController({
			repositoryId: "repo-1",
			scanRunRef: "scan-1",
		});
		await controller.createDraftTasks(["candidate-1"]);
		expect(stateSetters[3]).toHaveBeenCalledWith(
			"securityScan.taskCreationResponseInvalid",
		);

		mockReactHooks([[], null, null, ""]);
		commands = mockCandidateDependencies({
			create: async () => new Response("bad", { status: 500 }),
		});
		module = await import(
			"../src/modules/securityScan/useSecurityTaskCandidateController"
		);
		controller = module.useSecurityTaskCandidateController({
			repositoryId: "repo-1",
			scanRunRef: "scan-1",
		});
		await controller.createDraftTasks(["candidate-1"]);
		expect(stateSetters[3]).toHaveBeenCalledWith(
			"Response body is not valid JSON",
		);

		mockReactHooks([[], null, null, ""], {
			refValues: ["repo-1\0scan-1", 0, true],
		});
		commands = mockCandidateDependencies();
		module = await import(
			"../src/modules/securityScan/useSecurityTaskCandidateController"
		);
		controller = module.useSecurityTaskCandidateController({
			repositoryId: "repo-1",
			scanRunRef: "scan-1",
		});
		await controller.createDraftTasks([]);
		await controller.createDraftTasks(["candidate-1"]);
		expect(commands.createTasksFromMissionCandidates).not.toHaveBeenCalled();
	});

	it("resets and hides stale scope state", async () => {
		mockReactHooks(
			[["finding"], { status: "completed" }, "generate", "old error"],
			{
				deferEffects: true,
				refValues: ["old-scope", 4, true],
			},
		);
		mockCandidateDependencies();
		const module = await import(
			"../src/modules/securityScan/useSecurityTaskCandidateController"
		);
		const controller = module.useSecurityTaskCandidateController({
			repositoryId: "repo-1",
			scanRunRef: "scan-1",
		});
		expect(controller).toMatchObject({
			selectedFindingRefs: [],
			result: null,
			action: null,
			error: "",
		});
		pendingEffects.forEach((effect) => {
			effect();
		});
		expect(stateSetters[0]).toHaveBeenCalledWith([]);
		expect(stateSetters[1]).toHaveBeenCalledWith(null);
		expect(refs[1].current).toBe(5);
		expect(refs[2].current).toBe(false);
	});
});
