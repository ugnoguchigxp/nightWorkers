import { eq } from "drizzle-orm";
import { db } from "../../db/client";
import {
	missionPilotReviewDecisions,
	missionPilotSessions,
	missionPilotTestSnapshots,
} from "../../db/mission-pilot-schema";
import * as nightworkersRepo from "../nightworkers/nightworkers.repository";
import * as verificationRepo from "../nightworkers/nightworkers.verification.repository";
import * as reviewRepo from "./review-mode.repository";

export type ReviewCloseoutEvidence = {
	review: {
		source: "review_run" | "legacy_test_coverage" | "missing";
		status:
			| "not_started"
			| "running"
			| "done"
			| "blocked"
			| "needs_human"
			| "failed";
		reviewRunId: string | null;
		completedAt: string | null;
	};
	test: {
		source:
			| "mission_pilot_snapshot"
			| "verification_checklist"
			| "legacy_test_coverage"
			| "missing";
		status: "passed" | "missing" | "incomplete" | "failed" | "stale";
		verificationDocumentId: string | null;
		evidenceRunIds: string[];
		completionCheckEventId: string | null;
		reason: string | null;
	};
	security: {
		source: "security_oracle" | "policy_skip" | "missing";
		status: "passed" | "skipped" | "blocked" | "failed" | "missing";
		scanRunId: string | null;
		eventId: string | null;
		reason: string | null;
	};
	findings: {
		unresolvedBlockingIds: string[];
	};
};

function record(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function eventData(event: { payloadJson?: unknown }) {
	const payload = record(event.payloadJson);
	return record(record(payload.runEvent).data);
}

function artifactPayload(artifact: { artifactJson: unknown } | undefined) {
	return record(artifact?.artifactJson);
}

function reviewProgress(
	value: unknown,
): ReviewCloseoutEvidence["review"]["status"] {
	return [
		"not_started",
		"running",
		"done",
		"blocked",
		"needs_human",
		"failed",
	].includes(String(value))
		? (value as ReviewCloseoutEvidence["review"]["status"])
		: "failed";
}

async function resolveReviewEvidence(input: {
	runId: string;
	artifacts: Awaited<ReturnType<typeof reviewRepo.listReviewArtifacts>>;
	events: Awaited<ReturnType<typeof nightworkersRepo.listTaskEventsForRun>>;
}): Promise<ReviewCloseoutEvidence["review"]> {
	const reviewRunArtifact = input.artifacts.find(
		(artifact) => artifact.kind === "review_run",
	);
	if (reviewRunArtifact) {
		const payload = artifactPayload(reviewRunArtifact);
		const reviewRunId =
			typeof payload.reviewRunId === "string" ? payload.reviewRunId : null;
		const matchingCompletion = [...input.events].reverse().find((event) => {
			const data = eventData(event);
			return (
				data.reviewedRunId === input.runId &&
				data.status === "done" &&
				(!reviewRunId || data.reviewRunId === reviewRunId)
			);
		});
		const artifactStatus = reviewProgress(reviewRunArtifact.status);
		const payloadStatus =
			typeof payload.status === "string"
				? reviewProgress(payload.status)
				: artifactStatus;
		const completionStatus = matchingCompletion
			? reviewProgress(eventData(matchingCompletion).status)
			: null;
		const status =
			artifactStatus !== payloadStatus ||
			(artifactStatus === "done" && completionStatus !== "done")
				? "failed"
				: artifactStatus;
		return {
			source: "review_run",
			status,
			reviewRunId,
			completedAt:
				status === "done" ? reviewRunArtifact.updatedAt.toISOString() : null,
		};
	}
	const legacy = input.artifacts.find(
		(artifact) => artifact.kind === "test_coverage",
	);
	if (legacy?.status === "done") {
		return {
			source: "legacy_test_coverage",
			status: "done",
			reviewRunId: null,
			completedAt: legacy.updatedAt.toISOString(),
		};
	}
	return {
		source: "missing",
		status: "not_started",
		reviewRunId: null,
		completedAt: null,
	};
}

async function findCompletionCheck(taskId: string) {
	const runs = await nightworkersRepo.listTaskRunsForTask(taskId);
	for (const run of runs) {
		const events = await nightworkersRepo.listTaskEventsForRun(run.id);
		const match = [...events].reverse().find((event) => {
			const data = eventData(event);
			const result = record(data.result);
			return (
				(data.mcpTool === "completion_check" ||
					data.toolName === "completion_check") &&
				data.status !== "failed" &&
				result.ok !== false
			);
		});
		if (match) return match;
	}
	return null;
}

async function resolveTestEvidence(input: {
	taskId: string;
	artifacts: Awaited<ReturnType<typeof reviewRepo.listReviewArtifacts>>;
}): Promise<ReviewCloseoutEvidence["test"]> {
	const [missionSession] = await db
		.select()
		.from(missionPilotSessions)
		.where(eq(missionPilotSessions.taskId, input.taskId));
	if (missionSession) {
		const snapshotId = missionSession.activeTestSnapshotId;
		const [snapshot] = snapshotId
			? await db
					.select()
					.from(missionPilotTestSnapshots)
					.where(eq(missionPilotTestSnapshots.id, snapshotId))
			: [];
		if (!snapshot) {
			return {
				source: "mission_pilot_snapshot",
				status: "missing",
				verificationDocumentId: null,
				evidenceRunIds: [],
				completionCheckEventId: null,
				reason: "Mission Pilot の active Test snapshot がありません。",
			};
		}
		const passed =
			snapshot.verdict === "pass" &&
			snapshot.requiredComplete === snapshot.requiredTotal &&
			snapshot.failedRequired === 0 &&
			snapshot.unknownRequired === 0;
		const [reviewDecision] = missionSession.activeReviewDecisionId
			? await db
					.select()
					.from(missionPilotReviewDecisions)
					.where(
						eq(
							missionPilotReviewDecisions.id,
							missionSession.activeReviewDecisionId,
						),
					)
			: [];
		const stale = Boolean(
			reviewDecision && reviewDecision.testSnapshotId !== snapshot.id,
		);
		return {
			source: "mission_pilot_snapshot",
			status: stale ? "stale" : passed ? "passed" : "failed",
			verificationDocumentId: snapshot.verificationDocumentId,
			evidenceRunIds: snapshot.evidenceRunIdsJson,
			completionCheckEventId: snapshot.completionCheckEventId,
			reason: stale
				? "Mission Pilot の Review decision が active Test snapshot を参照していません。"
				: passed
					? null
					: "Mission Pilot の Test snapshot が pass ではありません。",
		};
	}

	const document = await verificationRepo.getLatestVerificationDocumentForTask(
		input.taskId,
	);
	if (document?.status === "active") {
		const items = await verificationRepo.listVerificationChecklistItems(
			document.id,
		);
		const completeStatuses = new Set([
			"passed",
			"covered",
			"verified_by_gate",
			"manual",
			"not_applicable",
		]);
		const required = items.filter((item) => item.required);
		const incomplete = required.filter(
			(item) => !completeStatuses.has(item.status),
		);
		const evidenceRunIds = [
			...new Set(required.flatMap((item) => item.evidenceIds)),
		];
		const evidenceRuns =
			await verificationRepo.listVerificationEvidenceRuns(evidenceRunIds);
		const linkedEvidenceRequired = required.filter(
			(item) => !["manual", "not_applicable"].includes(item.status),
		);
		const missingLinkedEvidence =
			linkedEvidenceRequired.some((item) => item.evidenceIds.length === 0) ||
			evidenceRuns.length !== evidenceRunIds.length;
		const failedEvidence = evidenceRuns.some((run) => run.exitCode !== 0);
		const completion = await findCompletionCheck(input.taskId);
		const passed =
			incomplete.length === 0 &&
			!missingLinkedEvidence &&
			!failedEvidence &&
			Boolean(completion);
		return {
			source: "verification_checklist",
			status: failedEvidence ? "failed" : passed ? "passed" : "incomplete",
			verificationDocumentId: document.id,
			evidenceRunIds,
			completionCheckEventId: completion?.id ?? null,
			reason: passed
				? null
				: failedEvidence
					? "Test evidence に失敗した実行があります。"
					: missingLinkedEvidence
						? "Verification checklist から managed evidence run への参照が不足しています。"
						: "Verification checklist または completion_check が未完了です。",
		};
	}

	const legacy = input.artifacts.find(
		(artifact) =>
			artifact.kind === "test_coverage" && artifact.status === "done",
	);
	const hasReviewRun = input.artifacts.some(
		(artifact) => artifact.kind === "review_run",
	);
	if (legacy && !hasReviewRun) {
		return {
			source: "legacy_test_coverage",
			status: "passed",
			verificationDocumentId: null,
			evidenceRunIds: [],
			completionCheckEventId: null,
			reason: "Legacy Review Mode evidence compatibility.",
		};
	}
	return {
		source: "missing",
		status: "missing",
		verificationDocumentId: null,
		evidenceRunIds: [],
		completionCheckEventId: null,
		reason: "Test Mode の完了証跡がありません。",
	};
}

function resolveSecurityEvidence(
	events: Awaited<ReturnType<typeof nightworkersRepo.listTaskEventsForRun>>,
): ReviewCloseoutEvidence["security"] {
	for (const event of [...events].reverse()) {
		const data = eventData(event);
		if (data.action === "security.oracle_gate_skipped") {
			return {
				source: "policy_skip",
				status: "skipped",
				scanRunId: null,
				eventId: event.id,
				reason: typeof data.reason === "string" ? data.reason : null,
			};
		}
		if (data.action === "security.oracle_gate_finished") {
			const gate = record(data.securityGate);
			const passed = gate.allowFinalize === true && gate.status === "passed";
			return {
				source: "security_oracle",
				status: passed
					? "passed"
					: gate.status === "failed"
						? "failed"
						: "blocked",
				scanRunId: typeof gate.scanRunId === "string" ? gate.scanRunId : null,
				eventId: event.id,
				reason: typeof gate.message === "string" ? gate.message : null,
			};
		}
	}
	return {
		source: "missing",
		status: "missing",
		scanRunId: null,
		eventId: null,
		reason: "実装 finalization の Security Oracle 証跡がありません。",
	};
}

export async function resolveReviewCloseoutEvidence(input: {
	runId: string;
	taskId: string;
	reviewSessionId: string;
}): Promise<ReviewCloseoutEvidence> {
	const [artifacts, findings, events] = await Promise.all([
		reviewRepo.listReviewArtifacts(input.reviewSessionId),
		reviewRepo.listReviewFindings(input.reviewSessionId),
		nightworkersRepo.listTaskEventsForRun(input.runId),
	]);
	const [review, test] = await Promise.all([
		resolveReviewEvidence({ runId: input.runId, artifacts, events }),
		resolveTestEvidence({ taskId: input.taskId, artifacts }),
	]);
	return {
		review,
		test,
		security: resolveSecurityEvidence(events),
		findings: {
			unresolvedBlockingIds: findings
				.filter(
					(finding) =>
						finding.severity === "blocking" &&
						finding.dispositionStatus === "unresolved",
				)
				.map((finding) => finding.id),
		},
	};
}
