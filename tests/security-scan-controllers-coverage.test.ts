import { beforeEach, describe, expect, it, vi } from "vitest";

type Setter = ReturnType<typeof vi.fn>;
let stateSetters: Setter[] = [];
let refs: Array<{ current: unknown }> = [];
let effectCleanups: Array<() => void> = [];
let pendingEffects: Array<() => void | (() => void)> = [];

function mockReactHooks(
	values: unknown[],
	options: {
		runEffects?: boolean;
		deferEffects?: boolean;
		refValues?: unknown[];
	} = {},
) {
	const stateValues = [...values];
	const refValues = [...(options.refValues ?? [])];
	stateSetters = [];
	refs = [];
	effectCleanups = [];
	pendingEffects = [];
	vi.resetModules();
	vi.doMock("react", async () => {
		const actual = await vi.importActual<typeof import("react")>("react");
		return {
			...actual,
			useCallback: <T extends (...args: never[]) => unknown>(callback: T) =>
				callback,
			useMemo: <T>(factory: () => T) => factory(),
			useEffect: (callback: () => void | (() => void)) => {
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
}

function jsonResponse(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

const baseSelection = {
	mode: "preset" as const,
	presetId: "standard" as const,
};
const baseTarget = { kind: "working_tree" as const };
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
const completedScan = {
	scanRunRef: "scan-1",
	status: "completed",
	progress: null,
	summary: null,
	error: null,
};
const runningScan = { ...completedScan, status: "running" };
const report = {
	reportRef: "report-1",
	scanRunRef: "scan-1",
	status: "completed",
	title: "Security report",
	createdAt: "2026-08-08T00:00:00.000Z",
};

function controllerState(overrides: Record<number, unknown> = {}) {
	const values: unknown[] = [
		null,
		null,
		[],
		baseSelection,
		baseTarget,
		null,
		null,
		[],
		[],
		"initial",
		"",
	];
	for (const [index, value] of Object.entries(overrides))
		values[Number(index)] = value;
	return values;
}

function mockScanCommands(overrides: Record<string, unknown> = {}) {
	const commands = {
		fetchSecurityScanProviderSettings: vi.fn(async () =>
			jsonResponse({
				enabled: true,
				transport: "local_cli",
				baseUrl: "http://localhost",
				tokenConfigured: false,
				localCliConfigured: true,
			}),
		),
		fetchSecurityScanHistory: vi.fn(async () => jsonResponse({ items: [] })),
		fetchSecurityScanCapabilities: vi.fn(async () =>
			jsonResponse(capabilities),
		),
		previewSecurityScan: vi.fn(async () => jsonResponse(preview)),
		startSecurityScan: vi.fn(async () =>
			jsonResponse({
				scanRunRef: "scan-1",
				createdAt: "2026-08-08T00:00:00.000Z",
			}),
		),
		fetchSecurityScan: vi.fn(async () => jsonResponse(completedScan)),
		fetchSecurityScanFindings: vi.fn(async () =>
			jsonResponse({ items: [], nextCursor: null }),
		),
		fetchSecurityScanReports: vi.fn(async () => jsonResponse({ items: [] })),
		cancelSecurityScan: vi.fn(async () =>
			jsonResponse({ ...completedScan, status: "cancelled" }),
		),
		startSecurityScanReport: vi.fn(async () => jsonResponse({ report })),
		...overrides,
	};
	vi.doMock("../src/modules/securityScan/securityScanCommands", () => commands);
	return commands;
}

async function flushPromises() {
	for (let index = 0; index < 12; index += 1) await Promise.resolve();
	await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("security scan controller coverage", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it("loads capabilities, applies the preferred profile, and updates inputs", async () => {
		mockReactHooks(controllerState());
		const commands = mockScanCommands();
		const { useSecurityScanController } = await import(
			"../src/modules/securityScan/useSecurityScanController"
		);
		const controller = useSecurityScanController("repo-1");

		await controller.loadCapabilities();
		expect(commands.fetchSecurityScanCapabilities).toHaveBeenCalledWith(
			"repo-1",
		);
		expect(stateSetters[1]).toHaveBeenCalledWith(capabilities);
		expect(stateSetters[3]).toHaveBeenCalledWith({
			mode: "preset",
			presetId: "quick",
		});
		expect(stateSetters[4]).toHaveBeenCalledWith({ kind: "working_tree" });

		controller.updateSelection({ mode: "custom", profileRef: "custom-1" });
		controller.updateTarget("full");
		expect(stateSetters[3]).toHaveBeenLastCalledWith({
			mode: "custom",
			profileRef: "custom-1",
		});
		expect(stateSetters[4]).toHaveBeenLastCalledWith({ kind: "full" });
		expect(stateSetters[9].mock.results.at(-1)?.value).toBe("initial");
	});

	it("handles capability and preview success, provider errors, and response fallbacks", async () => {
		mockReactHooks(controllerState());
		const commands = mockScanCommands({
			fetchSecurityScanCapabilities: vi
				.fn()
				.mockResolvedValueOnce(
					jsonResponse({ error: { message: "not configured" } }, 503),
				)
				.mockResolvedValueOnce(new Response("not-json", { status: 500 })),
			previewSecurityScan: vi
				.fn()
				.mockResolvedValueOnce(jsonResponse(preview))
				.mockRejectedValueOnce("preview offline"),
		});
		const { useSecurityScanController } = await import(
			"../src/modules/securityScan/useSecurityScanController"
		);
		const controller = useSecurityScanController("repo-1");

		await controller.loadCapabilities();
		expect(stateSetters[10]).toHaveBeenCalledWith("not configured");
		await controller.loadCapabilities();
		expect(stateSetters[10]).toHaveBeenCalledWith("Request failed (500)");

		await controller.createPreview();
		expect(stateSetters[5]).toHaveBeenCalledWith(preview);
		await controller.createPreview();
		expect(stateSetters[10]).toHaveBeenCalledWith("preview offline");
		expect(commands.previewSecurityScan).toHaveBeenCalledWith("repo-1", {
			selection: baseSelection,
			target: baseTarget,
		});
	});

	it("starts a scan, pages findings, deduplicates them, and loads reports", async () => {
		mockReactHooks(controllerState({ 5: preview }));
		const commands = mockScanCommands({
			fetchSecurityScanFindings: vi.fn(
				async (_repo: string, _scan: string, cursor?: string) =>
					cursor
						? jsonResponse({
								items: [
									{ ref: "finding-1", title: "updated" },
									{ ref: "finding-2" },
								],
								nextCursor: null,
							})
						: jsonResponse({
								items: [{ ref: "finding-1", title: "first" }],
								nextCursor: "page-2",
							}),
			),
			fetchSecurityScanReports: vi.fn(async () =>
				jsonResponse({ items: [report] }),
			),
		});
		const { useSecurityScanController } = await import(
			"../src/modules/securityScan/useSecurityScanController"
		);
		const controller = useSecurityScanController("repo-1");

		await controller.runScan();
		expect(commands.startSecurityScan).toHaveBeenCalledWith(
			"repo-1",
			expect.objectContaining({
				previewRef: "preview-1",
				expectedTargetDigest: "d".repeat(64),
			}),
		);
		expect(commands.fetchSecurityScanFindings).toHaveBeenCalledTimes(2);
		expect(stateSetters[7]).toHaveBeenCalledWith([
			expect.objectContaining({ ref: "finding-1", title: "updated" }),
			expect.objectContaining({ ref: "finding-2" }),
		]);
		expect(stateSetters[8]).toHaveBeenCalledWith([report]);
		expect(stateSetters[2].mock.results[0]?.value).toEqual([
			expect.objectContaining({ scanRunRef: "scan-1" }),
		]);
	});

	it("guards missing or duplicate starts and reports artifact failures", async () => {
		mockReactHooks(controllerState());
		let commands = mockScanCommands();
		let module = await import(
			"../src/modules/securityScan/useSecurityScanController"
		);
		let controller = module.useSecurityScanController("repo-1");
		await controller.runScan();
		expect(commands.startSecurityScan).not.toHaveBeenCalled();

		mockReactHooks(controllerState({ 5: preview }), {
			refValues: ["repo-1", null, false, 0, "busy"],
		});
		commands = mockScanCommands();
		module = await import(
			"../src/modules/securityScan/useSecurityScanController"
		);
		controller = module.useSecurityScanController("repo-1");
		await controller.runScan();
		expect(commands.startSecurityScan).not.toHaveBeenCalled();

		mockReactHooks(controllerState({ 5: preview }));
		commands = mockScanCommands({
			fetchSecurityScanFindings: vi.fn(async () =>
				jsonResponse({ error: { message: "findings failed" } }, 500),
			),
			fetchSecurityScanReports: vi.fn(async () =>
				jsonResponse({ error: { message: "reports failed" } }, 500),
			),
		});
		module = await import(
			"../src/modules/securityScan/useSecurityScanController"
		);
		controller = module.useSecurityScanController("repo-1");
		await controller.runScan();
		expect(stateSetters[10]).toHaveBeenCalledWith(
			"findings failed / reports failed",
		);
	});

	it("detects cyclic finding cursors", async () => {
		mockReactHooks(controllerState({ 5: preview }));
		const commands = mockScanCommands({
			fetchSecurityScanFindings: vi.fn(async () =>
				jsonResponse({ items: [{ ref: "same" }], nextCursor: "loop" }),
			),
		});
		const { useSecurityScanController } = await import(
			"../src/modules/securityScan/useSecurityScanController"
		);
		const controller = useSecurityScanController("repo-1");
		await controller.runScan();
		expect(commands.fetchSecurityScanFindings).toHaveBeenCalledTimes(2);
		expect(stateSetters[10]).toHaveBeenCalledWith(
			"Findingページングが循環しています。",
		);
	});

	it("selects, cancels, and creates reports for the active scan", async () => {
		mockReactHooks(
			controllerState({
				6: runningScan,
				8: [{ ...report, status: "running" }],
			}),
		);
		const commands = mockScanCommands({
			fetchSecurityScan: vi.fn(async () => jsonResponse(runningScan)),
		});
		const { useSecurityScanController } = await import(
			"../src/modules/securityScan/useSecurityScanController"
		);
		const controller = useSecurityScanController("repo-1");

		await controller.selectScan("scan-1");
		expect(stateSetters[6]).toHaveBeenCalledWith(runningScan);
		await controller.cancelScan();
		expect(commands.cancelSecurityScan).toHaveBeenCalledWith(
			"repo-1",
			"scan-1",
		);
		expect(stateSetters[6]).toHaveBeenCalledWith(
			expect.objectContaining({ status: "cancelled" }),
		);
		const created = await controller.createReport();
		expect(created).toEqual(report);
		expect(stateSetters[8].mock.results.at(-1)?.value).toEqual([report]);
	});

	it("handles selection, cancellation, and report failures plus inactive guards", async () => {
		mockReactHooks(controllerState({ 6: null }));
		let commands = mockScanCommands();
		let module = await import(
			"../src/modules/securityScan/useSecurityScanController"
		);
		let controller = module.useSecurityScanController("repo-1");
		expect(await controller.cancelScan()).toBeUndefined();
		expect(await controller.createReport()).toBeNull();
		expect(commands.cancelSecurityScan).not.toHaveBeenCalled();

		mockReactHooks(controllerState({ 6: runningScan }));
		commands = mockScanCommands({
			fetchSecurityScan: vi.fn(async () => {
				throw "select offline";
			}),
			cancelSecurityScan: vi.fn(async () => {
				throw "cancel offline";
			}),
			startSecurityScanReport: vi.fn(async () => {
				throw new Error("report offline");
			}),
		});
		module = await import(
			"../src/modules/securityScan/useSecurityScanController"
		);
		controller = module.useSecurityScanController("repo-1");
		await controller.selectScan("scan-1");
		expect(stateSetters[10]).toHaveBeenCalledWith("select offline");
		await controller.cancelScan();
		expect(stateSetters[10]).toHaveBeenCalledWith("cancel offline");
		expect(await controller.createReport()).toBeNull();
		expect(stateSetters[10]).toHaveBeenCalledWith("report offline");
	});

	it("runs initial loading for local and HTTP settings and cleans up stale work", async () => {
		mockReactHooks(controllerState(), { runEffects: true });
		let commands = mockScanCommands({
			fetchSecurityScanHistory: vi.fn(async () =>
				jsonResponse({
					items: [
						{
							scanRunRef: "scan-1",
							selection: baseSelection,
							target: baseTarget,
							createdAt: "now",
						},
					],
				}),
			),
		});
		let module = await import(
			"../src/modules/securityScan/useSecurityScanController"
		);
		module.useSecurityScanController("repo-1");
		await flushPromises();
		expect(commands.fetchSecurityScanProviderSettings).toHaveBeenCalled();
		expect(commands.fetchSecurityScan).toHaveBeenCalledWith("repo-1", "scan-1");
		expect(commands.fetchSecurityScanCapabilities).toHaveBeenCalled();

		mockReactHooks(controllerState(), { runEffects: true });
		commands = mockScanCommands({
			fetchSecurityScanProviderSettings: vi.fn(async () =>
				jsonResponse({
					enabled: true,
					transport: "http",
					tokenConfigured: true,
					localCliConfigured: false,
				}),
			),
		});
		module = await import(
			"../src/modules/securityScan/useSecurityScanController"
		);
		module.useSecurityScanController("repo-1");
		await flushPromises();
		expect(commands.fetchSecurityScanCapabilities).toHaveBeenCalled();

		mockReactHooks(controllerState(), { runEffects: true });
		commands = mockScanCommands({
			fetchSecurityScanProviderSettings: vi.fn(async () => {
				throw new Error("settings offline");
			}),
		});
		module = await import(
			"../src/modules/securityScan/useSecurityScanController"
		);
		module.useSecurityScanController("repo-1");
		effectCleanups.forEach((cleanup) => {
			cleanup();
		});
		await flushPromises();
		expect(stateSetters[10]).not.toHaveBeenCalledWith("settings offline");
	});

	it("polls active work without overlapping and clears the timer", async () => {
		const setIntervalMock = vi.fn((callback: () => void) => {
			callback();
			callback();
			return 17;
		});
		const clearIntervalMock = vi.fn();
		vi.stubGlobal("window", {
			setInterval: setIntervalMock,
			clearInterval: clearIntervalMock,
		});
		mockReactHooks(controllerState({ 6: runningScan }), { runEffects: true });
		const commands = mockScanCommands({
			fetchSecurityScan: vi.fn(async () => {
				throw new Error("poll failed");
			}),
		});
		const { useSecurityScanController } = await import(
			"../src/modules/securityScan/useSecurityScanController"
		);
		useSecurityScanController("repo-1");
		await flushPromises();
		expect(setIntervalMock).toHaveBeenCalledWith(expect.any(Function), 2_000);
		effectCleanups.forEach((cleanup) => {
			cleanup();
		});
		expect(clearIntervalMock).toHaveBeenCalledWith(17);
		expect(commands.fetchSecurityScan).toHaveBeenCalled();
		vi.unstubAllGlobals();
	});

	it("derives selected presets for preset and custom selections", async () => {
		mockReactHooks(
			controllerState({
				1: capabilities,
				3: { mode: "preset", presetId: "quick" },
			}),
		);
		mockScanCommands();
		let module = await import(
			"../src/modules/securityScan/useSecurityScanController"
		);
		expect(module.useSecurityScanController("repo-1").selectedPreset?.id).toBe(
			"quick",
		);

		mockReactHooks(
			controllerState({
				1: capabilities,
				3: { mode: "custom", profileRef: "custom" },
			}),
		);
		mockScanCommands();
		module = await import(
			"../src/modules/securityScan/useSecurityScanController"
		);
		expect(
			module.useSecurityScanController("repo-1").selectedPreset,
		).toBeNull();
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
			{
				scanRunRef: "scan-1",
				findingRefs: ["finding-1"],
			},
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
				jsonResponse({ error: { message: "generation denied" } }, 403),
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
			{
				candidateIds: ["candidate-1"],
				mode: "draft",
			},
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
		expect(stateSetters[3]).toHaveBeenCalledWith("Request failed (500)");

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
