import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	getSession: vi.fn(),
	getRecommendationByRun: vi.fn(),
	listArtifacts: vi.fn(),
	listFindings: vi.fn(),
	listPromptSuggestions: vi.fn(),
	listSecurityHandoffs: vi.fn(),
	upsertArtifact: vi.fn(),
	createSession: vi.fn(),
	getLatestSession: vi.fn(),
	getRecommendation: vi.fn(),
	startRunForSession: vi.fn(),
	createRunEvent: vi.fn(),
	planSections: vi.fn(),
}));

vi.mock("../api/modules/review/review-mode.repository", () => ({
	getReviewSession: mocks.getSession,
	getReviewRecommendationByRun: mocks.getRecommendationByRun,
	listReviewArtifacts: mocks.listArtifacts,
	listReviewFindings: mocks.listFindings,
	listReviewPromptSuggestions: mocks.listPromptSuggestions,
	listReviewSecurityHandoffs: mocks.listSecurityHandoffs,
	upsertReviewArtifact: mocks.upsertArtifact,
	createOrStartReviewSession: mocks.createSession,
	getLatestReviewSessionForTask: mocks.getLatestSession,
}));

vi.mock("../api/modules/review/review-recommendation.service", () => ({
	getOrCreateReviewRecommendation: mocks.getRecommendation,
}));

vi.mock("../api/modules/review/review-run.service", () => ({
	startReviewRunForSession: mocks.startRunForSession,
}));

vi.mock("../api/modules/nightworkers/nightworkers.repository", () => ({
	createRunEvent: mocks.createRunEvent,
}));

vi.mock("../api/modules/review/review-mode.model", () => ({
	countFindings: (findings: Array<{ severity: string }>) => ({
		blocking: findings.filter((item) => item.severity === "blocking").length,
		warning: findings.filter((item) => item.severity === "warning").length,
		info: findings.filter((item) => item.severity === "info").length,
	}),
	planSections: mocks.planSections,
	rowArtifact: (row: unknown) => row,
	rowFinding: (row: unknown) => row,
	rowPromptSuggestion: (row: unknown) => row,
	rowRecommendation: (row: unknown) => row ?? null,
	rowSecurityHandoff: (row: unknown) => row,
	rowSession: (row: unknown) => row ?? null,
}));

import {
	autoStartReviewSessionForRun,
	getLatestReviewSessionDetailForTask,
	getReviewSessionDetail,
	startReviewRun,
	startReviewSessionForRun,
} from "../api/modules/review/review-mode.service";

const session = {
	id: "session-1",
	runId: "run-1",
	taskId: "task-1",
	repositoryId: "repository-1",
	recommendationId: "recommendation-1",
};
const recommendation = {
	id: "recommendation-1",
	runId: "run-1",
	taskId: "task-1",
	repositoryId: "repository-1",
	level: "required",
	reasons: [
		{
			code: "large_diff",
			evidenceRefs: [{ kind: "run_event", id: "event-1" }],
		},
	],
};

beforeEach(() => {
	vi.clearAllMocks();
	mocks.getSession.mockResolvedValue(session);
	mocks.getRecommendationByRun.mockResolvedValue(recommendation);
	mocks.listArtifacts.mockResolvedValue([]);
	mocks.listFindings.mockResolvedValue([]);
	mocks.listPromptSuggestions.mockResolvedValue([]);
	mocks.listSecurityHandoffs.mockResolvedValue([]);
	mocks.upsertArtifact.mockResolvedValue({ id: "status-artifact" });
	mocks.createSession.mockResolvedValue(session);
	mocks.getLatestSession.mockResolvedValue(session);
	mocks.getRecommendation.mockResolvedValue(recommendation);
	mocks.startRunForSession.mockResolvedValue(undefined);
	mocks.createRunEvent.mockResolvedValue(undefined);
	mocks.planSections.mockReturnValue([
		{ kind: "findings", requirement: "optional", reason: "inspect" },
	]);
});

describe("review mode service extra coverage", () => {
	it("rejects missing recommendations and missing sessions", async () => {
		mocks.getRecommendation.mockResolvedValueOnce(null);
		await expect(startReviewSessionForRun("missing-run")).rejects.toThrow(
			"Review recommendation not found",
		);

		mocks.getSession.mockResolvedValueOnce(null);
		await expect(getReviewSessionDetail("missing-session")).rejects.toThrow(
			"Review session not found",
		);
	});

	it("starts a review session and builds its detail", async () => {
		const result = await startReviewSessionForRun("run-1");
		expect(mocks.createSession).toHaveBeenCalledWith({
			runId: "run-1",
			taskId: "task-1",
			repositoryId: "repository-1",
			recommendationId: "recommendation-1",
		});
		expect(result).toMatchObject({
			session,
			recommendation,
		});
		expect(mocks.upsertArtifact).toHaveBeenCalledWith(
			expect.objectContaining({
				artifactJson: expect.objectContaining({ reviewSessionId: "session-1" }),
			}),
		);
	});

	it("auto-starts and records a canonical run event", async () => {
		const result = await autoStartReviewSessionForRun("run-1");
		expect(result.session).toEqual(session);
		expect(mocks.createRunEvent).toHaveBeenCalledWith(
			expect.objectContaining({
				runId: "run-1",
				taskId: "task-1",
				type: "review.session_auto_started",
				data: { reviewSessionId: "session-1" },
			}),
		);
	});

	it("starts a review run with optional inputs before refreshing detail", async () => {
		const options = { securityReview: true };
		const missionInput = { trigger: "manual" } as never;
		await startReviewRun("session-1", options, missionInput);
		expect(mocks.startRunForSession).toHaveBeenCalledWith(
			"session-1",
			options,
			missionInput,
		);
	});

	it("returns null for a task without a review or resolves the latest detail", async () => {
		mocks.getLatestSession.mockResolvedValueOnce(null);
		await expect(
			getLatestReviewSessionDetailForTask("empty-task"),
		).resolves.toBeNull();
		await expect(
			getLatestReviewSessionDetailForTask("task-1"),
		).resolves.toMatchObject({ session });
	});

	it("uses the fallback recommendation query and rejects an absent recommendation", async () => {
		mocks.getSession.mockResolvedValue({ ...session, recommendationId: null });
		mocks.getRecommendationByRun.mockResolvedValue(null);
		await expect(getReviewSessionDetail("session-1")).rejects.toThrow(
			"Review recommendation not found",
		);
		expect(mocks.getRecommendationByRun).toHaveBeenCalledOnce();
	});

	it("reports required sections remaining with finding and artifact counts", async () => {
		mocks.planSections.mockReturnValue([
			{ kind: "findings", requirement: "required", reason: "required" },
			{ kind: "security_review", requirement: "omitted", reason: "omitted" },
			{
				kind: "prompt_suggestions",
				requirement: "optional",
				reason: "optional",
			},
		]);
		mocks.listArtifacts.mockResolvedValue([
			{ id: "status", kind: "review_status", artifactJson: { previous: true } },
			{ id: "security", kind: "security_review", status: "blocked" },
		]);
		mocks.listFindings.mockResolvedValue([
			{
				id: "blocking",
				sourceSection: null,
				severity: "blocking",
				dispositionStatus: "unresolved",
			},
			{
				id: "warning",
				sourceSection: "findings",
				severity: "warning",
				dispositionStatus: "accepted",
			},
			{
				id: "info",
				sourceSection: "findings",
				severity: "info",
				dispositionStatus: "dismissed",
			},
		]);
		mocks.listPromptSuggestions.mockResolvedValue([
			{ id: "draft", status: "draft" },
			{ id: "used", status: "used" },
		]);
		mocks.listSecurityHandoffs.mockResolvedValue([{ id: "handoff" }]);

		await getReviewSessionDetail("session-1");
		const statusArtifact =
			mocks.upsertArtifact.mock.calls.at(-1)?.[0].artifactJson;
		expect(statusArtifact).toMatchObject({
			finalActionGate: {
				canApprove: false,
				blockingReason: "Required review sections are not complete.",
				requiredSectionKindsRemaining: ["findings"],
			},
			promptSuggestionCount: 1,
			securityHandoffCount: 1,
		});
	});

	it("blocks on unresolved required findings and approves resolved findings", async () => {
		mocks.planSections.mockReturnValue([
			{ kind: "findings", requirement: "required", reason: "required" },
		]);
		mocks.listArtifacts.mockResolvedValue([
			{ id: "findings-artifact", kind: "findings", status: "done" },
		]);
		mocks.listFindings.mockResolvedValue([
			{
				id: "blocking",
				sourceSection: "findings",
				severity: "blocking",
				dispositionStatus: "unresolved",
			},
		]);
		await getReviewSessionDetail("session-1");
		let statusArtifact =
			mocks.upsertArtifact.mock.calls.at(-1)?.[0].artifactJson;
		expect(statusArtifact.finalActionGate).toMatchObject({
			canApprove: false,
			blockingReason: "Unresolved blocking findings remain.",
			unresolvedBlockingFindingIds: ["blocking"],
		});

		mocks.listFindings.mockResolvedValue([
			{
				id: "resolved",
				sourceSection: "findings",
				severity: "blocking",
				dispositionStatus: "converted",
			},
		]);
		await getReviewSessionDetail("session-1");
		statusArtifact = mocks.upsertArtifact.mock.calls.at(-1)?.[0].artifactJson;
		expect(statusArtifact.finalActionGate).toMatchObject({
			canApprove: true,
			blockingReason: null,
			unresolvedBlockingFindingIds: [],
		});
	});

	it("rejects a session or recommendation that disappears during detail refresh", async () => {
		mocks.getSession.mockResolvedValueOnce(session).mockResolvedValueOnce(null);
		await expect(getReviewSessionDetail("vanished-session")).rejects.toThrow(
			"Review session not found",
		);

		mocks.getSession.mockResolvedValue(session);
		mocks.getRecommendationByRun
			.mockResolvedValueOnce(recommendation)
			.mockResolvedValueOnce(null);
		await expect(
			getReviewSessionDetail("vanished-recommendation"),
		).rejects.toThrow("Review recommendation not found");
	});
});
