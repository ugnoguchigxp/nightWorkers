import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	mkdir: vi.fn(),
	writeFile: vi.fn(),
	execFileSync: vi.fn(),
	getTaskRun: vi.fn(),
	getVerification: vi.fn(),
	createReview: vi.fn(),
	completionCheck: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
	default: { mkdir: mocks.mkdir, writeFile: mocks.writeFile },
}));
vi.mock("node:child_process", () => ({ execFileSync: mocks.execFileSync }));
vi.mock("../api/modules/nightworkers/nightworkers.repository", () => ({
	getTaskRun: mocks.getTaskRun,
}));
vi.mock(
	"../api/modules/nightworkers/nightworkers.verification.repository",
	() => ({ getLatestVerificationDocumentForTask: mocks.getVerification }),
);
vi.mock("../api/modules/review/review-files.service", () => ({
	createReviewerEvaluation: mocks.createReview,
}));
vi.mock(
	"../api/modules/codingAgent/application/completion-check.service",
	() => ({ runCompletionCheck: mocks.completionCheck }),
);

import { runE2eFixtureRuntime } from "../api/modules/codingAgent/runtime/e2e-fixture-runtime";

function context(
	marker = "[fixture:success]",
	overrides: Record<string, unknown> = {},
) {
	return {
		runId: "run-1",
		taskId: "task-1",
		repoRoot: "/repo",
		compiledPrompt: marker,
		latestUserMessage: "",
		timeoutSeconds: 0,
		runtimeOptions: {},
		...overrides,
	} as never;
}

describe("E2E fixture runtime extra coverage", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.mkdir.mockResolvedValue(undefined);
		mocks.writeFile.mockResolvedValue(undefined);
		mocks.execFileSync.mockReturnValue("diff");
		mocks.getTaskRun.mockResolvedValue(null);
		mocks.getVerification.mockResolvedValue(null);
		mocks.createReview.mockResolvedValue(undefined);
		mocks.completionCheck.mockResolvedValue({ ok: true, result: "passed" });
	});

	afterEach(() => vi.useRealTimers());

	it("returns policy, tool, and verification failures", async () => {
		for (const [marker, terminalState, stoppedBy, eventType] of [
			["[fixture:policy-block]", "needs_human", "policy", "runtime_warning"],
			["[fixture:tool_failure]", "failed", "tool_failure", "runtime_error"],
			[
				"[fixture:verification_failure]",
				"needs_human",
				"tool_failure",
				"verification_finished",
			],
		] as const) {
			const sink = { emit: vi.fn(async () => undefined) };
			const result = await runE2eFixtureRuntime(context(marker), sink);
			expect(result).toMatchObject({
				terminalState,
				stoppedBy,
				testResults: { behavior: marker.slice(9, -1) },
			});
			expect(sink.emit).toHaveBeenCalledWith(
				expect.objectContaining({ type: eventType }),
			);
		}
	});

	it("holds until the run disappears or is cancelled", async () => {
		mocks.getTaskRun
			.mockResolvedValueOnce({ status: "running" })
			.mockResolvedValueOnce({ status: "cancelled" });
		vi.useFakeTimers();
		const promise = runE2eFixtureRuntime(
			context("[fixture:hold_until_stopped]"),
			{ emit: vi.fn(async () => undefined) },
		);
		await vi.advanceTimersByTimeAsync(25);
		await expect(promise).resolves.toMatchObject({
			terminalState: "cancelled",
		});
	});

	it("waits for the configured timeout with a minimum of one second", async () => {
		vi.useFakeTimers();
		const sink = { emit: vi.fn(async () => undefined) };
		const promise = runE2eFixtureRuntime(
			context("[fixture:timeout]", { timeoutSeconds: 0 }),
			sink,
		);
		await vi.advanceTimersByTimeAsync(1_000);
		await expect(promise).resolves.toMatchObject({
			terminalState: "timed_out",
			stoppedBy: "budget",
		});
	});

	it("completes ordinary success without test or review runtime", async () => {
		const sink = { emit: vi.fn(async () => undefined) };
		const result = await runE2eFixtureRuntime(
			context("no marker", { runtimeOptions: { reviewRun: [] } }),
			sink,
		);
		expect(result).toMatchObject({
			terminalState: "completed",
			finalReport:
				"Deterministic E2E implementation and verification completed.",
			diffPatch: "diff",
		});
		expect(mocks.getVerification).not.toHaveBeenCalled();
		expect(mocks.createReview).not.toHaveBeenCalled();
	});

	it("records transient verification, completion check, and review success", async () => {
		mocks.getVerification.mockResolvedValue({ id: "verification-1" });
		mocks.completionCheck.mockResolvedValue({ ok: false, reason: "missing" });
		vi.useFakeTimers();
		const sink = { emit: vi.fn(async () => undefined) };
		const promise = runE2eFixtureRuntime(
			context("[fixture:success]", {
				compiledPrompt: "[fixture:success] [fixture:test-transient-failure]",
				runtimeOptions: {
					verificationDocumentId: "verification-1",
					reviewRun: {},
				},
			}),
			sink,
		);
		await vi.advanceTimersByTimeAsync(1_100);
		const result = await promise;
		expect(result.finalReport).toContain('"verdict":"pass"');
		expect(mocks.createReview).toHaveBeenCalled();
		expect(sink.emit).toHaveBeenCalledWith(
			expect.objectContaining({
				payload: expect.objectContaining({
					toolName: "completion_check",
					status: "failed",
				}),
			}),
		);
	});
});
