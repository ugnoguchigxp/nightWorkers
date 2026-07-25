import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ensureNightWorkersSchema } from "../api/db/bootstrap";
import { db } from "../api/db/client";
import {
	missionPilotContextSnapshots,
	missionPilotPhaseRuns,
	missionPilotSessions,
	missionPilotVerificationSnapshots,
} from "../api/db/mission-pilot-schema";
import { repositories, taskEvents, taskRuns, tasks } from "../api/db/schema";
import {
	verificationChecklistItems,
	verificationDocuments,
	verificationEvidenceRuns,
} from "../api/db/verification-schema";
import { finalizeImplementationVerification } from "../api/modules/missionPilot/mission-pilot-verification-snapshot.service";

const repositoryIds: string[] = [];

beforeAll(() => ensureNightWorkersSchema());

afterEach(async () => {
	for (const id of repositoryIds.splice(0)) {
		await db.delete(repositories).where(eq(repositories.id, id));
	}
});

describe("Mission Pilot implementation verification transition", () => {
	it("freezes evidence from the implementation Run and starts Review idempotently", async () => {
		const repositoryId = crypto.randomUUID();
		const taskId = crypto.randomUUID();
		const sessionId = crypto.randomUUID();
		const runId = crypto.randomUUID();
		const phaseRunId = crypto.randomUUID();
		const verificationDocumentId = crypto.randomUUID();
		const evidenceRunId = crypto.randomUUID();
		const completionEventId = crypto.randomUUID();
		const now = new Date();
		repositoryIds.push(repositoryId);

		await db.insert(repositories).values({
			id: repositoryId,
			name: "mission-pilot-implementation-verification",
			localPath: "/tmp/mission-pilot-implementation-verification",
			branch: "main",
		});
		await db.insert(tasks).values({
			id: taskId,
			repositoryId,
			title: "Verify implementation and review",
			status: "verifying",
		});
		await db.insert(taskRuns).values({
			id: runId,
			taskId,
			repositoryId,
			status: "completed",
			contextSnapshot: { executionMode: "implementation" },
			summary: "Implementation and verification completed.",
			diffPatch: "diff --git a/a.ts b/a.ts",
			startedAt: now,
			endedAt: now,
			finishedAt: now,
		});
		await db.insert(missionPilotSessions).values({
			id: sessionId,
			taskId,
			repositoryId,
			sourceKind: "task",
			sourceId: taskId,
			desiredState: "playing",
			phase: "implementation_evaluating",
			initialPromptSnapshot: "implement, verify, and review",
			initialPromptState: "sent",
			activeRunId: runId,
			activePhaseRunId: phaseRunId,
			implementationCycle: 1,
			reviewCycle: 0,
			contextRevision: 1,
			contextDigest: "ctx-1",
			queueHandoffJson: {
				sessionId,
				taskId,
				admissionKey: `mission-pilot:${sessionId}`,
				queueEntryId: crypto.randomUUID(),
				queueEntryStatus: "queued",
				queueClaimReady: false,
				reviewedContextRevision: 1,
				reviewedContextDigest: "ctx-1",
				routingRevision: 0,
				featurePlanMessageId: crypto.randomUUID(),
				featurePlanContentDigest: `sha256:${"1".repeat(64)}`,
				verificationDocumentId,
				planReviewId: crypto.randomUUID(),
				planReviewVerdict: "pass",
				queuedAt: now,
			},
			startedAt: now,
			createdAt: now,
			updatedAt: now,
		});
		await db.insert(missionPilotContextSnapshots).values({
			id: crypto.randomUUID(),
			sessionId,
			revision: 1,
			reason: "implementation_started",
			contextJson: { execution: { implementation: { currentCycle: 1 } } },
			digest: "ctx-1",
			tokenEstimate: 4,
			createdAt: now,
		});
		await db.insert(missionPilotPhaseRuns).values({
			id: phaseRunId,
			sessionId,
			taskId,
			phase: "implementation",
			cycle: 1,
			attempt: 1,
			runId,
			inputContextRevision: 1,
			inputContextDigest: "ctx-1",
			status: "running",
			evidenceJson: {},
			startedAt: now,
		});
		await db.insert(verificationDocuments).values({
			id: verificationDocumentId,
			taskId,
			runId,
			sourceSpecPath: "spec/feature-plan.md",
			documentJson: {},
			generatedAt: now,
		});
		await db.insert(verificationChecklistItems).values({
			id: crypto.randomUUID(),
			verificationDocumentId,
			taskId,
			conditionId: "AC-001",
			text: "Implementation evidence is complete",
			required: true,
			status: "passed",
			evidenceIdsJson: [evidenceRunId],
		});
		await db.insert(verificationEvidenceRuns).values({
			id: evidenceRunId,
			taskId,
			runId,
			verificationDocumentId,
			checkKind: "verify",
			command: "bun run verify",
			cwd: "/tmp/mission-pilot-implementation-verification",
			exitCode: 0,
			runner: "implementation",
			rawStdoutArtifactId: "stdout-artifact",
			rawStderrArtifactId: "stderr-artifact",
			summaryJson: {},
			commandLevelConditionIdsJson: ["AC-001"],
			startedAt: now,
			finishedAt: now,
		});
		await db.insert(taskEvents).values({
			id: completionEventId,
			taskRunId: runId,
			seq: 1,
			type: "info",
			eventType: "tool_result",
			message: "completion_check finished",
			payloadJson: {
				runEvent: {
					type: "tool.call_finished",
					data: {
						mcpTool: "completion_check",
						status: "completed",
						result: {
							structured_content: {
								payload: {
									result: { ok: true, verificationDocumentId },
								},
							},
						},
					},
				},
			},
			timestamp: now,
		});

		const session = await db.query.missionPilotSessions.findFirst({
			where: eq(missionPilotSessions.id, sessionId),
		});
		const phaseRun = await db.query.missionPilotPhaseRuns.findFirst({
			where: eq(missionPilotPhaseRuns.id, phaseRunId),
		});
		if (!session || !phaseRun) throw new Error("Fixture was not created");

		const result = await finalizeImplementationVerification({
			session,
			phaseRun,
			runId,
			changedPaths: ["a.ts"],
		});
		expect(result).toMatchObject({
			kind: "start_review",
			input: {
				anchorRunId: runId,
				targetRunIds: [runId],
				targetManifestContext: {
					sourceRuns: [{ runId, role: "implementation" }],
				},
			},
		});
		const snapshot = await db.query.missionPilotVerificationSnapshots.findFirst(
			{
				where: eq(
					missionPilotVerificationSnapshots.sourcePhaseRunId,
					phaseRunId,
				),
			},
		);
		expect(snapshot).toMatchObject({
			sourcePhaseRunId: phaseRunId,
			completionCheckEventId: completionEventId,
			evidenceRunIdsJson: [evidenceRunId],
			changedPathsJson: ["a.ts"],
			verdict: "pass",
		});
		const updatedSession = await db.query.missionPilotSessions.findFirst({
			where: eq(missionPilotSessions.id, sessionId),
		});
		expect(updatedSession).toMatchObject({
			phase: "review_preparing",
			reviewCycle: 1,
			activeVerificationSnapshotId: snapshot?.id,
		});
		if (!updatedSession) throw new Error("Session was not advanced to Review");

		await finalizeImplementationVerification({
			session: updatedSession,
			phaseRun,
			runId,
			changedPaths: ["a.ts"],
		});
		expect(
			await db.query.missionPilotVerificationSnapshots.findMany({
				where: eq(
					missionPilotVerificationSnapshots.sourcePhaseRunId,
					phaseRunId,
				),
			}),
		).toHaveLength(1);
	});
});
