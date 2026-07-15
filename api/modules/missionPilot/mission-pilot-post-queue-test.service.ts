import crypto from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { missionPilotTestDecisionSchema } from "../../../shared/schemas/mission-pilot-test.schema";
import { isVerificationChecklistItemComplete } from "../../../shared/schemas/verification-checklist.schema";
import { db } from "../../db/client";
import {
	missionPilotContextSnapshots,
	missionPilotPhaseRuns,
	missionPilotSessions,
	missionPilotTestSnapshots,
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
	extractFirstJsonObject,
	prepareImplementationRework,
	readRecord,
	setMissionPilotAttention,
} from "./mission-pilot-post-queue-review.service";
import { evaluateTestCompletionGate } from "./mission-pilot-post-queue-state";
import { resolvePersistedTestEvidence } from "./mission-pilot-test-evidence";

export async function continueAfterTestRun(input: {
	session: typeof missionPilotSessions.$inferSelect;
	phaseRun: typeof missionPilotPhaseRuns.$inferSelect;
	runId: string;
}) {
	const [existingSnapshot] = await db
		.select()
		.from(missionPilotTestSnapshots)
		.where(eq(missionPilotTestSnapshots.phaseRunId, input.phaseRun.id))
		.limit(1);
	if (existingSnapshot) {
		return buildReviewContinuationFromTestSnapshot({
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
	if (!verificationDocumentId) {
		await setMissionPilotAttention(
			input.session.id,
			input.phaseRun.id,
			"verification_document_missing",
		);
		return {
			kind: "attention",
			reasons: ["verification_document_missing"],
		} as const;
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
		.where(
			and(
				eq(verificationEvidenceRuns.runId, input.runId),
				eq(
					verificationEvidenceRuns.verificationDocumentId,
					verificationDocumentId,
				),
			),
		);
	const evidenceResolution = resolvePersistedTestEvidence({
		historyRows: evidence,
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
	const gate = evaluateTestCompletionGate({
		runStatus: run?.status ?? "missing",
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
		sourceChangedAfterTest: false,
	});
	if (!gate.pass) {
		const testDecision = parseStructuredTestDecision(run?.finalReport ?? "");
		if (
			testDecision?.verdict === "rework" &&
			testDecision.defectOwner === "test"
		) {
			return prepareTestRetry({
				session: input.session,
				phaseRun: input.phaseRun,
				reworkPacket: {
					summary: testDecision.summary,
					failedConditionIds: testDecision.failedConditionIds,
					affectedPaths: testDecision.affectedPaths,
				},
			});
		}
		if (
			testDecision?.verdict === "rework" &&
			testDecision.defectOwner === "implementation"
		) {
			return prepareImplementationRework({
				session: input.session,
				phaseRun: input.phaseRun,
				source: "test",
				reworkPacket: testDecision.implementationRework ?? {
					summary: testDecision.summary,
				},
			});
		}
		await setMissionPilotAttention(
			input.session.id,
			input.phaseRun.id,
			gate.reasons.join(","),
			{
				errorCode: "MISSION_PILOT_TEST_GATE_REJECTED",
				reasonCodes: gate.reasons,
				evidence: {
					testEvidenceHistorySummary: evidenceResolution.historySummary,
				},
			},
		);
		return { kind: "attention", reasons: gate.reasons } as const;
	}
	const now = new Date();
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
	const nextContext = {
		...latestContext.contextJson,
		execution: {
			...readRecord(latestContext.contextJson.execution),
			test: {
				snapshotId,
				phaseRunId: input.phaseRun.id,
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
	const snapshotCreated = await db.transaction(async (tx) => {
		const inserted = await tx
			.insert(missionPilotTestSnapshots)
			.values({
				id: snapshotId,
				sessionId: input.session.id,
				phaseRunId: input.phaseRun.id,
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
				testChangedPathsJson: [],
				verdict: "pass",
				snapshotJson: {
					checklistDigest,
					evidenceRunIds: evidenceResolution.acceptedEvidence.map(
						(item) => item.id,
					),
					testEvidenceHistorySummary: evidenceResolution.historySummary,
				},
				createdAt: now,
			})
			.onConflictDoNothing({
				target: missionPilotTestSnapshots.phaseRunId,
			})
			.returning({ id: missionPilotTestSnapshots.id });
		if (!inserted[0]) return false;
		await tx.insert(missionPilotContextSnapshots).values({
			id: crypto.randomUUID(),
			sessionId: input.session.id,
			revision: nextRevision,
			reason: "test_completed",
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
					acceptedEvidenceRunIds: evidenceResolution.acceptedEvidence.map(
						(item) => item.id,
					),
					testEvidenceHistorySummary: evidenceResolution.historySummary,
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
				activeTestSnapshotId: snapshotId,
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
			.from(missionPilotTestSnapshots)
			.where(eq(missionPilotTestSnapshots.phaseRunId, input.phaseRun.id))
			.limit(1);
		if (!persistedSnapshot)
			throw new Error(
				"Mission Pilot Test snapshot conflict was not recoverable",
			);
		return buildReviewContinuationFromTestSnapshot({
			sessionId: input.session.id,
			snapshotId: persistedSnapshot.id,
		});
	}
	await appendMissionPilotEvent({
		sessionId: input.session.id,
		taskId: input.session.taskId,
		eventType: "test_mode.snapshot_frozen",
		phase: "review_preparing",
		cycle: input.phaseRun.cycle,
		contextRevision: nextRevision,
		contextDigest: nextDigest,
		dedupeKey: `test:${input.phaseRun.cycle}:snapshot:${input.runId}`,
		sourceKind: "verification",
		sourceId: snapshotId,
		payload: {
			snapshotId,
			checklistDigest,
			testEvidenceHistorySummary: evidenceResolution.historySummary,
		},
	});
	return buildReviewContinuationFromTestSnapshot({
		sessionId: input.session.id,
		snapshotId,
	});
}

export async function buildReviewContinuationFromTestSnapshot(input: {
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
		.from(missionPilotTestSnapshots)
		.where(eq(missionPilotTestSnapshots.id, input.snapshotId))
		.limit(1);
	const [testPhaseRun] = snapshot
		? await db
				.select()
				.from(missionPilotPhaseRuns)
				.where(eq(missionPilotPhaseRuns.id, snapshot.phaseRunId))
				.limit(1)
		: [];
	if (
		!session ||
		!snapshot ||
		!testPhaseRun ||
		snapshot.sessionId !== session.id ||
		testPhaseRun.sessionId !== session.id ||
		testPhaseRun.phase !== "test"
	) {
		return { kind: "attention", reasons: ["test_snapshot_missing"] } as const;
	}
	const [anchor] = await db
		.select()
		.from(missionPilotPhaseRuns)
		.where(
			and(
				eq(missionPilotPhaseRuns.sessionId, session.id),
				eq(missionPilotPhaseRuns.phase, "implementation"),
				eq(missionPilotPhaseRuns.status, "completed"),
			),
		)
		.orderBy(
			desc(missionPilotPhaseRuns.cycle),
			desc(missionPilotPhaseRuns.attempt),
		)
		.limit(1);
	if (!anchor)
		return {
			kind: "attention",
			reasons: ["implementation_anchor_missing"],
		} as const;
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
			anchorRunId: anchor.runId,
			targetRunIds: [anchor.runId, testPhaseRun.runId],
			targetManifestContext: {
				contextDigest: session.contextDigest,
				testSnapshotId: snapshot.id,
				testSnapshotDigest: digestText(
					JSON.stringify({
						id: snapshot.id,
						phaseRunId: snapshot.phaseRunId,
						checklistDigest: snapshot.checklistDigest,
						evidenceRunIds: snapshot.evidenceRunIdsJson,
						completionCheckEventId: snapshot.completionCheckEventId,
						testChangedPaths: snapshot.testChangedPathsJson,
						snapshot: snapshot.snapshotJson,
					}),
				),
				sourceRuns: [
					{ runId: anchor.runId, role: "implementation" as const },
					{ runId: testPhaseRun.runId, role: "test" as const },
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

export async function prepareTestRetry(input: {
	session: typeof missionPilotSessions.$inferSelect;
	phaseRun: typeof missionPilotPhaseRuns.$inferSelect;
	reworkPacket: unknown;
}) {
	if (input.phaseRun.attempt >= 3) {
		await setMissionPilotAttention(
			input.session.id,
			input.phaseRun.id,
			"test_retry_limit",
		);
		return { kind: "attention", reasons: ["test_retry_limit"] } as const;
	}
	const handoff = input.session.queueHandoffJson;
	if (!handoff)
		return { kind: "attention", reasons: ["queue_handoff_missing"] } as const;
	const now = new Date();
	await db.transaction(async (tx) => {
		await tx
			.update(missionPilotPhaseRuns)
			.set({
				status: "completed",
				verdict: "rework",
				evidenceJson: { reworkPacket: input.reworkPacket },
				finishedAt: now,
			})
			.where(eq(missionPilotPhaseRuns.id, input.phaseRun.id));
		await tx
			.update(missionPilotSessions)
			.set({
				phase: "test_preparing",
				activeRunId: null,
				activePhaseRunId: null,
				updatedAt: now,
			})
			.where(eq(missionPilotSessions.id, input.session.id));
	});
	return {
		kind: "start_test",
		input: {
			projectId: input.session.repositoryId,
			taskId: input.session.taskId,
			specArtifactId: handoff.featurePlanMessageId,
			verificationDocumentId: handoff.verificationDocumentId,
			missionPilot: {
				sessionId: input.session.id,
				cycle: input.session.testCycle,
				contextRevision: input.session.contextRevision,
				contextDigest: input.session.contextDigest,
			},
		},
	} as const;
}

export function parseStructuredTestDecision(text: string) {
	const trimmed = text.trim();
	const candidates = [trimmed, extractFirstJsonObject(trimmed)].filter(
		(value): value is string => Boolean(value),
	);
	const firstFence = trimmed.indexOf("```json");
	if (firstFence >= 0) {
		const start = trimmed.indexOf("\n", firstFence);
		const end = trimmed.indexOf("```", start + 1);
		if (start >= 0 && end > start)
			candidates.unshift(trimmed.slice(start + 1, end).trim());
	}
	for (const candidate of candidates) {
		try {
			const parsed = missionPilotTestDecisionSchema.safeParse(
				JSON.parse(candidate),
			);
			if (parsed.success) return parsed.data;
		} catch {}
	}
	return null;
}
