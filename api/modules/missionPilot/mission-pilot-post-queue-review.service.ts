import crypto from "node:crypto";
import { desc, eq, inArray } from "drizzle-orm";
import { missionPilotReviewDecisionPayloadSchema } from "../../../shared/schemas/mission-pilot-review.schema";
import { db } from "../../db/client";
import {
	missionPilotCloseouts,
	missionPilotContextSnapshots,
	missionPilotPhaseRuns,
	missionPilotReviewDecisions,
	missionPilotSessions,
} from "../../db/mission-pilot-schema";
import { taskRunCommitRecords, taskRuns } from "../../db/schema";
import { digestText } from "../../services/text-digest";
import * as reviewRepo from "../review/review-mode.repository";
import { evaluateReviewCompletionGate } from "./mission-pilot-post-queue-state";

export async function continueAfterReviewRun(input: {
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

export function parseStructuredReviewDecision(text: string) {
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

export function readReviewSessionId(snapshot: unknown) {
	const record = readRecord(snapshot);
	const reviewRun = readRecord(record.reviewRun);
	return typeof reviewRun.reviewSessionId === "string"
		? reviewRun.reviewSessionId
		: null;
}
export async function prepareImplementationRework(input: {
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
export function extractFirstJsonObject(text: string) {
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
export async function setMissionPilotAttention(
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

export function readRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}
