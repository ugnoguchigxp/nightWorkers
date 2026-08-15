import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	getTaskRun: vi.fn(),
	getTask: vi.fn(),
	getRepository: vi.fn(),
	getLatestFinalResponseEvidence: vi.fn(),
	getEvidenceSubject: vi.fn(),
	bindEvidenceSubject: vi.fn(),
	captureWorkspaceSourceSnapshot: vi.fn(),
	getReviewSessionByRun: vi.fn(),
	listReviewArtifacts: vi.fn(),
	readReviewTargetManifest: vi.fn(),
	resolveReviewCloseoutEvidence: vi.fn(),
	selectResults: [] as unknown[][],
	insertResults: [] as unknown[][],
	updateResults: [] as unknown[][],
}));

vi.mock("../api/modules/nightworkers/nightworkers.repository", () => ({
	getTaskRun: mocks.getTaskRun,
	getTask: mocks.getTask,
	getRepository: mocks.getRepository,
}));
vi.mock("../api/modules/evidenceLedger", () => ({
	getLatestFinalResponseEvidence: mocks.getLatestFinalResponseEvidence,
	getEvidenceSubject: mocks.getEvidenceSubject,
	bindEvidenceSubject: mocks.bindEvidenceSubject,
}));
vi.mock("../api/modules/codingAgent", () => ({
	captureWorkspaceSourceSnapshot: mocks.captureWorkspaceSourceSnapshot,
}));
vi.mock("../api/modules/review/review-mode.repository", () => ({
	getReviewSessionByRun: mocks.getReviewSessionByRun,
	listReviewArtifacts: mocks.listReviewArtifacts,
}));
vi.mock("../api/modules/review/review-target-manifest", () => ({
	readReviewTargetManifest: mocks.readReviewTargetManifest,
}));
vi.mock("../api/modules/review/review-closeout-evidence.service", () => ({
	resolveReviewCloseoutEvidence: mocks.resolveReviewCloseoutEvidence,
}));
vi.mock("../api/modules/agentsShare", () => ({
	canonicalDigest: () => "admission-digest",
}));
vi.mock("../api/db/client", () => ({
	db: {
		select: () => ({
			from: () => ({
				where: async () => mocks.selectResults.shift() ?? [],
			}),
		}),
		insert: () => ({
			values: () => ({
				onConflictDoNothing: () => ({
					returning: async () => mocks.insertResults.shift() ?? [],
				}),
			}),
		}),
		update: () => ({
			set: () => ({
				where: () => ({
					returning: async () => mocks.updateResults.shift() ?? [],
				}),
			}),
		}),
	},
}));

import {
	admitCloseout,
	consumeCloseoutAdmission,
	evaluateCloseoutAdmission,
} from "../api/modules/gitCloseout/closeout-admission.service";

const run = {
	id: "run-1",
	taskId: "task-1",
	repositoryId: "repository-1",
	worktreePath: "/workspace/repository",
	taskRevisionSnapshotId: "revision-1",
	taskRevision: 1,
	taskDigest: "task-digest",
	finishedAt: new Date("2026-08-15T00:00:00.000Z"),
	endedAt: null,
	updatedAt: new Date("2026-08-15T00:00:00.000Z"),
};
const task = {
	id: "task-1",
	currentRevisionSnapshotId: "revision-1",
	revision: 1,
};
const subject = { id: "subject-1", verificationDocumentId: "document-1" };
const finalResponse = {
	id: "final-1",
	subjectId: subject.id,
	bindingStatus: "canonical",
};
const manifest = {
	taskId: task.id,
	digest: "manifest-digest",
	sourceRuns: [
		{
			runId: run.id,
			bindingStatus: "canonical",
			subjectId: subject.id,
			finalResponseEvidenceId: finalResponse.id,
			taskRevisionSnapshotId: run.taskRevisionSnapshotId,
		},
	],
};

beforeEach(() => {
	vi.clearAllMocks();
	mocks.selectResults.length = 0;
	mocks.insertResults.length = 0;
	mocks.updateResults.length = 0;
	mocks.getTaskRun.mockImplementation(async (id: string) =>
		id === run.id ? run : { id, taskId: task.id, contextSnapshot: {} },
	);
	mocks.getTask.mockResolvedValue(task);
	mocks.getRepository.mockResolvedValue({ localPath: "/workspace/fallback" });
	mocks.getLatestFinalResponseEvidence.mockResolvedValue(finalResponse);
	mocks.getEvidenceSubject.mockResolvedValue(subject);
	mocks.captureWorkspaceSourceSnapshot.mockResolvedValue({
		sourceStateHash: "source-hash",
	});
	mocks.bindEvidenceSubject.mockResolvedValue(subject);
	mocks.getReviewSessionByRun.mockResolvedValue({ id: "review-session-1" });
	mocks.listReviewArtifacts.mockResolvedValue([
		{
			kind: "review_run",
			updatedAt: new Date("2026-08-15T00:00:00.000Z"),
			artifactJson: { reviewRunId: "review-run-1" },
		},
	]);
	mocks.readReviewTargetManifest.mockReturnValue(manifest);
	mocks.resolveReviewCloseoutEvidence.mockResolvedValue({
		review: { status: "done" },
		verification: { status: "passed", evidenceRunIds: [] },
		security: { status: "skipped" },
		findings: { unresolvedBlockingIds: [] },
	});
});

describe("Closeout Admission critical branches", () => {
	it("distinguishes missing Runs from missing Tasks", async () => {
		mocks.getTaskRun.mockResolvedValueOnce(null);
		await expect(evaluateCloseoutAdmission("missing")).resolves.toMatchObject({
			reasons: ["run_missing"],
		});

		mocks.getTaskRun.mockResolvedValueOnce(run);
		mocks.getTask.mockResolvedValueOnce(null);
		await expect(evaluateCloseoutAdmission(run.id)).resolves.toMatchObject({
			reasons: ["task_missing"],
		});
	});

	it("fails before source capture when final evidence and workspace context are absent", async () => {
		mocks.getTaskRun.mockResolvedValueOnce({
			...run,
			repositoryId: null,
			worktreePath: null,
		});
		mocks.getLatestFinalResponseEvidence.mockResolvedValueOnce(null);

		const result = await evaluateCloseoutAdmission(run.id);

		expect(result).toMatchObject({
			passed: false,
			subjectId: null,
			reasons: ["final_response_evidence_unbound", "workspace_context_missing"],
		});
		expect(mocks.captureWorkspaceSourceSnapshot).not.toHaveBeenCalled();
	});

	it("rejects changed source state and a missing review session", async () => {
		mocks.bindEvidenceSubject.mockResolvedValueOnce({ id: "subject-2" });
		mocks.getReviewSessionByRun.mockResolvedValueOnce(null);

		const result = await evaluateCloseoutAdmission(run.id);

		expect(result.reasons).toEqual(["source_or_diff_stale", "review_missing"]);
		expect(result.subjectId).toBe("subject-2");
	});

	it("aggregates stale review, incomplete gates, findings, and foreign verification", async () => {
		mocks.listReviewArtifacts.mockResolvedValueOnce([
			{
				kind: "review_run",
				updatedAt: new Date(),
				artifactJson: null,
			},
		]);
		mocks.resolveReviewCloseoutEvidence.mockResolvedValueOnce({
			review: { status: "pending" },
			verification: { status: "failed", evidenceRunIds: ["evidence-1"] },
			security: { status: "failed" },
			findings: { unresolvedBlockingIds: ["finding-1"] },
		});
		mocks.selectResults.push([]);

		const result = await evaluateCloseoutAdmission(run.id);

		expect(result.reasons).toEqual(
			expect.arrayContaining([
				"review_manifest_stale",
				"review_incomplete",
				"verification_incomplete",
				"security_evidence_incomplete",
				"blocking_findings_unresolved",
				"verification_subject_mismatch",
			]),
		);
		expect(result.refs).toBeNull();
	});

	it("reuses a matching admission and fails if persistence returns no row", async () => {
		const existing = { id: "admission-1", status: "admitted" };
		mocks.insertResults.push([]);
		mocks.selectResults.push([existing]);
		await expect(admitCloseout(run.id)).resolves.toBe(existing);

		mocks.insertResults.push([]);
		mocks.selectResults.push([]);
		await expect(admitCloseout(run.id)).rejects.toThrow(
			"Failed to persist Closeout Admission",
		);
	});

	it("returns null when an admission has already been consumed", async () => {
		mocks.updateResults.push([]);
		await expect(consumeCloseoutAdmission("admission-1")).resolves.toBeNull();
		mocks.updateResults.push([{ id: "admission-1", status: "consumed" }]);
		await expect(
			consumeCloseoutAdmission("admission-1"),
		).resolves.toMatchObject({
			status: "consumed",
		});
	});
});
