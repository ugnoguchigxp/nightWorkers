import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	createReviewFindings: vi.fn(),
	createRunEvent: vi.fn(),
	createTaskMessage: vi.fn(),
	getReviewSession: vi.fn(),
	listReviewArtifacts: vi.fn(),
	startTaskRun: vi.fn(),
	upsertReviewArtifact: vi.fn(),
}));

vi.mock("../api/modules/nightworkers/nightworkers.repository", () => ({
	createRunEvent: mocks.createRunEvent,
	createTaskMessage: mocks.createTaskMessage,
}));

vi.mock("../api/modules/review/review-mode.repository", () => ({
	createReviewFindings: mocks.createReviewFindings,
	getReviewSession: mocks.getReviewSession,
	listReviewArtifacts: mocks.listReviewArtifacts,
	upsertReviewArtifact: mocks.upsertReviewArtifact,
}));

vi.mock(
	"../api/modules/nightworkers/run-orchestration/start-task-run-entry",
	() => ({ startTaskRun: mocks.startTaskRun }),
);

import {
	finalizeReviewRunFromRuntime,
	parseReviewRunFindings,
} from "../api/modules/review/review-run-finalize.service";

const session = {
	id: "review-session-1",
	runId: "implementation-run-1",
	taskId: "task-1",
};

const warningFinding = {
	severity: "warning",
	title: "Fix the warning",
	body: "Warning evidence",
	path: "src/warning.ts",
};

function reviewContext(
	options: unknown = { applyFixes: false, commitChanges: false },
	input: Record<string, unknown> = {},
) {
	return {
		reviewRun: {
			reviewSessionId: session.id,
			reviewedRunId: session.runId,
			options,
		},
		...input,
	};
}

function runtimeInput(input: Record<string, unknown> = {}) {
	return {
		runId: "review-run-1",
		taskId: session.taskId,
		status: "completed" as const,
		contextSnapshot: reviewContext(),
		runtimeResult: {
			terminalState: "completed" as const,
			summary: "Review summary",
			finalReport: JSON.stringify({ findings: [warningFinding] }),
			stoppedBy: "decision" as const,
			riskLevel: "medium" as const,
			diffPatch: "",
			logContent: "",
		},
		...input,
	};
}

beforeEach(() => {
	vi.resetAllMocks();
	mocks.getReviewSession.mockResolvedValue(session);
	mocks.listReviewArtifacts.mockResolvedValue([]);
	mocks.createReviewFindings.mockResolvedValue([]);
	mocks.upsertReviewArtifact.mockResolvedValue({});
	mocks.createRunEvent.mockResolvedValue({});
	mocks.createTaskMessage.mockResolvedValue({});
	mocks.startTaskRun.mockResolvedValue({ id: "correction-run-1" });
});

describe("review run finalize service extra coverage", () => {
	it("parses JSON arrays, objects, fenced blocks, and normalized finding fields", () => {
		const array = parseReviewRunFindings(
			JSON.stringify([
				warningFinding,
				{
					severity: "blocking",
					category: "Blocking category",
					evidence: "Observed evidence",
					recommendedAction: "Apply the fix",
					file: "src/blocking.ts",
				},
				{
					severity: "info",
					title: "Informational",
					evidence: "Information only",
					recommendedAction: 123,
				},
			]),
		);
		expect(array).toEqual([
			warningFinding,
			{
				severity: "blocking",
				title: "Blocking category",
				body: "Observed evidence\nApply the fix",
				path: "src/blocking.ts",
			},
			{
				severity: "info",
				title: "Informational",
				body: "Information only",
				path: null,
			},
		]);

		const object = parseReviewRunFindings(
			JSON.stringify({
				findings: [
					{
						severity: "info",
						title: "  Trimmed title  ",
						body: 42,
						path: "src/info.ts",
					},
				],
			}),
		);
		expect(object).toEqual([
			{
				severity: "info",
				title: "Trimmed title",
				body: null,
				path: "src/info.ts",
			},
		]);

		const fenced = parseReviewRunFindings(
			[
				"```json",
				"not valid json",
				"```",
				"```",
				JSON.stringify([warningFinding]),
				"```",
			].join("\n"),
		);
		expect(fenced).toEqual([warningFinding]);
	});

	it("filters invalid JSON findings and falls back to bullet parsing", () => {
		const invalidJson = JSON.stringify({
			findings: [
				null,
				[],
				"text",
				{ severity: "critical", title: "invalid severity" },
				{ severity: "warning", title: "   " },
				{ severity: "warning", category: 123 },
			],
		});
		expect(parseReviewRunFindings(invalidJson)).toEqual([]);

		const bullets = parseReviewRunFindings(
			[
				"ignored line",
				"- [WARNING] Warning title (src/file.ts)",
				"* [info] Information title",
				"- [blocking] Blocking title ()",
			].join("\n"),
		);
		expect(bullets).toEqual([
			{
				severity: "warning",
				title: "Warning title",
				body: null,
				path: "src/file.ts",
			},
			{
				severity: "info",
				title: "Information title",
				body: null,
				path: null,
			},
			{
				severity: "blocking",
				title: "Blocking title ()",
				body: null,
				path: null,
			},
		]);
	});

	it("prefers valid JSON findings over bullet findings", () => {
		const parsed = parseReviewRunFindings(
			`\`\`\`json\n${JSON.stringify([warningFinding])}\n\`\`\`\n- [blocking] ignored bullet`,
		);
		expect(parsed).toEqual([warningFinding]);
	});

	it("ignores invalid snapshots, incomplete review identity, and missing sessions", async () => {
		for (const contextSnapshot of [
			null,
			"invalid",
			[],
			{},
			{ reviewRun: null },
			{ reviewRun: [] },
			{ reviewRun: {} },
			{ reviewRun: { reviewSessionId: session.id } },
			{ reviewRun: { reviewedRunId: session.runId } },
		]) {
			await finalizeReviewRunFromRuntime(
				runtimeInput({ contextSnapshot }) as never,
			);
		}
		expect(mocks.getReviewSession).not.toHaveBeenCalled();

		mocks.getReviewSession.mockResolvedValueOnce(null);
		await finalizeReviewRunFromRuntime(runtimeInput());
		expect(mocks.listReviewArtifacts).not.toHaveBeenCalled();
	});

	it("persists findings, merges existing payload, and emits a completed event", async () => {
		const findings = [
			warningFinding,
			{
				severity: "info",
				title: "Information",
				body: null,
				path: null,
			},
		];
		mocks.listReviewArtifacts.mockResolvedValue([
			{ kind: "other", artifactJson: { ignored: true } },
			{
				kind: "review_run",
				artifactJson: { preserved: "value", status: "old" },
			},
		]);
		await finalizeReviewRunFromRuntime(
			runtimeInput({
				status: "needs_review",
				runtimeResult: {
					...runtimeInput().runtimeResult,
					finalReport: JSON.stringify({ findings }),
				},
			}) as never,
		);
		expect(mocks.createReviewFindings).toHaveBeenCalledWith([
			expect.objectContaining({
				severity: "warning",
				evidenceRefsJson: [{ kind: "changed_file", path: "src/warning.ts" }],
			}),
			expect.objectContaining({ severity: "info", evidenceRefsJson: [] }),
		]);
		expect(mocks.upsertReviewArtifact).toHaveBeenCalledWith(
			expect.objectContaining({
				status: "done",
				artifactJson: expect.objectContaining({
					preserved: "value",
					status: "done",
					findings,
					fixesApplied: false,
				}),
			}),
		);
		expect(mocks.createRunEvent).toHaveBeenCalledWith(
			expect.objectContaining({
				runId: session.runId,
				type: "review.run_completed",
				severity: "info",
				data: expect.objectContaining({ findingCount: 2, status: "done" }),
			}),
		);
		expect(mocks.createTaskMessage).not.toHaveBeenCalled();
	});

	it("uses summary fallback and maps every terminal status without findings", async () => {
		const cases = [
			["completed", "done", "info"],
			["needs_human", "needs_human", "warning"],
			["failed", "failed", "warning"],
			["blocked", "failed", "warning"],
			["timed_out", "failed", "warning"],
			["cancelled", "failed", "warning"],
		] as const;
		for (const [status, artifactStatus, severity] of cases) {
			mocks.listReviewArtifacts.mockResolvedValueOnce([
				{ kind: "review_run", artifactJson: ["invalid"] },
			]);
			await finalizeReviewRunFromRuntime(
				runtimeInput({
					status,
					runtimeResult: {
						...runtimeInput().runtimeResult,
						finalReport: "",
						summary: `summary:${status}`,
					},
				}) as never,
			);
			expect(mocks.upsertReviewArtifact).toHaveBeenLastCalledWith(
				expect.objectContaining({
					status: artifactStatus,
					artifactJson: expect.objectContaining({
						finalReport: `summary:${status}`,
						findings: [],
					}),
				}),
			);
			expect(mocks.createRunEvent).toHaveBeenLastCalledWith(
				expect.objectContaining({ severity }),
			);
		}
		expect(mocks.createReviewFindings).not.toHaveBeenCalled();
	});

	it("starts correction with nested options, cycle, finding message, and null Run fallback", async () => {
		const findings = [
			warningFinding,
			{
				severity: "blocking",
				title: "Blocking finding",
				body: null,
				path: null,
			},
			{
				severity: "info",
				title: "Ignored in correction text",
				body: "info",
				path: "src/info.ts",
			},
		];
		mocks.startTaskRun.mockResolvedValueOnce(null);
		await finalizeReviewRunFromRuntime(
			runtimeInput({
				contextSnapshot: reviewContext(
					{ options: { applyFixes: true, commitChanges: true } },
					{ reviewCorrection: { cycle: 3 } },
				),
				runtimeResult: {
					...runtimeInput().runtimeResult,
					finalReport: JSON.stringify({ findings }),
				},
			}) as never,
		);
		expect(mocks.createTaskMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				role: "user",
				messageType: "review_correction_request",
				content: expect.stringContaining(
					"- [warning] Fix the warning (src/warning.ts): Warning evidence",
				),
			}),
		);
		expect(mocks.createTaskMessage.mock.calls[0]?.[0].content).toContain(
			"- [blocking] Blocking finding: ",
		);
		expect(mocks.createTaskMessage.mock.calls[0]?.[0].content).not.toContain(
			"Ignored in correction text",
		);
		expect(mocks.startTaskRun).toHaveBeenCalledWith(
			session.taskId,
			expect.objectContaining({
				latestUserMessageOverride:
					expect.stringContaining("Accepted findings:"),
				runtimeOptionsPatch: {
					reviewCorrection: expect.objectContaining({
						cycle: 4,
						applyFixes: true,
						commitChanges: true,
						findingCount: 3,
					}),
				},
			}),
		);
		expect(mocks.createRunEvent).toHaveBeenLastCalledWith(
			expect.objectContaining({
				type: "review.correction_requested",
				severity: "info",
				data: expect.objectContaining({ correctionRunId: null }),
			}),
		);
	});

	it("does not request correction for invalid options, info-only findings, or Mission Pilot ownership", async () => {
		const infoReport = JSON.stringify({
			findings: [{ severity: "info", title: "Information only", body: "none" }],
		});
		for (const contextSnapshot of [
			reviewContext(null),
			reviewContext([]),
			reviewContext({ options: [] }),
			reviewContext({ applyFixes: false, commitChanges: true }),
			reviewContext(
				{ applyFixes: true, commitChanges: true },
				{ missionPilot: {} },
			),
			reviewContext(
				{ applyFixes: true, commitChanges: true },
				{ missionPilot: null },
			),
		]) {
			const isInfoOnly = contextSnapshot.reviewRun.options === null;
			await finalizeReviewRunFromRuntime(
				runtimeInput({
					contextSnapshot,
					runtimeResult: {
						...runtimeInput().runtimeResult,
						finalReport: isInfoOnly
							? infoReport
							: runtimeInput().runtimeResult.finalReport,
					},
				}) as never,
			);
		}
		// The null Mission Pilot value is not ownership, so exactly that case can hand off.
		expect(mocks.startTaskRun).toHaveBeenCalledTimes(1);
	});

	it("normalizes invalid correction cycles to zero", async () => {
		const corrections = [
			null,
			[],
			{ cycle: -1 },
			{ cycle: 1.5 },
			{ cycle: "2" },
		];
		for (const reviewCorrection of corrections) {
			await finalizeReviewRunFromRuntime(
				runtimeInput({
					contextSnapshot: reviewContext(
						{ applyFixes: true, commitChanges: false },
						{ reviewCorrection },
					),
				}) as never,
			);
		}
		for (const call of mocks.startTaskRun.mock.calls) {
			expect(call[1]).toMatchObject({
				runtimeOptionsPatch: {
					reviewCorrection: { cycle: 1 },
				},
			});
		}
	});

	it("records Error and primitive correction handoff failures without escaping", async () => {
		mocks.createTaskMessage.mockRejectedValueOnce(new Error("message failed"));
		await expect(
			finalizeReviewRunFromRuntime(
				runtimeInput({
					contextSnapshot: reviewContext({ applyFixes: true }),
				}) as never,
			),
		).resolves.toBeUndefined();
		expect(mocks.createRunEvent).toHaveBeenLastCalledWith(
			expect.objectContaining({
				severity: "error",
				data: expect.objectContaining({ error: "message failed" }),
			}),
		);

		mocks.startTaskRun.mockRejectedValueOnce("primitive failure");
		await finalizeReviewRunFromRuntime(
			runtimeInput({
				contextSnapshot: reviewContext({ applyFixes: true }),
			}) as never,
		);
		expect(mocks.createRunEvent).toHaveBeenLastCalledWith(
			expect.objectContaining({
				severity: "error",
				data: expect.objectContaining({ error: "primitive failure" }),
			}),
		);
	});
});
