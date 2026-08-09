import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	cancelProjectQualityRun,
	createCoverageImprovementTask,
	createProjectQualityRun,
	getProjectQuality,
	getProjectQualityRun,
	listProjectQualityRuns,
} from "../api/modules/quality/quality.service";

const mocks = vi.hoisted(() => ({
	spawn: vi.fn(),
	buildEnvironment: vi.fn(() => ({ TEST_ENV: "yes" })),
	redact: vi.fn((value: string) => value.replaceAll("secret", "[redacted]")),
	getRepository: vi.fn(),
	createTask: vi.fn(),
	createRun: vi.fn(),
	completeRun: vi.fn(),
	listRuns: vi.fn(),
	getRun: vi.fn(),
	getLatestRun: vi.fn(),
	listRunningRuns: vi.fn(),
	detectCapabilities: vi.fn(),
	coverageCommand: vi.fn(),
	e2eCommand: vi.fn((command: string) => `json:${command}`),
	readCoverage: vi.fn(),
	readE2e: vi.fn(),
}));

vi.mock("node:child_process", () => ({ spawn: mocks.spawn }));
vi.mock("../api/services/execution/child-process-environment", () => ({
	buildChildProcessEnvironment: mocks.buildEnvironment,
}));
vi.mock("../api/services/security/secret-redaction", () => ({
	redactSecretText: mocks.redact,
}));
vi.mock("../api/modules/nightworkers/nightworkers.repository", () => ({
	getRepository: mocks.getRepository,
	createTask: mocks.createTask,
}));
vi.mock("../api/modules/quality/quality.repository", () => ({
	createProjectQualityRun: mocks.createRun,
	completeProjectQualityRun: mocks.completeRun,
	listProjectQualityRuns: mocks.listRuns,
	getProjectQualityRun: mocks.getRun,
	getLatestProjectQualityRun: mocks.getLatestRun,
	listRunningProjectQualityRuns: mocks.listRunningRuns,
}));
vi.mock("../api/modules/quality/quality-capabilities", () => ({
	detectQualityCapabilities: mocks.detectCapabilities,
}));
vi.mock("../api/modules/quality/quality-artifacts", () => ({
	coverageCommandWithSummaryReporter: mocks.coverageCommand,
	e2eCommandWithJsonReporter: mocks.e2eCommand,
	readCoverageArtifacts: mocks.readCoverage,
	readE2eArtifacts: mocks.readE2e,
}));

const repositoryId = "00000000-0000-4000-8000-000000000001";
const otherRepositoryId = "00000000-0000-4000-8000-000000000002";
const runId = "00000000-0000-4000-8000-000000000003";

function repository(overrides: Record<string, unknown> = {}) {
	return {
		id: repositoryId,
		localPath: "/workspace/local",
		registeredRootCanonical: "/workspace/canonical",
		safetyPolicy: { maxCommandSeconds: 30 },
		...overrides,
	};
}

function qualityRun(overrides: Record<string, unknown> = {}) {
	return {
		id: runId,
		repositoryId,
		runType: "unit",
		status: "running",
		command: "test",
		exitCode: null,
		startedAt: "2026-08-01T01:02:03.000Z",
		completedAt: null,
		outputArtifactId: null,
		latestOutput: null,
		coverageSummary: null,
		e2eSummary: null,
		errorMessage: null,
		createdAt: "2026-08-01T01:02:03.000Z",
		updatedAt: "2026-08-01T01:02:03.000Z",
		...overrides,
	};
}

function capabilities(overrides: Record<string, unknown> = {}) {
	return {
		projectType: "typescript",
		unit: { runnable: true, missingCapabilities: [], command: "unit" },
		coverage: {
			runnable: true,
			missingCapabilities: [],
			command: "coverage",
		},
		e2e: { runnable: true, missingCapabilities: [], command: "e2e" },
		all: {
			runnable: true,
			missingCapabilities: [],
			command: "unit && e2e",
		},
		...overrides,
	};
}

type FakeChild = EventEmitter & {
	stdout: EventEmitter;
	stderr: EventEmitter;
	killed: boolean;
	pid?: number;
	kill: ReturnType<typeof vi.fn>;
};

function fakeChild(
	input: {
		event?: "close" | "error" | "none";
		exitCode?: number | null;
		pid?: number;
		killed?: boolean;
	} = {},
): FakeChild {
	const child = Object.assign(new EventEmitter(), {
		stdout: new EventEmitter(),
		stderr: new EventEmitter(),
		killed: input.killed ?? false,
		pid: input.pid,
		kill: vi.fn(),
	}) as FakeChild;
	if ((input.event ?? "close") !== "none") {
		queueMicrotask(() => {
			if (input.event === "error")
				child.emit("error", new Error("spawn failed"));
			else child.emit("close", input.exitCode ?? 0);
		});
	}
	return child;
}

async function expectAppError(
	promise: Promise<unknown>,
	code: string,
	message?: string,
) {
	await expect(promise).rejects.toMatchObject({
		code,
		...(message ? { message } : {}),
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.useRealTimers();
	delete process.env.CI;
	mocks.getRepository.mockResolvedValue(repository());
	mocks.createTask.mockResolvedValue({ id: "task-1" });
	mocks.createRun.mockResolvedValue(qualityRun());
	mocks.getRun.mockResolvedValue(qualityRun());
	mocks.completeRun.mockResolvedValue(qualityRun({ status: "completed" }));
	mocks.listRuns.mockResolvedValue([]);
	mocks.getLatestRun.mockResolvedValue(null);
	mocks.listRunningRuns.mockResolvedValue([]);
	mocks.detectCapabilities.mockReturnValue(capabilities());
	mocks.coverageCommand.mockReturnValue("coverage-with-summary");
	mocks.readCoverage.mockReturnValue({
		coverageSummary: { total: {} },
		error: null,
	});
	mocks.readE2e.mockReturnValue({
		e2eSummary: { status: "passed" },
		error: null,
	});
	mocks.spawn.mockImplementation(() => fakeChild());
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.useRealTimers();
});

describe("quality service repository and overview boundaries", () => {
	it("rejects every repository-backed operation when the repository is missing", async () => {
		mocks.getRepository.mockResolvedValue(null);

		await expectAppError(getProjectQuality(repositoryId), "NOT_FOUND");
		await expectAppError(listProjectQualityRuns(repositoryId), "NOT_FOUND");
		await expectAppError(
			getProjectQualityRun(repositoryId, runId),
			"NOT_FOUND",
		);
		await expectAppError(
			createProjectQualityRun({ repositoryId, runType: "unit" }),
			"NOT_FOUND",
		);
	});

	it("uses canonical root, selects both latest artifacts, and limits recent runs", async () => {
		const runs = Array.from({ length: 12 }, (_, index) =>
			qualityRun({
				id: `run-${index}`,
				coverageSummary: index === 2 ? { total: {} } : null,
				e2eSummary: index === 4 ? { status: "passed" } : null,
			}),
		);
		mocks.listRuns.mockResolvedValue(runs);
		mocks.getLatestRun.mockImplementation(({ runType }) =>
			Promise.resolve(qualityRun({ id: `latest-${runType}`, runType })),
		);
		mocks.listRunningRuns.mockResolvedValue([runs[0]]);

		const result = await getProjectQuality(repositoryId);

		expect(mocks.detectCapabilities).toHaveBeenCalledWith(
			"/workspace/canonical",
		);
		expect(result.latestCoverageRun?.id).toBe("run-2");
		expect(result.latestE2eResultRun?.id).toBe("run-4");
		expect(result.recentRuns).toHaveLength(10);
		expect(result.runningRuns).toEqual([runs[0]]);
	});

	it("falls back to local root and null artifacts", async () => {
		mocks.getRepository.mockResolvedValue(
			repository({ registeredRootCanonical: null }),
		);

		const result = await getProjectQuality(repositoryId);

		expect(mocks.detectCapabilities).toHaveBeenCalledWith("/workspace/local");
		expect(result.latestCoverageRun).toBeNull();
		expect(result.latestE2eResultRun).toBeNull();
	});

	it("lists runs after validating the repository", async () => {
		mocks.listRuns.mockResolvedValue([qualityRun()]);
		await expect(listProjectQualityRuns(repositoryId)).resolves.toHaveLength(1);
		expect(mocks.listRuns).toHaveBeenCalledWith(repositoryId);
	});

	it("returns an owned run and rejects missing or cross-repository runs", async () => {
		await expect(
			getProjectQualityRun(repositoryId, runId),
		).resolves.toMatchObject({
			id: runId,
		});

		mocks.getRun.mockResolvedValueOnce(null);
		await expectAppError(
			getProjectQualityRun(repositoryId, runId),
			"NOT_FOUND",
		);

		mocks.getRun.mockResolvedValueOnce(
			qualityRun({ repositoryId: otherRepositoryId }),
		);
		await expectAppError(
			getProjectQualityRun(repositoryId, runId),
			"NOT_FOUND",
		);
	});
});

describe("quality command and process boundaries", () => {
	it.each([
		["unit", { runnable: false, missingCapabilities: ["unit"] }],
		["unit", { runnable: true, missingCapabilities: [] }],
		["e2e", { runnable: false, missingCapabilities: ["e2e"] }],
		["e2e", { runnable: true, missingCapabilities: [] }],
	] as const)("rejects %s when runnable or command capability is missing", async (runType, capability) => {
		mocks.detectCapabilities.mockReturnValue(
			capabilities({ [runType]: capability }),
		);
		await expectAppError(
			createProjectQualityRun({ repositoryId, runType }),
			"VALIDATION_ERROR",
			"missing_quality_capability",
		);
	});

	it.each([
		{ runnable: false, command: "all", missingCapabilities: ["unit"] },
		{ runnable: true, missingCapabilities: ["e2e"] },
	])("rejects all when its aggregate capability is incomplete", async (all) => {
		mocks.detectCapabilities.mockReturnValue(capabilities({ all }));
		await expectAppError(
			createProjectQualityRun({ repositoryId, runType: "all" }),
			"VALIDATION_ERROR",
		);
	});

	it("uses the unit command when no coverage command is available", async () => {
		mocks.coverageCommand.mockReturnValue(undefined);

		await createProjectQualityRun({ repositoryId, runType: "unit" });

		expect(mocks.createRun).toHaveBeenCalledWith({
			repositoryId,
			runType: "unit",
			command: "unit",
		});
		expect(mocks.readCoverage).toHaveBeenCalledWith("/workspace/canonical");
		expect(mocks.readE2e).not.toHaveBeenCalled();
	});

	it("wraps the e2e command and skips coverage reading", async () => {
		await createProjectQualityRun({ repositoryId, runType: "e2e" });

		expect(mocks.e2eCommand).toHaveBeenCalledWith("e2e");
		expect(mocks.createRun).toHaveBeenCalledWith(
			expect.objectContaining({ command: "json:e2e" }),
		);
		expect(mocks.readCoverage).not.toHaveBeenCalled();
		expect(mocks.readE2e).toHaveBeenCalledWith("/workspace/canonical", 0);
	});

	it("builds an all command with optional coverage and e2e commands", async () => {
		mocks.coverageCommand.mockReturnValue(undefined);
		mocks.detectCapabilities.mockReturnValue(
			capabilities({
				e2e: { runnable: true, missingCapabilities: [], command: undefined },
			}),
		);

		await createProjectQualityRun({ repositoryId, runType: "all" });

		expect(mocks.createRun).toHaveBeenCalledWith(
			expect.objectContaining({ command: "unit" }),
		);
		expect(mocks.e2eCommand).not.toHaveBeenCalled();
		expect(mocks.readCoverage).toHaveBeenCalled();
		expect(mocks.readE2e).toHaveBeenCalled();
	});

	it("builds a complete all command and forwards explicit CI/environment settings", async () => {
		process.env.CI = "custom-ci";
		await createProjectQualityRun({ repositoryId, runType: "all" });

		expect(mocks.createRun).toHaveBeenCalledWith(
			expect.objectContaining({
				command: "unit && coverage-with-summary && json:e2e",
			}),
		);
		expect(mocks.buildEnvironment).toHaveBeenCalledWith({
			purpose: "workspace_command",
			overrides: { CI: "custom-ci" },
		});
		expect(mocks.spawn).toHaveBeenCalledWith(
			"unit && coverage-with-summary && json:e2e",
			expect.objectContaining({
				cwd: "/workspace/canonical",
				shell: true,
				detached: true,
				env: { TEST_ENV: "yes" },
			}),
		);
	});

	it("collects and redacts stdout/stderr and truncates oversized output", async () => {
		const child = fakeChild({ event: "none" });
		mocks.spawn.mockReturnValue(child);
		const pending = createProjectQualityRun({ repositoryId, runType: "unit" });
		await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalled());
		child.stdout.emit("data", Buffer.from(`secret${"x".repeat(120_010)}`));
		child.stderr.emit("data", Buffer.from("secret-tail"));
		child.emit("close", 0);

		await pending;
		const completion = mocks.completeRun.mock.calls[0]?.[0];
		expect(completion.latestOutput).not.toContain("secret");
		expect(completion.latestOutput).toHaveLength(120_000);
		expect(completion.latestOutput).toContain("[redacted]-tail");
	});

	it("marks nonzero process exit as failed and preserves artifact errors", async () => {
		mocks.spawn.mockImplementation(() => fakeChild({ exitCode: 7 }));
		mocks.readCoverage.mockReturnValue({
			coverageSummary: null,
			error: "coverage unavailable",
		});
		mocks.readE2e.mockReturnValue({
			e2eSummary: null,
			error: "e2e unavailable",
		});

		await createProjectQualityRun({ repositoryId, runType: "all" });

		expect(mocks.completeRun).toHaveBeenCalledWith(
			expect.objectContaining({
				status: "failed",
				exitCode: 7,
				errorMessage: "coverage unavailable; e2e unavailable",
			}),
		);
	});

	it("records spawn errors and ignores a later close event", async () => {
		const child = fakeChild({ event: "none" });
		mocks.spawn.mockReturnValue(child);
		const pending = createProjectQualityRun({ repositoryId, runType: "e2e" });
		await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalled());
		child.stdout.emit("data", Buffer.from("small secret"));
		child.emit("error", new Error("spawn failed"));
		child.emit("close", 0);

		await pending;
		expect(mocks.completeRun).toHaveBeenCalledWith(
			expect.objectContaining({
				status: "failed",
				exitCode: null,
				latestOutput: "small [redacted]\nspawn failed",
			}),
		);
	});

	it("times out with the default timeout and stops a process group", async () => {
		vi.useFakeTimers();
		mocks.getRepository.mockResolvedValue(
			repository({ safetyPolicy: undefined }),
		);
		const child = fakeChild({ event: "none", pid: 123 });
		mocks.spawn.mockReturnValue(child);
		const kill = vi.spyOn(process, "kill").mockReturnValue(true);
		const pending = createProjectQualityRun({ repositoryId, runType: "unit" });
		await vi.advanceTimersByTimeAsync(600_000);

		await pending;
		expect(kill).toHaveBeenCalledWith(-123, "SIGTERM");
		expect(mocks.completeRun).toHaveBeenCalledWith(
			expect.objectContaining({
				status: "failed",
				exitCode: null,
				errorMessage: "command timed out after 600s",
			}),
		);
	});

	it("falls back to child.kill when process-group termination fails", async () => {
		vi.useFakeTimers();
		const child = fakeChild({ event: "none", pid: 456 });
		mocks.spawn.mockReturnValue(child);
		vi.spyOn(process, "kill").mockImplementation(() => {
			throw new Error("no process group");
		});
		const pending = createProjectQualityRun({ repositoryId, runType: "unit" });
		await vi.advanceTimersByTimeAsync(30_000);

		await pending;
		expect(child.kill).toHaveBeenCalledWith("SIGTERM");
	});

	it("does not stop an already killed process on timeout", async () => {
		vi.useFakeTimers();
		const child = fakeChild({ event: "none", pid: 789, killed: true });
		mocks.spawn.mockReturnValue(child);
		const kill = vi.spyOn(process, "kill").mockReturnValue(true);
		const pending = createProjectQualityRun({ repositoryId, runType: "unit" });
		await vi.advanceTimersByTimeAsync(30_000);
		await pending;

		expect(kill).not.toHaveBeenCalled();
		expect(child.kill).not.toHaveBeenCalled();
	});

	it("uses child.kill directly on Windows", async () => {
		vi.useFakeTimers();
		vi.spyOn(process, "platform", "get").mockReturnValue("win32");
		const child = fakeChild({ event: "none", pid: 321 });
		mocks.spawn.mockReturnValue(child);
		const kill = vi.spyOn(process, "kill").mockReturnValue(true);
		const pending = createProjectQualityRun({ repositoryId, runType: "unit" });
		await vi.advanceTimersByTimeAsync(30_000);
		await pending;

		expect(kill).not.toHaveBeenCalled();
		expect(child.kill).toHaveBeenCalledWith("SIGTERM");
		expect(mocks.spawn).toHaveBeenCalledWith(
			expect.any(String),
			expect.objectContaining({ detached: false }),
		);
	});

	it("returns a concurrently cancelled run without reading artifacts", async () => {
		mocks.getRun.mockResolvedValue(qualityRun({ status: "cancelled" }));

		const result = await createProjectQualityRun({
			repositoryId,
			runType: "unit",
		});

		expect(result.status).toBe("cancelled");
		expect(mocks.readCoverage).not.toHaveBeenCalled();
		expect(mocks.completeRun).not.toHaveBeenCalled();
	});

	it("returns the latest run when conditional completion loses a race", async () => {
		mocks.completeRun.mockResolvedValue(null);
		mocks.getRun
			.mockResolvedValueOnce(qualityRun())
			.mockResolvedValueOnce(qualityRun({ status: "cancelled" }));

		await expect(
			createProjectQualityRun({ repositoryId, runType: "unit" }),
		).resolves.toMatchObject({ status: "cancelled" });
	});

	it("throws when both conditional completion and latest lookup are missing", async () => {
		mocks.completeRun.mockResolvedValue(null);
		mocks.getRun
			.mockResolvedValueOnce(qualityRun())
			.mockResolvedValueOnce(null);

		await expectAppError(
			createProjectQualityRun({ repositoryId, runType: "unit" }),
			"NOT_FOUND",
		);
	});
});

describe("quality cancellation boundaries", () => {
	it("rejects missing and cross-repository runs", async () => {
		mocks.getRun.mockResolvedValueOnce(null);
		await expectAppError(
			cancelProjectQualityRun(repositoryId, runId),
			"NOT_FOUND",
		);
		mocks.getRun.mockResolvedValueOnce(
			qualityRun({ repositoryId: otherRepositoryId }),
		);
		await expectAppError(
			cancelProjectQualityRun(repositoryId, runId),
			"NOT_FOUND",
		);
	});

	it.each([
		"completed",
		"failed",
		"cancelled",
	])("returns an already %s run unchanged", async (status) => {
		mocks.getRun.mockResolvedValue(qualityRun({ status }));
		await expect(
			cancelProjectQualityRun(repositoryId, runId),
		).resolves.toMatchObject({ status });
		expect(mocks.completeRun).not.toHaveBeenCalled();
	});

	it.each(["running", "queued"])("cancels a %s run", async (status) => {
		mocks.getRun.mockResolvedValue(qualityRun({ status }));
		mocks.completeRun.mockResolvedValue(qualityRun({ status: "cancelled" }));

		await expect(
			cancelProjectQualityRun(repositoryId, runId),
		).resolves.toMatchObject({ status: "cancelled" });
		expect(mocks.completeRun).toHaveBeenCalledWith({
			runId,
			status: "cancelled",
			errorMessage: "cancelled",
		});
	});

	it("throws when cancellation persistence finds no run", async () => {
		mocks.completeRun.mockResolvedValue(null);
		await expectAppError(
			cancelProjectQualityRun(repositoryId, runId),
			"NOT_FOUND",
		);
	});

	it("stops an active run and causes its creator to observe cancellation", async () => {
		let current = qualityRun();
		const child = fakeChild({ event: "none", pid: 987 });
		mocks.spawn.mockReturnValue(child);
		mocks.getRun.mockImplementation(() => Promise.resolve(current));
		mocks.completeRun.mockImplementation(async (input) => {
			current = qualityRun({ status: input.status });
			return current;
		});
		vi.spyOn(process, "kill").mockReturnValue(true);
		const creating = createProjectQualityRun({ repositoryId, runType: "unit" });
		await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalled());

		await cancelProjectQualityRun(repositoryId, runId);
		child.emit("close", null);

		await expect(creating).resolves.toMatchObject({ status: "cancelled" });
	});
});

describe("coverage improvement task boundaries", () => {
	function coverageEntry(overrides: Record<string, unknown> = {}) {
		return {
			statements: { pct: 91.25 },
			branches: { pct: 82 },
			functions: { pct: 73.5 },
			lines: { pct: 64 },
			uncoveredLines: [4, "8", false, null],
			...overrides,
		};
	}

	function prepareCoverageRun(overrides: Record<string, unknown> = {}) {
		const run = qualityRun({
			status: "completed",
			completedAt: "2026-08-02T03:04:05.000Z",
			coverageSummary: {
				"/workspace/canonical/src/zeta.ts": coverageEntry(),
				"/workspace/canonical/src/alpha.ts": coverageEntry(),
			},
			...overrides,
		});
		mocks.getRun.mockResolvedValue(run);
		mocks.listRuns.mockResolvedValue([run]);
		return run;
	}

	it("creates a sorted multi-file task and deduplicates requested keys", async () => {
		prepareCoverageRun();

		const result = await createCoverageImprovementTask({
			repositoryId,
			runId,
			request: {
				fileKeys: [
					"/workspace/canonical/src/zeta.ts",
					"/workspace/canonical/src/alpha.ts",
					"/workspace/canonical/src/zeta.ts",
				],
			},
		});

		expect(result.task).toEqual({ id: "task-1" });
		const created = mocks.createTask.mock.calls[0]?.[0];
		expect(created.title).toBe("カバレッジ改善: 2ファイル");
		expect(created.description.indexOf("src/alpha.ts")).toBeLessThan(
			created.description.indexOf("src/zeta.ts"),
		);
		expect(created.description).toContain("statements: 91.3%");
		expect(created.description).toContain("uncovered lines: 4, 8");
		expect(created).toMatchObject({
			repositoryId,
			status: "draft",
			createdBy: "quality-coverage",
		});
	});

	it("uses a single relative file title and startedAt Date fallback", async () => {
		const startedAt = new Date("2026-08-03T04:05:06.000Z");
		prepareCoverageRun({
			completedAt: null,
			startedAt,
			coverageSummary: { "src/only.ts": coverageEntry() },
		});

		await createCoverageImprovementTask({
			repositoryId,
			runId,
			request: { fileKeys: ["src/only.ts"] },
		});

		const created = mocks.createTask.mock.calls[0]?.[0];
		expect(created.title).toBe("カバレッジ改善: src/only.ts");
		expect(created.description).toContain(startedAt.toISOString());
	});

	it("uses an external absolute basename and preserves invalid measured dates", async () => {
		prepareCoverageRun({
			completedAt: "not-a-date",
			coverageSummary: { "/outside/deep/file.ts": coverageEntry() },
		});

		await createCoverageImprovementTask({
			repositoryId,
			runId,
			request: { fileKeys: ["/outside/deep/file.ts"] },
		});

		const created = mocks.createTask.mock.calls[0]?.[0];
		expect(created.title).toBe("カバレッジ改善: file.ts");
		expect(created.description).toContain("Measured at: not-a-date");
	});

	it("normalizes Windows paths and a trailing project-root separator", async () => {
		mocks.getRepository.mockResolvedValue(
			repository({ registeredRootCanonical: "C:\\repo\\" }),
		);
		prepareCoverageRun({
			coverageSummary: { "C:\\repo\\src\\file.ts": coverageEntry() },
		});

		await createCoverageImprovementTask({
			repositoryId,
			runId,
			request: { fileKeys: ["C:\\repo\\src\\file.ts"] },
		});

		expect(mocks.createTask.mock.calls[0]?.[0].title).toBe(
			"カバレッジ改善: src/file.ts",
		);
	});

	it("renders unavailable metrics and uncovered-line variants", async () => {
		prepareCoverageRun({
			coverageSummary: {
				"src/missing.ts": coverageEntry({
					statements: null,
					branches: [],
					functions: { pct: Number.NaN },
					lines: { pct: "100" },
					uncoveredLines: "4",
				}),
				"src/empty.ts": coverageEntry({ uncoveredLines: [false, null] }),
			},
		});

		await createCoverageImprovementTask({
			repositoryId,
			runId,
			request: { fileKeys: ["src/missing.ts", "src/empty.ts"] },
		});

		const description = mocks.createTask.mock.calls[0]?.[0].description;
		expect(description.match(/statements: —/g)).toHaveLength(1);
		expect(description.match(/uncovered lines: —/g)).toHaveLength(2);
	});

	it.each([
		null,
		0,
		"bad",
		[],
	])("rejects an invalid coverage summary: %j", async (coverageSummary) => {
		prepareCoverageRun({ coverageSummary });
		mocks.listRuns.mockResolvedValue([
			qualityRun({ coverageSummary: { total: {} } }),
		]);
		await expectAppError(
			createCoverageImprovementTask({
				repositoryId,
				runId,
				request: { fileKeys: ["src/file.ts"] },
			}),
			"VALIDATION_ERROR",
			"Coverage summary is not available for this run",
		);
	});

	it("rejects the total row", async () => {
		prepareCoverageRun({ coverageSummary: { total: coverageEntry() } });
		await expectAppError(
			createCoverageImprovementTask({
				repositoryId,
				runId,
				request: { fileKeys: ["total"] },
			}),
			"VALIDATION_ERROR",
			"Coverage total row cannot become a task",
		);
	});

	it.each([
		undefined,
		null,
		0,
		"bad",
		[],
	])("rejects a missing or invalid selected coverage entry: %j", async (entry) => {
		prepareCoverageRun({ coverageSummary: { "src/file.ts": entry } });
		await expectAppError(
			createCoverageImprovementTask({
				repositoryId,
				runId,
				request: { fileKeys: ["src/file.ts"] },
			}),
			"VALIDATION_ERROR",
			"Coverage file was not found in this run",
		);
	});

	it("rejects a stale coverage run when no artifact exists", async () => {
		prepareCoverageRun();
		mocks.listRuns.mockResolvedValue([
			qualityRun({ id: "new", coverageSummary: null }),
		]);

		await expectAppError(
			createCoverageImprovementTask({
				repositoryId,
				runId,
				request: { fileKeys: ["src/file.ts"] },
			}),
			"STALE_COVERAGE_RUN",
		);
	});

	it("rejects a stale coverage run when a newer artifact exists", async () => {
		prepareCoverageRun();
		mocks.listRuns.mockResolvedValue([
			qualityRun({ id: "new", coverageSummary: { total: {} } }),
		]);

		await expectAppError(
			createCoverageImprovementTask({
				repositoryId,
				runId,
				request: { fileKeys: ["src/file.ts"] },
			}),
			"STALE_COVERAGE_RUN",
		);
	});

	it("supports an empty file selection as a defensive boundary", async () => {
		prepareCoverageRun();

		await createCoverageImprovementTask({
			repositoryId,
			runId,
			request: { fileKeys: [] },
		});

		expect(mocks.createTask.mock.calls[0]?.[0].title).toBe(
			"カバレッジ改善: 0ファイル",
		);
	});
});
