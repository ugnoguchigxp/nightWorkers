import crypto from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { missionPilotTestDecisionSchema } from "../../../shared/schemas/mission-pilot-test.schema";
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
import { digestText } from "../../services/text-digest";
import { appendMissionPilotEvent } from "./mission-pilot-event.repository";
import {
	extractFirstJsonObject,
	prepareImplementationRework,
	readRecord,
	setMissionPilotAttention,
} from "./mission-pilot-post-queue-review.service";
import { evaluateTestCompletionGate } from "./mission-pilot-post-queue-state";

export async function continueAfterTestRun(input: {
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
