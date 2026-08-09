import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	getLatestVerificationDocumentForTask: vi.fn(),
	getTaskRun: vi.fn(),
	listReviewArtifacts: vi.fn(),
	listReviewFindings: vi.fn(),
	listTaskEventsForRun: vi.fn(),
	listTaskRunsForTask: vi.fn(),
	listVerificationChecklistItems: vi.fn(),
	listVerificationEvidenceRuns: vi.fn(),
}));

vi.mock("../api/modules/nightworkers/nightworkers.repository", () => ({
	getTaskRun: mocks.getTaskRun,
	listTaskEventsForRun: mocks.listTaskEventsForRun,
	listTaskRunsForTask: mocks.listTaskRunsForTask,
}));

vi.mock(
	"../api/modules/nightworkers/nightworkers.verification.repository",
	() => ({
		getLatestVerificationDocumentForTask:
			mocks.getLatestVerificationDocumentForTask,
		listVerificationChecklistItems: mocks.listVerificationChecklistItems,
		listVerificationEvidenceRuns: mocks.listVerificationEvidenceRuns,
	}),
);

vi.mock("../api/modules/review/review-mode.repository", () => ({
	listReviewArtifacts: mocks.listReviewArtifacts,
	listReviewFindings: mocks.listReviewFindings,
}));

import { resolveReviewCloseoutEvidence } from "../api/modules/review/review-closeout-evidence.service";

const generatedAt = new Date("2026-08-01T00:00:00.000Z");
const finishedAt = new Date("2026-08-02T00:00:00.000Z");
const updatedAt = new Date("2026-08-03T00:00:00.000Z");

function artifact(
	kind: string,
	status: string,
	artifactJson: unknown = {},
	date = updatedAt,
) {
	return { kind, status, artifactJson, updatedAt: date };
}

function event(id: string, type: string, data: unknown, timestamp = updatedAt) {
	return {
		id,
		timestamp,
		payloadJson: { runEvent: { type, data } },
	};
}

function completionEvent(
	id = "completion-1",
	documentId = "document-1",
	timestamp = updatedAt,
) {
	return event(
		id,
		"tool.call_finished",
		{
			toolName: "completion_check",
			ok: true,
			arguments: { verificationDocumentId: documentId },
		},
		timestamp,
	);
}

function checklistItem(input: Record<string, unknown> = {}) {
	return {
		id: "item-1",
		required: true,
		status: "passed",
		verificationKind: "automated_test",
		evidenceIds: ["evidence-1"],
		...input,
	};
}

function evidenceRun(input: Record<string, unknown> = {}) {
	return {
		id: "evidence-1",
		taskId: "task-1",
		verificationDocumentId: "document-1",
		runId: "run-1",
		exitCode: 0,
		finishedAt,
		...input,
	};
}

async function resolve() {
	return resolveReviewCloseoutEvidence({
		runId: "run-1",
		taskId: "task-1",
		reviewSessionId: "review-session-1",
		implementationFinishedAt: finishedAt,
	});
}

beforeEach(() => {
	vi.resetAllMocks();
	mocks.listReviewArtifacts.mockResolvedValue([]);
	mocks.listReviewFindings.mockResolvedValue([]);
	mocks.listTaskEventsForRun.mockResolvedValue([]);
	mocks.listTaskRunsForTask.mockResolvedValue([]);
	mocks.getLatestVerificationDocumentForTask.mockResolvedValue(null);
	mocks.getTaskRun.mockResolvedValue(null);
	mocks.listVerificationChecklistItems.mockResolvedValue([]);
	mocks.listVerificationEvidenceRuns.mockResolvedValue([]);
});

describe("review closeout evidence extra coverage", () => {
	it("returns missing evidence and classifies every unresolved blocking finding", async () => {
		mocks.listReviewArtifacts.mockResolvedValue([
			artifact("other", "done", null),
		]);
		mocks.listReviewFindings.mockResolvedValue([
			{ id: "warning", severity: "warning", dispositionStatus: "unresolved" },
			{
				id: "unresolved",
				severity: "blocking",
				dispositionStatus: "unresolved",
			},
			{
				id: "dismissed-empty",
				severity: "blocking",
				dispositionStatus: "dismissed",
				dispositionNote: "  ",
			},
			{
				id: "dismissed-note",
				severity: "blocking",
				dispositionStatus: "dismissed",
				dispositionNote: "not relevant",
			},
			{
				id: "accepted-empty",
				severity: "blocking",
				dispositionStatus: "accepted",
				disposition: "accepted_risk",
				dispositionNote: "approved",
				evidenceRefsJson: [],
			},
			{
				id: "accepted-no-note",
				severity: "blocking",
				dispositionStatus: "accepted",
				disposition: "accepted_risk",
				dispositionNote: null,
				evidenceRefsJson: [{}],
			},
			{
				id: "accepted-valid",
				severity: "blocking",
				dispositionStatus: "accepted",
				disposition: "accepted_risk",
				dispositionNote: "approved",
				evidenceRefsJson: [{}],
			},
		]);

		const result = await resolve();

		expect(result).toEqual({
			review: {
				source: "missing",
				status: "not_started",
				reviewRunId: null,
				completedAt: null,
			},
			verification: {
				source: "missing",
				status: "missing",
				verificationDocumentId: null,
				evidenceRunIds: [],
				completionCheckEventId: null,
				reason: "実装Runの完了証跡がありません。",
			},
			security: {
				source: "missing",
				status: "missing",
				scanRunId: null,
				eventId: null,
				reason: "実装 finalization の Security Oracle 証跡がありません。",
			},
			findings: {
				unresolvedBlockingIds: [
					"unresolved",
					"dismissed-empty",
					"accepted-empty",
					"accepted-no-note",
				],
			},
		});
	});

	it("accepts a completed review run and a policy skip with a reason", async () => {
		mocks.listReviewArtifacts.mockResolvedValue([
			artifact("review_run", "done", {
				reviewRunId: "review-run-1",
				status: "done",
			}),
		]);
		mocks.listTaskEventsForRun.mockResolvedValue([
			event("review-completed", "review.run_completed", {
				reviewedRunId: "run-1",
				reviewRunId: "review-run-1",
				status: "done",
			}),
			event("skip", "system.info", {
				action: "security.oracle_gate_skipped",
				reason: "  no security impact  ",
			}),
		]);

		const result = await resolve();

		expect(result.review).toEqual({
			source: "review_run",
			status: "done",
			reviewRunId: "review-run-1",
			completedAt: updatedAt.toISOString(),
		});
		expect(result.security).toMatchObject({
			source: "policy_skip",
			status: "skipped",
			eventId: "skip",
			reason: "no security impact",
		});
	});

	it.each([
		["running", { reviewRunId: "review-run-1", status: "done" }],
		["done", { reviewRunId: null, status: "done" }],
		["unknown", { reviewRunId: "review-run-1" }],
	])("rejects inconsistent review artifacts (%s)", async (status, artifactJson) => {
		mocks.listReviewArtifacts.mockResolvedValue([
			artifact("review_run", status, artifactJson),
		]);
		mocks.listTaskEventsForRun.mockResolvedValue([
			event("wrong-completion", "review.run_completed", {
				reviewedRunId: "other-run",
				reviewRunId: "review-run-1",
				status: "done",
			}),
		]);

		const result = await resolve();

		expect(result.review.status).toBe("failed");
		expect(result.review.completedAt).toBeNull();
	});

	it("supports legacy review and verification evidence only without a review run", async () => {
		mocks.listReviewArtifacts.mockResolvedValue([
			artifact("test_coverage", "done", {}),
		]);

		const result = await resolve();

		expect(result.review).toMatchObject({
			source: "legacy_test_coverage",
			status: "done",
		});
		expect(result.verification).toMatchObject({
			source: "legacy_test_coverage",
			status: "passed",
			reason: "Legacy Review Mode evidence compatibility.",
		});
	});

	it("passes a complete active verification checklist", async () => {
		mocks.getLatestVerificationDocumentForTask.mockResolvedValue({
			id: "document-1",
			status: "active",
			generatedAt,
		});
		mocks.getTaskRun.mockResolvedValue({ id: "run-1" });
		mocks.listVerificationChecklistItems.mockResolvedValue([
			checklistItem(),
			checklistItem({
				id: "optional",
				required: false,
				status: "pending",
				evidenceIds: [],
			}),
		]);
		mocks.listVerificationEvidenceRuns.mockResolvedValue([evidenceRun()]);
		mocks.listTaskEventsForRun.mockResolvedValue([completionEvent()]);

		const result = await resolve();

		expect(result.verification).toEqual({
			source: "verification_checklist",
			status: "passed",
			verificationDocumentId: "document-1",
			evidenceRunIds: ["evidence-1"],
			completionCheckEventId: "completion-1",
			reason: null,
		});
	});

	it.each([
		{
			name: "failed evidence",
			items: [checklistItem()],
			runs: [evidenceRun({ exitCode: 1 })],
			expected: "failed",
			reason: "Test evidence に失敗した実行があります。",
		},
		{
			name: "missing linked evidence",
			items: [checklistItem({ evidenceIds: [] })],
			runs: [],
			expected: "incomplete",
			reason:
				"Verification checklist から managed evidence run への参照が不足しています。",
		},
		{
			name: "incomplete checklist",
			items: [checklistItem({ status: "pending" })],
			runs: [evidenceRun()],
			expected: "incomplete",
			reason: "Verification checklist または completion_check が未完了です。",
		},
	])("reports $name", async ({ items, runs, expected, reason }) => {
		mocks.getLatestVerificationDocumentForTask.mockResolvedValue({
			id: "document-1",
			status: "active",
			generatedAt,
		});
		mocks.getTaskRun.mockResolvedValue({ id: "run-1" });
		mocks.listVerificationChecklistItems.mockResolvedValue(items);
		mocks.listVerificationEvidenceRuns.mockResolvedValue(runs);
		mocks.listTaskEventsForRun.mockResolvedValue([completionEvent()]);

		const result = await resolve();

		expect(result.verification.status).toBe(expected);
		expect(result.verification.reason).toBe(reason);
	});

	it("marks pre-review evidence stale when fixes were applied", async () => {
		mocks.listReviewArtifacts.mockResolvedValue([
			artifact("review_run", "running", {
				reviewRunId: "review-run-1",
				fixesApplied: true,
			}),
		]);
		mocks.getLatestVerificationDocumentForTask.mockResolvedValue({
			id: "document-1",
			status: "active",
			generatedAt,
		});
		mocks.getTaskRun.mockResolvedValue({ id: "run-1" });
		mocks.listVerificationChecklistItems.mockResolvedValue([checklistItem()]);
		mocks.listVerificationEvidenceRuns.mockResolvedValue([
			evidenceRun({ finishedAt }),
		]);

		const result = await resolve();

		expect(result.verification.status).toBe("stale");
		expect(result.verification.reason).toContain("再検証証跡");
	});

	it.each([
		["passed", true, "passed"],
		["failed", false, "failed"],
		["pending", false, "blocked"],
	])("normalizes Security Oracle status %s", async (gateStatus, allowFinalize, expected) => {
		mocks.listTaskEventsForRun.mockResolvedValue([
			event("gate", "system.info", {
				action: "security.oracle_gate_finished",
				securityGate: {
					allowFinalize,
					status: gateStatus,
					scanRunId: 123,
					message: gateStatus === "passed" ? "ok" : null,
				},
			}),
		]);

		const result = await resolve();

		expect(result.security).toMatchObject({
			source: "security_oracle",
			status: expected,
			scanRunId: null,
			eventId: "gate",
		});
	});

	it("rejects an empty security policy skip reason", async () => {
		mocks.listTaskEventsForRun.mockResolvedValue([
			event("skip", "system.info", {
				action: "security.oracle_gate_skipped",
				reason: 42,
			}),
		]);

		const result = await resolve();

		expect(result.security).toMatchObject({
			source: "policy_skip",
			status: "failed",
			reason: "Security Oracle policy skip reason is missing.",
		});
	});
});
