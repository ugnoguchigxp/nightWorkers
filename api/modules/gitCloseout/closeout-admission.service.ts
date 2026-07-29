import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../db/client";
import { closeoutAdmissions } from "../../db/closeout-admission-schema";
import { taskRuns } from "../../db/schema-task-execution";
import { verificationEvidenceRuns } from "../../db/verification-schema";
import { AppError } from "../../lib/errors";
import { canonicalDigest } from "../agentsShare";
import { captureWorkspaceSourceSnapshot } from "../codingAgent";
import {
	bindEvidenceSubject,
	getEvidenceSubject,
	getLatestFinalResponseEvidence,
} from "../evidenceLedger";
import * as nightworkersRepo from "../nightworkers/nightworkers.repository";
import { resolveReviewCloseoutEvidence } from "../review/review-closeout-evidence.service";
import * as reviewRepo from "../review/review-mode.repository";
import { readReviewTargetManifest } from "../review/review-target-manifest";

export type CloseoutAdmission = {
	passed: boolean;
	subjectId: string | null;
	reasons: string[];
	refs: {
		taskId: string;
		taskRevisionSnapshotId: string;
		finalResponseEvidenceId: string;
		reviewRunId: string;
		reviewManifestDigest: string;
		verificationEvidenceIds: string[];
	} | null;
};

export async function evaluateCloseoutAdmission(
	runId: string,
): Promise<CloseoutAdmission> {
	const run = await nightworkersRepo.getTaskRun(runId);
	if (!run) return failed("run_missing");
	const task = await nightworkersRepo.getTask(run.taskId);
	if (!task) return failed("task_missing");
	const reasons: string[] = [];
	if (
		!run.taskRevisionSnapshotId ||
		run.taskRevision === null ||
		!run.taskDigest ||
		task.currentRevisionSnapshotId !== run.taskRevisionSnapshotId ||
		task.revision !== run.taskRevision
	) {
		reasons.push("task_revision_stale");
	}
	const finalResponse = await getLatestFinalResponseEvidence(run.id);
	const finalSubject = finalResponse?.subjectId
		? await getEvidenceSubject(finalResponse.subjectId)
		: null;
	if (finalResponse?.bindingStatus !== "canonical" || !finalSubject) {
		reasons.push("final_response_evidence_unbound");
	}
	const repository = run.repositoryId
		? await nightworkersRepo.getRepository(run.repositoryId)
		: null;
	const repoRoot = run.worktreePath ?? repository?.localPath ?? null;
	if (!repoRoot || !finalSubject) {
		reasons.push("workspace_context_missing");
		return {
			passed: false,
			subjectId: finalSubject?.id ?? null,
			reasons,
			refs: null,
		};
	}
	const currentSource = await captureWorkspaceSourceSnapshot(repoRoot);
	const currentSubject = await bindEvidenceSubject({
		taskId: run.taskId,
		runId: run.id,
		sourceStateHash: currentSource.sourceStateHash,
		verificationDocumentId: finalSubject.verificationDocumentId,
	});
	if (!currentSubject || currentSubject.id !== finalSubject.id) {
		reasons.push("source_or_diff_stale");
	}
	const reviewSession = await reviewRepo.getReviewSessionByRun(run.id);
	if (!reviewSession) {
		reasons.push("review_missing");
		return {
			passed: false,
			subjectId: currentSubject?.id ?? null,
			reasons,
			refs: null,
		};
	}
	const artifacts = await reviewRepo.listReviewArtifacts(reviewSession.id);
	const reviewArtifact = artifacts
		.filter((artifact) => artifact.kind === "review_run")
		.sort(
			(left, right) => right.updatedAt.getTime() - left.updatedAt.getTime(),
		)[0];
	const payload = record(reviewArtifact?.artifactJson);
	const reviewRunId =
		typeof payload.reviewRunId === "string" ? payload.reviewRunId : null;
	const reviewRun = reviewRunId
		? await nightworkersRepo.getTaskRun(reviewRunId)
		: null;
	const manifest = reviewRun
		? readReviewTargetManifest(reviewRun.contextSnapshot)
		: null;
	const manifestSource = manifest?.sourceRuns.find(
		(source) => source.runId === run.id,
	);
	if (
		reviewRun?.taskId !== run.taskId ||
		manifest?.taskId !== run.taskId ||
		manifestSource?.bindingStatus !== "canonical" ||
		manifestSource?.subjectId !== currentSubject?.id ||
		manifestSource?.finalResponseEvidenceId !== finalResponse?.id ||
		manifestSource?.taskRevisionSnapshotId !== run.taskRevisionSnapshotId
	) {
		reasons.push("review_manifest_stale");
	}
	const closeoutEvidence = await resolveReviewCloseoutEvidence({
		runId: run.id,
		taskId: run.taskId,
		reviewSessionId: reviewSession.id,
		implementationFinishedAt: run.finishedAt ?? run.endedAt ?? run.updatedAt,
	});
	if (closeoutEvidence.review.status !== "done")
		reasons.push("review_incomplete");
	if (closeoutEvidence.verification.status !== "passed")
		reasons.push("verification_incomplete");
	if (!["passed", "skipped"].includes(closeoutEvidence.security.status)) {
		reasons.push("security_evidence_incomplete");
	}
	if (closeoutEvidence.findings.unresolvedBlockingIds.length > 0)
		reasons.push("blocking_findings_unresolved");
	if (closeoutEvidence.verification.evidenceRunIds.length > 0) {
		const evidence = await db
			.select()
			.from(verificationEvidenceRuns)
			.where(
				inArray(
					verificationEvidenceRuns.id,
					closeoutEvidence.verification.evidenceRunIds,
				),
			);
		if (
			evidence.length !== closeoutEvidence.verification.evidenceRunIds.length ||
			evidence.some(
				(item) =>
					item.runId !== run.id ||
					item.subjectId !== currentSubject?.id ||
					item.exitCode !== 0,
			)
		) {
			reasons.push("verification_subject_mismatch");
		}
	}
	return {
		passed: reasons.length === 0,
		subjectId: currentSubject?.id ?? null,
		reasons: [...new Set(reasons)],
		refs:
			currentSubject &&
			run.taskRevisionSnapshotId &&
			finalResponse &&
			reviewRunId &&
			manifest
				? {
						taskId: run.taskId,
						taskRevisionSnapshotId: run.taskRevisionSnapshotId,
						finalResponseEvidenceId: finalResponse.id,
						reviewRunId,
						reviewManifestDigest: manifest.digest,
						verificationEvidenceIds:
							closeoutEvidence.verification.evidenceRunIds,
					}
				: null,
	};
}

function failed(reason: string): CloseoutAdmission {
	return { passed: false, subjectId: null, reasons: [reason], refs: null };
}

export async function admitCloseout(runId: string) {
	const evaluated = await evaluateCloseoutAdmission(runId);
	if (!evaluated.passed || !evaluated.subjectId || !evaluated.refs) {
		throw new AppError(
			409,
			"closeout_evidence_stale",
			`Current revision evidence is incomplete: ${evaluated.reasons.join(", ")}`,
		);
	}
	const unsigned = {
		runId,
		subjectId: evaluated.subjectId,
		...evaluated.refs,
	};
	const admissionDigest = canonicalDigest(unsigned);
	const [created] = await db
		.insert(closeoutAdmissions)
		.values({
			taskId: evaluated.refs.taskId,
			runId,
			subjectId: evaluated.subjectId,
			taskRevisionSnapshotId: evaluated.refs.taskRevisionSnapshotId,
			finalResponseEvidenceId: evaluated.refs.finalResponseEvidenceId,
			reviewRunId: evaluated.refs.reviewRunId,
			reviewManifestDigest: evaluated.refs.reviewManifestDigest,
			verificationEvidenceIdsJson: evaluated.refs.verificationEvidenceIds,
			admissionDigest,
			status: "admitted",
			admittedAt: new Date(),
		})
		.onConflictDoNothing({ target: closeoutAdmissions.admissionDigest })
		.returning();
	if (created) {
		await db
			.update(taskRuns)
			.set({ admissionSubjectId: evaluated.subjectId, updatedAt: new Date() })
			.where(eq(taskRuns.id, runId));
		return created;
	}
	const [existing] = await db
		.select()
		.from(closeoutAdmissions)
		.where(eq(closeoutAdmissions.admissionDigest, admissionDigest));
	if (!existing) throw new Error("Failed to persist Closeout Admission");
	return existing;
}

export async function consumeCloseoutAdmission(id: string) {
	const [updated] = await db
		.update(closeoutAdmissions)
		.set({ status: "consumed", consumedAt: new Date(), updatedAt: new Date() })
		.where(
			and(
				eq(closeoutAdmissions.id, id),
				eq(closeoutAdmissions.status, "admitted"),
			),
		)
		.returning();
	return updated ?? null;
}

function record(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}
