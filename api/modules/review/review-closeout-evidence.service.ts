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

function eventCanonicalType(event: { payloadJson?: unknown }) {
	const payload = record(event.payloadJson);
	const type = record(payload.runEvent).type;
	return typeof type === "string" ? type : null;
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
				eventCanonicalType(event) === "review.run_completed" &&
				data.reviewedRunId === input.runId &&
				data.status === "done" &&
				Boolean(reviewRunId) &&
				data.reviewRunId === reviewRunId
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
			(artifactStatus === "done" &&
				(!reviewRunId || completionStatus !== "done"))
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

async function findCompletionCheck(input: {
	testRuns: Awaited<ReturnType<typeof nightworkersRepo.listTaskRunsForTask>>;
	allowedRunIds: Set<string>;
	verificationDocumentId: string;
	minimumCompletedAt: Date;
}) {
	for (const run of input.testRuns) {
		if (!input.allowedRunIds.has(run.id)) continue;
		const events = await nightworkersRepo.listTaskEventsForRun(run.id);
		const match = [...events].reverse().find((event) => {
			if (
				eventCanonicalType(event) !== "tool.call_finished" ||
				event.timestamp < input.minimumCompletedAt
			) {
				return false;
			}
			const data = eventData(event);
			const result = record(data.result);
			const nestedPayload = record(result.payload);
			const completionResult = record(nestedPayload.result);
			const structuredPayload = record(
				record(result.structured_content).payload,
			);
			const structuredResult = record(structuredPayload.result);
			const explicitOkValues = [
				data.ok,
				result.ok,
				completionResult.ok,
				structuredPayload.ok,
				structuredResult.ok,
			].filter((value): value is boolean => typeof value === "boolean");
			const resultDocumentIds = [
				result.verificationDocumentId,
				completionResult.verificationDocumentId,
				structuredPayload.verificationDocumentId,
				structuredResult.verificationDocumentId,
			].filter((value): value is string => typeof value === "string");
			return (
				(data.mcpTool === "completion_check" ||
					data.toolName === "completion_check" ||
					result.toolName === "completion_check") &&
				data.status !== "failed" &&
				explicitOkValues.includes(true) &&
				!explicitOkValues.includes(false) &&
				(resultDocumentIds.length === 0 ||
					resultDocumentIds.every(
						(documentId) => documentId === input.verificationDocumentId,
					))
			);
		});
		if (match) return match;
	}
	return null;
}

async function resolveTestEvidence(input: {
	taskId: string;
	implementationFinishedAt: Date;
	artifacts: Awaited<ReturnType<typeof reviewRepo.listReviewArtifacts>>;
}): Promise<ReviewCloseoutEvidence["test"]> {
	const reviewRunArtifact = input.artifacts.find(
		(artifact) => artifact.kind === "review_run",
	);
	const reviewRunPayload = artifactPayload(reviewRunArtifact);
	const requiresPostReviewRetest = reviewRunPayload.fixesApplied === true;
	const evidenceFreshnessFloor =
		requiresPostReviewRetest &&
		reviewRunArtifact &&
		reviewRunArtifact.updatedAt > input.implementationFinishedAt
			? reviewRunArtifact.updatedAt
			: input.implementationFinishedAt;
	const [missionSession] = await db
		.select()
		.from(missionPilotSessions)
		.where(eq(missionPilotSessions.taskId, input.taskId));
	const missionManaged = Boolean(
		missionSession &&
			(missionSession.desiredState === "running" ||
				missionSession.activeTestSnapshotId ||
				missionSession.activeReviewDecisionId),
	);
	if (missionSession && missionManaged) {
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
			snapshot.requiredTotal > 0 &&
			snapshot.requiredComplete === snapshot.requiredTotal &&
			snapshot.failedRequired === 0 &&
			snapshot.unknownRequired === 0 &&
			snapshot.evidenceRunIdsJson.length > 0 &&
			Boolean(snapshot.completionCheckEventId);
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
		const taskRuns = await nightworkersRepo.listTaskRunsForTask(input.taskId);
		const completedTestRuns = taskRuns.filter((run) => {
			const snapshot = record(run.contextSnapshot);
			return run.status === "completed" && snapshot.executionMode === "test";
		});
		const testRuns = completedTestRuns.filter(
			(run) => run.startedAt >= evidenceFreshnessFloor,
		);
		const testRunIds = new Set(testRuns.map((run) => run.id));
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
			...new Set(
				required.flatMap((item) => {
					const latestEvidenceId = item.evidenceIds.at(-1);
					return latestEvidenceId ? [latestEvidenceId] : [];
				}),
			),
		];
		if (
			requiresPostReviewRetest &&
			completedTestRuns.length > 0 &&
			testRuns.length === 0
		) {
			return {
				source: "verification_checklist",
				status: "stale",
				verificationDocumentId: document.id,
				evidenceRunIds,
				completionCheckEventId: null,
				reason: "Review Run が修正を適用した後の Test Mode 証跡がありません。",
			};
		}
		const evidenceRuns =
			await verificationRepo.listVerificationEvidenceRuns(evidenceRunIds);
		const linkedEvidenceRequired = required.filter(
			(item) => !["manual", "not_applicable"].includes(item.status),
		);
		const missingLinkedEvidence =
			evidenceRunIds.length === 0 ||
			linkedEvidenceRequired.some((item) => !item.evidenceIds.at(-1)) ||
			evidenceRuns.length !== evidenceRunIds.length ||
			evidenceRuns.some(
				(run) =>
					run.taskId !== input.taskId ||
					run.verificationDocumentId !== document.id ||
					!run.runId ||
					!testRunIds.has(run.runId) ||
					run.finishedAt < evidenceFreshnessFloor,
			);
		const failedEvidence = evidenceRuns.some((run) => run.exitCode !== 0);
		const latestEvidenceFinishedAt = evidenceRuns.reduce(
			(latest, run) => (run.finishedAt > latest ? run.finishedAt : latest),
			evidenceFreshnessFloor,
		);
		const minimumCompletedAt = [
			document.generatedAt,
			evidenceFreshnessFloor,
			latestEvidenceFinishedAt,
		].reduce((latest, date) => (date > latest ? date : latest));
		const completion = await findCompletionCheck({
			testRuns,
			allowedRunIds: new Set(
				evidenceRuns
					.map((run) => run.runId)
					.filter((runId): runId is string => Boolean(runId)),
			),
			verificationDocumentId: document.id,
			minimumCompletedAt,
		});
		const passed =
			required.length > 0 &&
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
		if (
			eventCanonicalType(event) === "system.info" &&
			data.action === "security.oracle_gate_skipped"
		) {
			const reason = typeof data.reason === "string" ? data.reason.trim() : "";
			return {
				source: "policy_skip",
				status: reason ? "skipped" : "failed",
				scanRunId: null,
				eventId: event.id,
				reason: reason || "Security Oracle policy skip reason is missing.",
			};
		}
		if (
			eventCanonicalType(event) === "system.info" &&
			data.action === "security.oracle_gate_finished"
		) {
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

function isUnresolvedBlockingFinding(
	finding: Awaited<ReturnType<typeof reviewRepo.listReviewFindings>>[number],
) {
	if (finding.severity !== "blocking") return false;
	if (finding.dispositionStatus === "unresolved") return true;
	const note = finding.dispositionNote?.trim() ?? "";
	if (finding.dispositionStatus === "dismissed") return note.length === 0;
	if (
		finding.dispositionStatus === "accepted" &&
		finding.disposition === "accepted_risk"
	) {
		return (
			note.length === 0 ||
			!Array.isArray(finding.evidenceRefsJson) ||
			finding.evidenceRefsJson.length === 0
		);
	}
	return false;
}

export async function resolveReviewCloseoutEvidence(input: {
	runId: string;
	taskId: string;
	reviewSessionId: string;
	implementationFinishedAt: Date;
}): Promise<ReviewCloseoutEvidence> {
	const [artifacts, findings, events] = await Promise.all([
		reviewRepo.listReviewArtifacts(input.reviewSessionId),
		reviewRepo.listReviewFindings(input.reviewSessionId),
		nightworkersRepo.listTaskEventsForRun(input.runId),
	]);
	const [review, test] = await Promise.all([
		resolveReviewEvidence({ runId: input.runId, artifacts, events }),
		resolveTestEvidence({
			taskId: input.taskId,
			implementationFinishedAt: input.implementationFinishedAt,
			artifacts,
		}),
	]);
	return {
		review,
		test,
		security: resolveSecurityEvidence(events),
		findings: {
			unresolvedBlockingIds: findings
				.filter(isUnresolvedBlockingFinding)
				.map((finding) => finding.id),
		},
	};
}
