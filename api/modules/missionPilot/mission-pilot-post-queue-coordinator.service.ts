import crypto from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { missionPilotReviewDecisionPayloadSchema } from "../../../shared/schemas/mission-pilot-review.schema";
import { missionPilotTestDecisionSchema } from "../../../shared/schemas/mission-pilot-test.schema";
import { db } from "../../db/client";
import {
	missionPilotCloseouts,
	missionPilotContextSnapshots,
	missionPilotEvents,
	missionPilotPhaseRuns,
	missionPilotReviewDecisions,
	missionPilotSessions,
	missionPilotTestSnapshots,
} from "../../db/mission-pilot-schema";
import {
	implementationQueueEntries,
	type TaskStatus,
	taskEvents,
	taskRunCommitRecords,
	taskRuns,
	taskRunTodos,
	tasks,
} from "../../db/schema";
import {
	verificationChecklistItems,
	verificationEvidenceRuns,
} from "../../db/verification-schema";
import { logger } from "../../lib/logger";
import { digestText } from "../../services/text-digest";
import * as reviewRepo from "../review/review-mode.repository";
import { appendMissionPilotEvent } from "./mission-pilot-event.repository";
import {
	evaluateImplementationCompletionGate,
	evaluateReviewCompletionGate,
	evaluateTestCompletionGate,
} from "./mission-pilot-post-queue-state";

export async function resolveMissionPilotParentTaskStatus(input: {
	runId: string;
	runStatus: TaskStatus;
	executionMode: string;
}): Promise<TaskStatus> {
	const [phaseRun] = await db
		.select()
		.from(missionPilotPhaseRuns)
		.where(eq(missionPilotPhaseRuns.runId, input.runId))
		.limit(1);
	if (!phaseRun) return input.runStatus;
	if (!["completed", "needs_review"].includes(input.runStatus))
		return input.runStatus;
	if (input.executionMode === "implementation") return "verifying";
	return "needs_review";
}

export async function releaseMissionPilotQueueHandoff(taskId: string) {
	const now = new Date();
	const released = await db.transaction(async (tx) => {
		const [session] = await tx
			.select()
			.from(missionPilotSessions)
			.where(eq(missionPilotSessions.taskId, taskId))
			.limit(1);
		const handoff = session?.queueHandoffJson;
		if (
			!session ||
			!handoff ||
			session.desiredState !== "playing" ||
			session.phase !== "queued" ||
			handoff.reviewedContextRevision !== session.contextRevision ||
			handoff.reviewedContextDigest !== session.contextDigest
		)
			return null;
		const [entry] = await tx
			.select()
			.from(implementationQueueEntries)
			.where(eq(implementationQueueEntries.id, handoff.queueEntryId))
			.limit(1);
		if (!entry || entry.status !== "queued") return null;
		if (!entry.claimReady) {
			await tx
				.update(implementationQueueEntries)
				.set({ claimReady: true, updatedAt: now })
				.where(
					and(
						eq(implementationQueueEntries.id, entry.id),
						eq(implementationQueueEntries.claimReady, false),
					),
				);
		}
		await tx
			.insert(missionPilotEvents)
			.values({
				id: crypto.randomUUID(),
				sessionId: session.id,
				taskId: session.taskId,
				eventType: "queue.handoff_released",
				phase: "implementation_starting",
				cycle: session.implementationCycle,
				contextRevision: session.contextRevision,
				contextDigest: session.contextDigest,
				dedupeKey: `queue:released:${entry.id}`,
				sourceKind: "queue",
				sourceId: entry.id,
				payloadJson: { admissionKey: handoff.admissionKey },
				processStatus: "processed",
				attemptCount: 0,
				availableAt: now,
				processedAt: now,
				createdAt: now,
				updatedAt: now,
			})
			.onConflictDoNothing({
				target: [missionPilotEvents.sessionId, missionPilotEvents.dedupeKey],
			});
		await tx
			.update(missionPilotSessions)
			.set({ phase: "implementation_starting", updatedAt: now })
			.where(eq(missionPilotSessions.id, session.id));
		return entry.id;
	});
	if (released) {
		const { runImplementationQueue } = await import(
			"../nightworkers/nightworkers.run-orchestration.service"
		);
		void runImplementationQueue().catch((error) => {
			logger.error({ error, taskId }, "Mission Pilot queue release failed");
		});
	}
	return released;
}

export async function continueMissionPilotAfterRun(input: {
	taskId: string;
	runId: string;
	executionMode: string;
}) {
	const [phaseRun] = await db
		.select()
		.from(missionPilotPhaseRuns)
		.where(eq(missionPilotPhaseRuns.runId, input.runId))
		.limit(1);
	if (!phaseRun) return { kind: "not_mission_pilot" } as const;
	const [session] = await db
		.select()
		.from(missionPilotSessions)
		.where(eq(missionPilotSessions.id, phaseRun.sessionId))
		.limit(1);
	if (!session || session.desiredState !== "playing")
		return { kind: "paused" } as const;
	if (input.executionMode === "test") {
		return continueAfterTestRun({ session, phaseRun, runId: input.runId });
	}
	if (input.executionMode === "review") {
		return continueAfterReviewRun({ session, phaseRun, runId: input.runId });
	}
	if (input.executionMode !== "implementation") {
		return { kind: "awaiting_domain_gate", phase: phaseRun.phase } as const;
	}
	const [run] = await db
		.select()
		.from(taskRuns)
		.where(eq(taskRuns.id, input.runId))
		.limit(1);
	const todos = await db
		.select()
		.from(taskRunTodos)
		.where(eq(taskRunTodos.runId, input.runId));
	const [commitRecord] = await db
		.select()
		.from(taskRunCommitRecords)
		.where(eq(taskRunCommitRecords.runId, input.runId))
		.limit(1);
	const gate = evaluateImplementationCompletionGate({
		runStatus: run?.status ?? "missing",
		terminalReason: null,
		openTodoCount: todos.filter((todo) =>
			["pending", "running"].includes(todo.status),
		).length,
		securityAllowed:
			run?.status === "completed" || run?.status === "needs_review",
		hasOwnershipEvidence: Boolean(commitRecord),
		hasDiffOrNoopEvidence: Boolean(
			run?.diffPatch ||
				commitRecord?.ownedCandidatePathsJson ||
				commitRecord?.status === "ready",
		),
		hasFinalReport: Boolean(run?.finalReport || run?.summary),
		contextDigestMatches: phaseRun.inputContextDigest === session.contextDigest,
	});
	if (!gate.pass) {
		await setMissionPilotAttention(
			session.id,
			phaseRun.id,
			gate.reasons.join(","),
		);
		return { kind: "attention", reasons: gate.reasons } as const;
	}
	const [latestContext] = await db
		.select()
		.from(missionPilotContextSnapshots)
		.where(eq(missionPilotContextSnapshots.sessionId, session.id))
		.orderBy(desc(missionPilotContextSnapshots.revision))
		.limit(1);
	if (!latestContext) {
		await setMissionPilotAttention(
			session.id,
			phaseRun.id,
			"context_snapshot_missing",
		);
		return {
			kind: "attention",
			reasons: ["context_snapshot_missing"],
		} as const;
	}
	const changedPaths = commitRecord?.ownedCandidatePathsJson ?? [];
	const nextContext = {
		...latestContext.contextJson,
		execution: {
			...readRecord(latestContext.contextJson.execution),
			pendingRework: undefined,
			implementation: {
				currentCycle: phaseRun.cycle,
				latestAcceptedRunId: run?.id,
				changedPaths,
				diffDigest: run?.diffPatch ? digestText(run.diffPatch) : null,
				finalReportSummary: run?.summary ?? null,
			},
		},
	};
	const nextRevision = session.contextRevision + 1;
	const digest = digestText(JSON.stringify(nextContext));
	const now = new Date();
	await db.transaction(async (tx) => {
		await tx.insert(missionPilotContextSnapshots).values({
			id: crypto.randomUUID(),
			sessionId: session.id,
			revision: nextRevision,
			reason: "implementation_completed",
			contextJson: nextContext,
			digest,
			tokenEstimate: Math.ceil(JSON.stringify(nextContext).length / 4),
			createdAt: now,
		});
		await tx
			.update(missionPilotPhaseRuns)
			.set({
				status: "completed",
				verdict: "pass",
				outputContextRevision: nextRevision,
				finishedAt: now,
			})
			.where(eq(missionPilotPhaseRuns.id, phaseRun.id));
		await tx
			.update(missionPilotSessions)
			.set({
				phase: "test_preparing",
				contextRevision: nextRevision,
				contextDigest: digest,
				activeRunId: null,
				activePhaseRunId: null,
				testCycle: session.testCycle + 1,
				updatedAt: now,
			})
			.where(
				and(
					eq(missionPilotSessions.id, session.id),
					eq(missionPilotSessions.contextDigest, session.contextDigest),
				),
			);
		await tx
			.update(tasks)
			.set({ status: "verifying", updatedAt: now })
			.where(eq(tasks.id, session.taskId));
	});
	await appendMissionPilotEvent({
		sessionId: session.id,
		taskId: session.taskId,
		eventType: "implementation.completed",
		phase: "test_preparing",
		cycle: phaseRun.cycle,
		contextRevision: nextRevision,
		contextDigest: digest,
		dedupeKey: `implementation:${phaseRun.cycle}:completed:${input.runId}`,
		sourceKind: "task_run",
		sourceId: input.runId,
		payload: { phaseRunId: phaseRun.id, changedPaths },
	});
	const handoff = session.queueHandoffJson;
	if (!handoff)
		return { kind: "attention", reasons: ["queue_handoff_missing"] } as const;
	return {
		kind: "start_test",
		input: {
			projectId: session.repositoryId,
			taskId: session.taskId,
			specArtifactId: handoff.featurePlanMessageId,
			verificationDocumentId: handoff.verificationDocumentId,
			missionPilot: {
				sessionId: session.id,
				cycle: session.testCycle + 1,
				contextRevision: nextRevision,
				contextDigest: digest,
			},
		},
	} as const;
}

async function continueAfterReviewRun(input: {
	session: typeof missionPilotSessions.$inferSelect;
	phaseRun: typeof missionPilotPhaseRuns.$inferSelect;
	runId: string;
}) {
	const [run] = await db
		.select()
		.from(taskRuns)
		.where(eq(taskRuns.id, input.runId))
		.limit(1);
	const decision = parseStructuredReviewDecision(run?.finalReport ?? "");
	const testSnapshotId = input.session.activeTestSnapshotId;
	const phaseRuns = await db
		.select()
		.from(missionPilotPhaseRuns)
		.where(eq(missionPilotPhaseRuns.sessionId, input.session.id));
	const commitRecords = phaseRuns.length
		? await db
				.select()
				.from(taskRunCommitRecords)
				.where(
					inArray(
						taskRunCommitRecords.runId,
						phaseRuns.map((item) => item.runId),
					),
				)
		: [];
	const existingCloseouts = await db
		.select()
		.from(missionPilotCloseouts)
		.where(eq(missionPilotCloseouts.sessionId, input.session.id));
	const ownedPaths = [
		...new Set(
			commitRecords.flatMap((record) => record.ownedCandidatePathsJson ?? []),
		),
	].sort();
	const targetManifestDigest = digestText(JSON.stringify(ownedPaths));
	const gate = evaluateReviewCompletionGate({
		decision,
		contextDigestMatches:
			input.phaseRun.inputContextDigest === input.session.contextDigest,
		testSnapshotMatches: Boolean(testSnapshotId),
		targetManifestMatches: ownedPaths.length > 0 || commitRecords.length > 0,
	});
	if (!gate.pass || !gate.decision || !testSnapshotId) {
		if (gate.decision?.verdict === "rework") {
			const reviewSessionId = readReviewSessionId(run?.contextSnapshot);
			if (reviewSessionId) {
				await reviewRepo.updateReviewSession(reviewSessionId, {
					status: "completed",
					completedAt: new Date(),
					finalAction: "changes_requested",
					finalNote: gate.decision.summary,
				});
			}
			return prepareImplementationRework({
				session: input.session,
				phaseRun: input.phaseRun,
				source: "review",
				reworkPacket: {
					summary: gate.decision.summary,
					findings: gate.decision.findings.filter(
						(finding) => finding.severity === "blocking",
					),
				},
			});
		}
		await setMissionPilotAttention(
			input.session.id,
			input.phaseRun.id,
			gate.reasons.join(","),
		);
		return { kind: "attention", reasons: gate.reasons } as const;
	}
	const snapshotDecision = gate.decision;
	const blockingCount = snapshotDecision.findings.filter(
		(finding) => finding.severity === "blocking",
	).length;
	const warningCount = snapshotDecision.findings.filter(
		(finding) => finding.severity === "warning",
	).length;
	const infoCount = snapshotDecision.findings.filter(
		(finding) => finding.severity === "info",
	).length;
	const reviewSessionId = readReviewSessionId(run?.contextSnapshot);
	if (!reviewSessionId) {
		await setMissionPilotAttention(
			input.session.id,
			input.phaseRun.id,
			"review_session_missing",
		);
		return { kind: "attention", reasons: ["review_session_missing"] } as const;
	}
	const now = new Date();
	const decisionId = crypto.randomUUID();
	const latestImplementationRun = phaseRuns
		.filter((item) => item.phase === "implementation")
		.sort((left, right) =>
			right.cycle === left.cycle
				? right.attempt - left.attempt
				: right.cycle - left.cycle,
		)[0];
	const baselineHead =
		commitRecords.find(
			(record) => record.runId === latestImplementationRun?.runId,
		)?.baselineHead ??
		commitRecords.map((record) => record.baselineHead).find(Boolean);
	if (!baselineHead) {
		await setMissionPilotAttention(
			input.session.id,
			input.phaseRun.id,
			"baseline_head_missing",
		);
		return { kind: "attention", reasons: ["baseline_head_missing"] } as const;
	}
	const stageablePaths = [
		...new Set(
			commitRecords.flatMap((record) => record.stageableOwnedPathsJson ?? []),
		),
	].sort();
	const excludedPaths = [
		...new Set(
			commitRecords.flatMap((record) =>
				(record.excludedPathsJson ?? []).map((item) => item.path),
			),
		),
	].sort();
	const closeoutId = crypto.randomUUID();
	const closeoutAttempt =
		Math.max(0, ...existingCloseouts.map((item) => item.attempt)) + 1;
	const authorization = input.session.authorizationJson;
	const pushPolicy = authorization?.pushPolicy ?? "never";
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
			review: {
				reviewSessionId,
				decisionId,
				verdict: "pass",
				blockingCount,
				warningCount,
				infoCount,
				testSnapshotId,
				targetManifestDigest,
			},
		},
	};
	const nextRevision = input.session.contextRevision + 1;
	const nextDigest = digestText(JSON.stringify(nextContext));
	await db.transaction(async (tx) => {
		await tx.insert(missionPilotContextSnapshots).values({
			id: crypto.randomUUID(),
			sessionId: input.session.id,
			revision: nextRevision,
			reason: "review_completed",
			contextJson: nextContext,
			digest: nextDigest,
			tokenEstimate: Math.ceil(JSON.stringify(nextContext).length / 4),
			createdAt: now,
		});
		await tx.insert(missionPilotReviewDecisions).values({
			id: decisionId,
			sessionId: input.session.id,
			reviewSessionId,
			reviewPhaseRunId: input.phaseRun.id,
			contextRevision: input.session.contextRevision,
			contextDigest: input.session.contextDigest,
			testSnapshotId,
			targetManifestDigest,
			verdict: "pass",
			blockingCount,
			warningCount,
			infoCount,
			findingIdsJson: [],
			decisionJson: snapshotDecision,
			createdAt: now,
		});
		await tx.insert(missionPilotCloseouts).values({
			id: closeoutId,
			sessionId: input.session.id,
			attempt: closeoutAttempt,
			repositoryId: input.session.repositoryId,
			baselineHead,
			reviewDecisionId: decisionId,
			reviewedContextDigest: nextDigest,
			ownedPhaseRunIdsJson: phaseRuns
				.filter((item) => item.phase !== "review")
				.map((item) => item.id),
			stageableOwnedPathsJson: stageablePaths,
			excludedPathsJson: excludedPaths,
			status: stageablePaths.length > 0 ? "ready" : "skipped",
			pushPolicy,
			pushStatus: "not_requested",
			createdAt: now,
			updatedAt: now,
		});
		await tx
			.update(missionPilotPhaseRuns)
			.set({
				status: "completed",
				verdict: "pass",
				outputContextRevision: nextRevision,
				finishedAt: now,
			})
			.where(eq(missionPilotPhaseRuns.id, input.phaseRun.id));
		await tx
			.update(missionPilotSessions)
			.set({
				phase: "closeout_preparing",
				contextRevision: nextRevision,
				contextDigest: nextDigest,
				activeRunId: null,
				activePhaseRunId: null,
				activeReviewDecisionId: decisionId,
				activeCloseoutId: closeoutId,
				updatedAt: now,
			})
			.where(eq(missionPilotSessions.id, input.session.id));
	});
	await reviewRepo.updateReviewSession(reviewSessionId, {
		status: "completed",
		completedAt: now,
		finalAction: "approved",
		finalNote: snapshotDecision.summary,
	});
	return {
		kind: "run_closeout",
		sessionId: input.session.id,
		closeoutId,
	} as const;
}

function parseStructuredReviewDecision(text: string) {
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
			const parsed = missionPilotReviewDecisionPayloadSchema.safeParse(
				JSON.parse(candidate),
			);
			if (parsed.success) return parsed.data;
		} catch {}
	}
	return null;
}

function readReviewSessionId(snapshot: unknown) {
	const record = readRecord(snapshot);
	const reviewRun = readRecord(record.reviewRun);
	return typeof reviewRun.reviewSessionId === "string"
		? reviewRun.reviewSessionId
		: null;
}

async function continueAfterTestRun(input: {
	session: typeof missionPilotSessions.$inferSelect;
	phaseRun: typeof missionPilotPhaseRuns.$inferSelect;
	runId: string;
}) {
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
	const events = await db
		.select()
		.from(taskEvents)
		.where(eq(taskEvents.taskRunId, input.runId));
	const completionEvent = events.find((event) => {
		const serialized = JSON.stringify(event.payloadJson ?? {});
		return serialized.includes('"completion_check"');
	});
	const completionSerialized = JSON.stringify(
		completionEvent?.payloadJson ?? {},
	);
	const completedChecklistStatuses = new Set([
		"complete",
		"passed",
		"covered",
		"verified_by_gate",
		"manual",
		"not_applicable",
	]);
	const requiredComplete = required.filter((item) =>
		completedChecklistStatuses.has(item.status),
	).length;
	const gate = evaluateTestCompletionGate({
		runStatus: run?.status ?? "missing",
		verificationDocumentMatches: Boolean(verificationDocumentId),
		managedEvidenceCount: evidence.length,
		failedManagedEvidenceCount: evidence.filter((item) => item.exitCode !== 0)
			.length,
		rawArtifactsComplete: evidence.every((item) =>
			Boolean(item.rawStdoutArtifactId && item.rawStderrArtifactId),
		),
		completionCheckEventId: completionEvent?.id ?? null,
		completionCheckOk: completionSerialized.includes('"ok":true'),
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
				evidenceRunIds: evidence.map((item) => item.id),
				completionCheckEventId: completionEvent?.id ?? "",
				verdict: "pass",
			},
		},
	};
	const nextRevision = input.session.contextRevision + 1;
	const nextDigest = digestText(JSON.stringify(nextContext));
	await db.transaction(async (tx) => {
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
		await tx.insert(missionPilotTestSnapshots).values({
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
			evidenceRunIdsJson: evidence.map((item) => item.id),
			completionCheckEventId: completionEvent?.id ?? "",
			testChangedPathsJson: [],
			verdict: "pass",
			snapshotJson: {
				checklistDigest,
				evidenceRunIds: evidence.map((item) => item.id),
			},
			createdAt: now,
		});
		await tx
			.update(missionPilotPhaseRuns)
			.set({
				status: "completed",
				verdict: "pass",
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
	});
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
		payload: { snapshotId, checklistDigest },
	});
	const [anchor] = await db
		.select()
		.from(missionPilotPhaseRuns)
		.where(
			and(
				eq(missionPilotPhaseRuns.sessionId, input.session.id),
				eq(missionPilotPhaseRuns.phase, "implementation"),
				eq(missionPilotPhaseRuns.status, "completed"),
			),
		)
		.orderBy(desc(missionPilotPhaseRuns.cycle))
		.limit(1);
	if (!anchor)
		return {
			kind: "attention",
			reasons: ["implementation_anchor_missing"],
		} as const;
	const missionTargetRuns = await db
		.select()
		.from(missionPilotPhaseRuns)
		.where(eq(missionPilotPhaseRuns.sessionId, input.session.id));
	return {
		kind: "start_review",
		input: {
			anchorRunId: anchor.runId,
			targetRunIds: missionTargetRuns
				.filter((item) => item.phase !== "review")
				.map((item) => item.runId),
			missionPilot: {
				sessionId: input.session.id,
				cycle: input.session.reviewCycle + 1,
				contextRevision: nextRevision,
				contextDigest: nextDigest,
			},
		},
	} as const;
}

async function prepareImplementationRework(input: {
	session: typeof missionPilotSessions.$inferSelect;
	phaseRun: typeof missionPilotPhaseRuns.$inferSelect;
	source: "test" | "review";
	reworkPacket: unknown;
}) {
	const implementationCycle = input.session.implementationCycle + 1;
	const totalCorrectionCycle = input.session.totalCorrectionCycle + 1;
	if (
		implementationCycle > 3 ||
		totalCorrectionCycle > 5 ||
		(input.source === "review" && input.session.reviewCycle >= 2)
	) {
		await setMissionPilotAttention(
			input.session.id,
			input.phaseRun.id,
			"correction_cycle_limit",
		);
		return { kind: "attention", reasons: ["correction_cycle_limit"] } as const;
	}
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
				phase: "implementation_rework",
				implementationCycle,
				totalCorrectionCycle,
				activeRunId: null,
				activePhaseRunId: null,
				activeTestSnapshotId: null,
				activeReviewDecisionId: null,
				activeCloseoutId: null,
				updatedAt: now,
			})
			.where(eq(missionPilotSessions.id, input.session.id));
	});
	return {
		kind: "start_implementation_rework",
		input: {
			taskId: input.session.taskId,
			missionPilot: {
				sessionId: input.session.id,
				cycle: implementationCycle,
				contextRevision: input.session.contextRevision,
				contextDigest: input.session.contextDigest,
				reworkPacket: input.reworkPacket,
			},
		},
	} as const;
}

async function prepareTestRetry(input: {
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

function parseStructuredTestDecision(text: string) {
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

function extractFirstJsonObject(text: string) {
	const start = text.indexOf("{");
	if (start < 0) return null;
	let depth = 0;
	let inString = false;
	let escaped = false;
	for (let index = start; index < text.length; index += 1) {
		const char = text[index];
		if (inString) {
			if (escaped) escaped = false;
			else if (char === "\\") escaped = true;
			else if (char === '"') inString = false;
			continue;
		}
		if (char === '"') inString = true;
		else if (char === "{") depth += 1;
		else if (char === "}") {
			depth -= 1;
			if (depth === 0) return text.slice(start, index + 1);
		}
	}
	return null;
}

async function setMissionPilotAttention(
	sessionId: string,
	phaseRunId: string,
	reason: string,
) {
	const now = new Date();
	await db
		.update(missionPilotPhaseRuns)
		.set({ status: "failed", verdict: "attention", finishedAt: now })
		.where(eq(missionPilotPhaseRuns.id, phaseRunId));
	await db
		.update(missionPilotSessions)
		.set({
			phase: "attention",
			lastErrorCode: "MISSION_PILOT_IMPLEMENTATION_GATE_REJECTED",
			lastErrorMessage: reason,
			updatedAt: now,
		})
		.where(eq(missionPilotSessions.id, sessionId));
}

function readRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}
