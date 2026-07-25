import crypto from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { isVerificationChecklistItemComplete } from "../../../shared/schemas/verification-checklist.schema";
import { db } from "../../db/client";
import {
	missionPilotContextSnapshots,
	missionPilotPhaseRuns,
	missionPilotSessions,
	missionPilotVerificationSnapshots,
} from "../../db/mission-pilot-schema";
import { taskEvents, taskRuns, tasks } from "../../db/schema";
import {
	verificationChecklistItems,
	verificationEvidenceRuns,
} from "../../db/verification-schema";
import {
	completionCheckMatchesVerificationDocument,
	readLatestCompletionCheckResult,
} from "../../services/run-events/completion-check-result";
import { digestText } from "../../services/text-digest";
import { appendMissionPilotEvent } from "./mission-pilot-event.repository";
import {
	readRecord,
	setMissionPilotAttention,
} from "./mission-pilot-post-queue-review.service";
import { evaluateVerificationCompletionGate } from "./mission-pilot-post-queue-state";
import { resolvePersistedVerificationEvidence } from "./mission-pilot-verification-evidence";

export async function finalizeImplementationVerification(input: {
	session: typeof missionPilotSessions.$inferSelect;
	phaseRun: typeof missionPilotPhaseRuns.$inferSelect;
	runId: string;
	changedPaths: string[];
}) {
	const [existingSnapshot] = await db
		.select()
		.from(missionPilotVerificationSnapshots)
		.where(
			eq(missionPilotVerificationSnapshots.sourcePhaseRunId, input.phaseRun.id),
		)
		.limit(1);
	if (existingSnapshot) {
		return buildReviewContinuationFromVerificationSnapshot({
			sessionId: input.session.id,
			snapshotId: existingSnapshot.id,
		});
	}

	const [run] = await db
		.select()
		.from(taskRuns)
		.where(eq(taskRuns.id, input.runId))
		.limit(1);
	const verificationDocumentId =
		input.session.queueHandoffJson?.verificationDocumentId;
	if (!run || !verificationDocumentId) {
		const reason = run
			? "verification_document_missing"
			: "implementation_run_missing";
		await setMissionPilotAttention(input.session.id, input.phaseRun.id, reason);
		return { kind: "attention", reasons: [reason] } as const;
	}

	const checklist = await db
		.select()
		.from(verificationChecklistItems)
		.where(
			eq(
				verificationChecklistItems.verificationDocumentId,
				verificationDocumentId,
			),
		);
	const required = checklist.filter((item) => item.required);
	const evidence = await db
		.select()
		.from(verificationEvidenceRuns)
		.where(eq(verificationEvidenceRuns.runId, input.runId));
	const evidenceResolution = resolvePersistedVerificationEvidence({
		historyRows: evidence.filter(
			(item) => item.verificationDocumentId === verificationDocumentId,
		),
	});
	const acceptedEvidenceIds = new Set(
		evidenceResolution.acceptedEvidence.map((item) => item.id),
	);
	const unlinkedRequiredEvidenceCount = required.filter(
		(item) =>
			!["manual", "not_applicable"].includes(item.status) &&
			!item.evidenceIdsJson.some((id) => acceptedEvidenceIds.has(id)),
	).length;
	const events = await db
		.select()
		.from(taskEvents)
		.where(eq(taskEvents.taskRunId, input.runId));
	const completionCheck = readLatestCompletionCheckResult(events);
	const requiredComplete = required.filter((item) =>
		isVerificationChecklistItemComplete({
			required: item.required,
			status: item.status,
		}),
	).length;
	const gate = evaluateVerificationCompletionGate({
		runStatus: run.status,
		verificationDocumentMatches: completionCheckMatchesVerificationDocument(
			completionCheck,
			verificationDocumentId,
		),
		acceptedEvidenceCount: evidenceResolution.acceptedEvidence.length,
		latestFailedEvidenceCount:
			evidenceResolution.historySummary.latestFailureCount,
		unlinkedRequiredEvidenceCount,
		completionCheckEventId: completionCheck?.eventId ?? null,
		completionCheckOk: completionCheck?.ok ?? false,
		requiredTotal: required.length,
		requiredComplete,
		failedRequired: required.filter((item) => item.status === "failed").length,
		unknownRequired: required.filter((item) => item.status === "unknown")
			.length,
		contextDigestMatches:
			input.phaseRun.inputContextDigest === input.session.contextDigest,
	});
	if (!gate.pass) {
		await setMissionPilotAttention(
			input.session.id,
			input.phaseRun.id,
			gate.reasons.join(","),
			{
				errorCode: "MISSION_PILOT_VERIFICATION_GATE_REJECTED",
				reasonCodes: gate.reasons,
				evidence: {
					verificationEvidenceHistorySummary: evidenceResolution.historySummary,
				},
			},
		);
		return { kind: "attention", reasons: gate.reasons } as const;
	}

	const [latestContext] = await db
		.select()
		.from(missionPilotContextSnapshots)
		.where(eq(missionPilotContextSnapshots.sessionId, input.session.id))
		.orderBy(desc(missionPilotContextSnapshots.revision))
		.limit(1);
	if (!latestContext) {
		await setMissionPilotAttention(
			input.session.id,
			input.phaseRun.id,
			"context_snapshot_missing",
		);
		return {
			kind: "attention",
			reasons: ["context_snapshot_missing"],
		} as const;
	}

	const snapshotId = crypto.randomUUID();
	const checklistDigest = digestText(
		JSON.stringify(
			required.map((item) => ({
				conditionId: item.conditionId,
				status: item.status,
				evidenceIds: item.evidenceIdsJson,
			})),
		),
	);
	const nextContext = {
		...latestContext.contextJson,
		execution: {
			...readRecord(latestContext.contextJson.execution),
			implementation: {
				...readRecord(
					readRecord(latestContext.contextJson.execution).implementation,
				),
				currentCycle: input.phaseRun.cycle,
				latestAcceptedRunId: run.id,
				changedPaths: input.changedPaths,
				diffDigest: run.diffPatch ? digestText(run.diffPatch) : null,
				finalReportSummary: run.summary ?? null,
			},
			verification: {
				snapshotId,
				sourcePhaseRunId: input.phaseRun.id,
				sourceRunId: run.id,
				checklistDigest,
				requiredTotal: required.length,
				requiredComplete,
				evidenceRunIds: evidenceResolution.acceptedEvidence.map(
					(item) => item.id,
				),
				completionCheckEventId: completionCheck?.eventId ?? "",
				verdict: "pass",
			},
		},
	};
	const nextRevision = input.session.contextRevision + 1;
	const nextDigest = digestText(JSON.stringify(nextContext));
	const now = new Date();
	const snapshotCreated = await db.transaction(async (tx) => {
		const inserted = await tx
			.insert(missionPilotVerificationSnapshots)
			.values({
				id: snapshotId,
				sessionId: input.session.id,
				sourcePhaseRunId: input.phaseRun.id,
				verificationDocumentId,
				contextRevision: input.session.contextRevision,
				contextDigest: input.session.contextDigest,
				checklistDigest,
				requiredTotal: required.length,
				requiredComplete,
				failedRequired: 0,
				unknownRequired: 0,
				evidenceRunIdsJson: evidenceResolution.acceptedEvidence.map(
					(item) => item.id,
				),
				completionCheckEventId: completionCheck?.eventId ?? "",
				changedPathsJson: input.changedPaths,
				verdict: "pass",
				snapshotJson: {
					checklistDigest,
					evidenceRunIds: evidenceResolution.acceptedEvidence.map(
						(item) => item.id,
					),
					verificationEvidenceHistorySummary: evidenceResolution.historySummary,
				},
				createdAt: now,
			})
			.onConflictDoNothing({
				target: missionPilotVerificationSnapshots.sourcePhaseRunId,
			})
			.returning({ id: missionPilotVerificationSnapshots.id });
		if (!inserted[0]) return false;
		await tx.insert(missionPilotContextSnapshots).values({
			id: crypto.randomUUID(),
			sessionId: input.session.id,
			revision: nextRevision,
			reason: "implementation_verified",
			contextJson: nextContext,
			digest: nextDigest,
			tokenEstimate: Math.ceil(JSON.stringify(nextContext).length / 4),
			createdAt: now,
		});
		await tx
			.update(missionPilotPhaseRuns)
			.set({
				status: "completed",
				verdict: "pass",
				evidenceJson: {
					...input.phaseRun.evidenceJson,
					verificationSnapshotId: snapshotId,
					acceptedEvidenceRunIds: evidenceResolution.acceptedEvidence.map(
						(item) => item.id,
					),
				},
				outputContextRevision: nextRevision,
				finishedAt: now,
			})
			.where(eq(missionPilotPhaseRuns.id, input.phaseRun.id));
		await tx
			.update(missionPilotSessions)
			.set({
				phase: "review_preparing",
				contextRevision: nextRevision,
				contextDigest: nextDigest,
				activeRunId: null,
				activePhaseRunId: null,
				activeVerificationSnapshotId: snapshotId,
				reviewCycle: input.session.reviewCycle + 1,
				updatedAt: now,
			})
			.where(eq(missionPilotSessions.id, input.session.id));
		await tx
			.update(tasks)
			.set({ status: "needs_review", updatedAt: now })
			.where(eq(tasks.id, input.session.taskId));
		return true;
	});
	if (!snapshotCreated) {
		const [persistedSnapshot] = await db
			.select()
			.from(missionPilotVerificationSnapshots)
			.where(
				eq(
					missionPilotVerificationSnapshots.sourcePhaseRunId,
					input.phaseRun.id,
				),
			)
			.limit(1);
		if (!persistedSnapshot) {
			throw new Error(
				"Mission Pilot verification snapshot conflict was not recoverable",
			);
		}
		return buildReviewContinuationFromVerificationSnapshot({
			sessionId: input.session.id,
			snapshotId: persistedSnapshot.id,
		});
	}

	await appendMissionPilotEvent({
		sessionId: input.session.id,
		taskId: input.session.taskId,
		eventType: "verification.snapshot_frozen",
		phase: "review_preparing",
		cycle: input.phaseRun.cycle,
		contextRevision: nextRevision,
		contextDigest: nextDigest,
		dedupeKey: `verification:${input.phaseRun.cycle}:snapshot:${input.runId}`,
		sourceKind: "verification",
		sourceId: snapshotId,
		payload: {
			snapshotId,
			checklistDigest,
			verificationEvidenceHistorySummary: evidenceResolution.historySummary,
		},
	});
	return buildReviewContinuationFromVerificationSnapshot({
		sessionId: input.session.id,
		snapshotId,
	});
}

export async function buildReviewContinuationFromVerificationSnapshot(input: {
	sessionId: string;
	snapshotId: string;
}) {
	const [session] = await db
		.select()
		.from(missionPilotSessions)
		.where(eq(missionPilotSessions.id, input.sessionId))
		.limit(1);
	const [snapshot] = await db
		.select()
		.from(missionPilotVerificationSnapshots)
		.where(eq(missionPilotVerificationSnapshots.id, input.snapshotId))
		.limit(1);
	const [sourcePhaseRun] = snapshot
		? await db
				.select()
				.from(missionPilotPhaseRuns)
				.where(eq(missionPilotPhaseRuns.id, snapshot.sourcePhaseRunId))
				.limit(1)
		: [];
	if (
		!session ||
		!snapshot ||
		!sourcePhaseRun ||
		snapshot.sessionId !== session.id ||
		sourcePhaseRun.sessionId !== session.id ||
		sourcePhaseRun.phase !== "implementation"
	) {
		return {
			kind: "attention",
			reasons: ["verification_snapshot_missing"],
		} as const;
	}
	const [latestContext] = await db
		.select()
		.from(missionPilotContextSnapshots)
		.where(eq(missionPilotContextSnapshots.sessionId, session.id))
		.orderBy(desc(missionPilotContextSnapshots.revision))
		.limit(1);
	const pendingRework = readRecord(
		readRecord(latestContext?.contextJson).execution,
	).pendingRework;
	return {
		kind: "start_review" as const,
		input: {
			anchorRunId: sourcePhaseRun.runId,
			targetRunIds: [sourcePhaseRun.runId],
			targetManifestContext: {
				contextDigest: session.contextDigest,
				verificationSnapshotId: snapshot.id,
				verificationSnapshotDigest: digestText(
					JSON.stringify({
						id: snapshot.id,
						sourcePhaseRunId: snapshot.sourcePhaseRunId,
						checklistDigest: snapshot.checklistDigest,
						evidenceRunIds: snapshot.evidenceRunIdsJson,
						completionCheckEventId: snapshot.completionCheckEventId,
						changedPaths: snapshot.changedPathsJson,
						snapshot: snapshot.snapshotJson,
					}),
				),
				sourceRuns: [
					{
						runId: sourcePhaseRun.runId,
						role: "implementation" as const,
					},
				],
			},
			missionPilot: {
				sessionId: session.id,
				cycle: session.reviewCycle,
				contextRevision: session.contextRevision,
				contextDigest: session.contextDigest,
				...(pendingRework ? { reworkPacket: pendingRework } : {}),
			},
		},
	};
}
