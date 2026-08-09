import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	getSession: vi.fn(),
	markStarted: vi.fn(),
	upsertArtifact: vi.fn(),
	createFindings: vi.fn(),
	updateSession: vi.fn(),
	createRunEvent: vi.fn(),
	createTaskMessage: vi.fn(),
	startTaskRun: vi.fn(),
	securitySettings: vi.fn(),
	buildTarget: vi.fn(),
	buildManifest: vi.fn(),
	findPlan: vi.fn(),
	findExisting: vi.fn(),
	artifactStatus: vi.fn(),
	buildArtifact: vi.fn(),
	runDiagnostic: vi.fn(),
	readCliSettings: vi.fn(),
	findingForResult: vi.fn(),
	mkdtemp: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
	default: { mkdtemp: mocks.mkdtemp },
	mkdtemp: mocks.mkdtemp,
}));

vi.mock("../api/modules/nightworkers/nightworkers.repository", () => ({
	createRunEvent: mocks.createRunEvent,
	createTaskMessage: mocks.createTaskMessage,
}));

vi.mock("../api/modules/nightworkers/run-orchestration/start-task-run", () => ({
	startTaskRun: mocks.startTaskRun,
}));

vi.mock("../api/modules/ontology", () => ({
	getProjectSecurityIntelligenceSettings: mocks.securitySettings,
}));

vi.mock("../api/modules/review/review-mode.repository", () => ({
	getReviewSession: mocks.getSession,
	markReviewSessionStarted: mocks.markStarted,
	upsertReviewArtifact: mocks.upsertArtifact,
	createReviewFindings: mocks.createFindings,
	updateReviewSession: mocks.updateSession,
}));

vi.mock("../api/modules/review/review-run-artifact", () => ({
	buildReviewRunArtifact: mocks.buildArtifact,
}));

vi.mock("../api/modules/review/review-run-idempotency.service", () => ({
	findExistingReviewTaskRun: mocks.findExisting,
	reviewRunArtifactStatus: mocks.artifactStatus,
}));

vi.mock("../api/modules/review/review-target-manifest", () => ({
	buildReviewTargetManifest: mocks.buildManifest,
}));

vi.mock("../api/modules/review/review-targets.service", () => ({
	buildReviewTarget: mocks.buildTarget,
	findLatestPlanArtifact: mocks.findPlan,
}));

vi.mock("../api/modules/review/review-vulnworkbench.service", () => ({
	findingForVulnWorkbenchResult: mocks.findingForResult,
	readVulnWorkbenchCliSettings: mocks.readCliSettings,
	runVulnWorkbenchSecurityDiagnostic: mocks.runDiagnostic,
}));

import {
	buildReviewRunPrompt,
	buildReviewRunTodos,
	normalizeReviewRunOptions,
	resolveReviewTargetRunIds,
	startReviewRunForSession,
} from "../api/modules/review/review-run.service";

const session = {
	id: "review-session",
	runId: "source-run",
	taskId: "task-1",
	repositoryId: "repository-1",
	status: "not_started",
};

const baseTarget = {
	runId: "source-run",
	taskId: "task-1",
	repositoryId: "repository-1",
	repoRoot: "/repo",
	planArtifact: { messageId: null, title: null, source: "missing" },
	targetFiles: [
		{
			path: "src/a.ts",
			status: "modified",
			sources: ["current_git_diff"],
			eventIds: ["event-1", "event-2"],
			diff: "diff",
			diffBytes: 4,
		},
	],
	excludedDirtyFiles: ["dirty.ts"],
	signalOnlyFiles: [],
	diffOnlyFiles: [],
	warnings: [] as Array<{
		code: string;
		severity: "info" | "warning" | "blocking";
		message: string;
		paths?: string[];
	}>,
};

beforeEach(() => {
	vi.clearAllMocks();
	mocks.getSession.mockResolvedValue(session);
	mocks.markStarted.mockResolvedValue({ ...session, status: "in_progress" });
	mocks.upsertArtifact.mockImplementation(async (input) => ({
		id: `artifact-${input.kind}`,
		...input,
	}));
	mocks.createFindings.mockImplementation(async (rows) => rows);
	mocks.updateSession.mockResolvedValue({ ...session, status: "needs_human" });
	mocks.createRunEvent.mockResolvedValue(undefined);
	mocks.createTaskMessage.mockResolvedValue({ id: "message-1" });
	mocks.startTaskRun.mockResolvedValue({ id: "review-run-1" });
	mocks.securitySettings.mockResolvedValue({
		securityOracle: { effectiveEnabled: false, reason: "disabled" },
		eligibility: { eligible: false },
	});
	mocks.buildTarget.mockResolvedValue(baseTarget);
	mocks.buildManifest.mockResolvedValue({ digest: "manifest" });
	mocks.findPlan.mockResolvedValue(null);
	mocks.findExisting.mockResolvedValue(null);
	mocks.artifactStatus.mockReturnValue("done");
	mocks.buildArtifact.mockImplementation((input) => input);
	mocks.runDiagnostic.mockResolvedValue({ ok: true, findings: [] });
	mocks.readCliSettings.mockReturnValue({ command: "vuln" });
	mocks.findingForResult.mockReturnValue({
		severity: "warning",
		title: "scanner finding",
		body: "scanner body",
		evidenceRefsJson: [{ kind: "run_event", eventId: "scanner" }],
		sourceSection: "security_review",
	});
	mocks.mkdtemp.mockResolvedValue("/tmp/review-artifacts");
});

describe("review run service extra coverage", () => {
	it("normalizes legacy input and resolves missing mission targets", () => {
		expect(
			normalizeReviewRunOptions({
				testEvidenceReview: false,
				codeReview: false,
			} as never),
		).toMatchObject({ codeReview: false, securityReview: false });
		expect(resolveReviewTargetRunIds(null)).toBeUndefined();
	});

	it("builds the no-source todo and all prompt option branches", () => {
		const options = normalizeReviewRunOptions({
			codeReview: false,
			securityReview: false,
			applyFixes: false,
			commitChanges: false,
		});
		const todos = buildReviewRunTodos({
			options,
			target: baseTarget as never,
			planSpec: emptyPlan(),
		});
		expect(todos).toHaveLength(1);
		expect(todos[0]?.description).toContain("review option がない");

		const prompt = buildReviewRunPrompt({
			session: session as never,
			options,
			target: {
				...baseTarget,
				targetFiles: [],
				excludedDirtyFiles: [],
			} as never,
			planSpec: emptyPlan(),
			todos,
			initialFindings: [
				{ severity: "warning", title: "missing body", body: " " },
			],
		});
		expect(prompt).toContain("Review target boundary (metadata only):\n(none)");
		expect(prompt).toContain("Excluded dirty files:\n(none)");
		expect(prompt).toContain("(本文なし)");
		expect(prompt).toContain("applyFixes=false");
		expect(prompt).toContain("commitChanges=false");
	});

	it("rejects a missing review session", async () => {
		mocks.getSession.mockResolvedValueOnce(null);
		await expect(startReviewRunForSession("missing")).rejects.toThrow(
			"Review session not found",
		);
	});

	it("recovers an existing run, starts its session, and recreates a missing artifact", async () => {
		mocks.findExisting.mockResolvedValueOnce({
			run: { id: "existing-run", status: "completed" },
			artifact: null,
		});
		const result = await startReviewRunForSession("review-session");
		expect(result.reviewRun).toEqual({
			id: "existing-run",
			status: "completed",
		});
		expect(mocks.markStarted).toHaveBeenCalledOnce();
		expect(mocks.upsertArtifact).toHaveBeenCalledWith(
			expect.objectContaining({ kind: "review_run", status: "done" }),
		);
	});

	it("returns an existing artifact without restarting an active session", async () => {
		mocks.getSession.mockResolvedValueOnce({
			...session,
			status: "in_progress",
		});
		mocks.findExisting.mockResolvedValueOnce({
			run: { id: "existing-run", status: "running" },
			artifact: { id: "existing-artifact" },
		});
		await startReviewRunForSession("review-session");
		expect(mocks.markStarted).not.toHaveBeenCalled();
		expect(mocks.upsertArtifact).not.toHaveBeenCalled();
	});

	it("stops before a run when target extraction has blocking warnings", async () => {
		mocks.buildTarget.mockResolvedValueOnce({
			...baseTarget,
			warnings: [
				{
					code: "diff_read_failed",
					severity: "blocking",
					message: "diff missing",
					paths: ["a.ts", "b.ts"],
				},
				{
					code: "no_edit_signals",
					severity: "info",
					message: "informational",
				},
			],
		});
		mocks.markStarted.mockResolvedValueOnce(null);
		const result = await startReviewRunForSession("review-session", {
			securityReview: false,
		});
		expect(result.reviewRun).toBeNull();
		expect(mocks.createFindings).toHaveBeenCalledWith([
			expect.objectContaining({
				severity: "blocking",
				body: "diff missing\na.ts\nb.ts",
			}),
		]);
		expect(mocks.updateSession).toHaveBeenCalledWith(
			"review-session",
			expect.objectContaining({ status: "needs_human" }),
		);
		expect(mocks.startTaskRun).not.toHaveBeenCalled();
	});

	it("starts a review run with plan details and mission provenance", async () => {
		mocks.findPlan.mockResolvedValueOnce({
			id: "plan-message",
			title: "Plan",
			body: [
				"# Plan",
				"## Acceptance Criteria",
				"- accepted",
				"## Verification",
				"- tested",
				"## Security",
				"- secure",
				"## Scope",
				"- src/a.ts",
			].join("\n"),
		});
		const missionInput = {
			targetRunIds: ["source-run"],
			targetManifestContext: { taskDigest: "digest" },
			runAssociation: { kind: "review" },
			reviewCorrection: { phase: "review" },
		} as never;
		const result = await startReviewRunForSession(
			"review-session",
			{ codeReview: true },
			missionInput,
		);
		expect(result.reviewRun).toEqual({ id: "review-run-1" });
		expect(result.planSpec).toMatchObject({
			sourceMessageId: "plan-message",
			acceptanceCriteria: ["accepted"],
			verificationHints: ["tested"],
			securityNotes: ["secure"],
			implementationScopeHints: ["src/a.ts"],
		});
		expect(mocks.startTaskRun).toHaveBeenCalledWith(
			"task-1",
			expect.objectContaining({
				runAssociation: { kind: "review" },
				runtimeOptionsPatch: expect.objectContaining({
					reviewCorrection: { phase: "review" },
					reviewRun: expect.objectContaining({
						targetManifest: { digest: "manifest" },
					}),
				}),
			}),
		);
		expect(mocks.createTaskMessage).toHaveBeenCalled();
		expect(mocks.createRunEvent).toHaveBeenCalledWith(
			expect.objectContaining({ severity: "info", type: "review.run_started" }),
		);
	});

	it("records a policy-skipped security review as evidence", async () => {
		await startReviewRunForSession("review-session", {
			codeReview: false,
			securityReview: true,
		});
		expect(mocks.runDiagnostic).not.toHaveBeenCalled();
		expect(mocks.createFindings).toHaveBeenCalledWith([
			expect.objectContaining({
				severity: "info",
				title: expect.stringContaining("skipped"),
				evidenceRefsJson: [
					expect.objectContaining({ artifactKind: "security_review" }),
				],
			}),
		]);
	});

	it.each([
		[true, "done"],
		[false, "needs_human"],
	] as const)("runs enabled scanner diagnostics when ok=%s", async (ok, expectedStatus) => {
		mocks.securitySettings.mockResolvedValueOnce({
			securityOracle: { effectiveEnabled: true, reason: null },
			eligibility: { eligible: true },
		});
		mocks.runDiagnostic.mockResolvedValueOnce({ ok, findings: [] });
		await startReviewRunForSession("review-session", {
			codeReview: false,
			securityReview: true,
		});
		expect(mocks.mkdtemp).toHaveBeenCalled();
		expect(mocks.runDiagnostic).toHaveBeenCalledWith(
			expect.objectContaining({ artifactDir: "/tmp/review-artifacts" }),
		);
		expect(mocks.upsertArtifact).toHaveBeenCalledWith(
			expect.objectContaining({
				kind: "security_review",
				status: expectedStatus,
			}),
		);
		expect(mocks.createFindings).toHaveBeenCalledWith([
			expect.objectContaining({
				title: "scanner finding",
				evidenceRefsJson: expect.arrayContaining([
					expect.objectContaining({ artifactKind: "security_review" }),
				]),
			}),
		]);
	});
});

function emptyPlan() {
	return {
		sourceMessageId: null,
		title: null,
		body: "",
		acceptanceCriteria: [],
		verificationHints: [],
		securityNotes: [],
		implementationScopeHints: [],
	};
}
