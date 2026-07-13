import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ensureNightWorkersSchema } from "../api/db/bootstrap";
import { db } from "../api/db/client";
import {
	missionPilotContextSnapshots,
	missionPilotPhaseRuns,
	missionPilotSessions,
	missionPilotTestSnapshots,
} from "../api/db/mission-pilot-schema";
import { repositories, taskEvents, taskRuns, tasks } from "../api/db/schema";
import {
	verificationChecklistItems,
	verificationDocuments,
	verificationEvidenceRuns,
} from "../api/db/verification-schema";
import { continueAfterTestRun } from "../api/modules/missionPilot/mission-pilot-post-queue-test.service";

const repositoryIds: string[] = [];

beforeAll(() => ensureNightWorkersSchema());

afterEach(async () => {
	for (const id of repositoryIds.splice(0)) {
		await db.delete(repositories).where(eq(repositories.id, id));
	}
});

describe("Mission Pilot Test to Review transition", () => {
	it("freezes the Test snapshot and starts Review after completion_check finishes", async () => {
		const repositoryId = crypto.randomUUID();
		const taskId = crypto.randomUUID();
		const sessionId = crypto.randomUUID();
		const implementationRunId = crypto.randomUUID();
		const implementationPhaseRunId = crypto.randomUUID();
		const testRunId = crypto.randomUUID();
		const testPhaseRunId = crypto.randomUUID();
		const verificationDocumentId = crypto.randomUUID();
		const completionStartedEventId = crypto.randomUUID();
		const completionFinishedEventId = crypto.randomUUID();
		const now = new Date();
		repositoryIds.push(repositoryId);

		await db.insert(repositories).values({
			id: repositoryId,
			name: "mission-pilot-test-review-transition",
			localPath: "/tmp/mission-pilot-test-review-transition",
			branch: "main",
		});
		await db.insert(tasks).values({
			id: taskId,
			repositoryId,
			title: "Continue from Test to Review",
			status: "verifying",
		});
		await db.insert(taskRuns).values([
			{
				id: implementationRunId,
				taskId,
				repositoryId,
				status: "completed",
				startedAt: now,
				endedAt: now,
				finishedAt: now,
			},
			{
				id: testRunId,
				taskId,
				repositoryId,
				status: "completed",
				contextSnapshot: { executionMode: "test" },
				startedAt: now,
				endedAt: now,
				finishedAt: now,
			},
		]);
		await db.insert(missionPilotSessions).values({
			id: sessionId,
			taskId,
			repositoryId,
			sourceKind: "task",
			sourceId: taskId,
			desiredState: "playing",
			phase: "test_evaluating",
			initialPromptSnapshot: "verify and review",
			initialPromptState: "sent",
			activeRunId: testRunId,
			activePhaseRunId: testPhaseRunId,
			implementationCycle: 1,
			testCycle: 1,
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
			reason: "implementation_completed",
			contextJson: { execution: {} },
			digest: "ctx-1",
			tokenEstimate: 4,
			createdAt: now,
		});
		await db.insert(missionPilotPhaseRuns).values([
			{
				id: implementationPhaseRunId,
				sessionId,
				taskId,
				phase: "implementation",
				cycle: 1,
				attempt: 1,
				runId: implementationRunId,
				inputContextRevision: 1,
				inputContextDigest: "ctx-1",
				outputContextRevision: 1,
				status: "completed",
				verdict: "pass",
				evidenceJson: {},
				startedAt: now,
				finishedAt: now,
			},
			{
				id: testPhaseRunId,
				sessionId,
				taskId,
				phase: "test",
				cycle: 1,
				attempt: 1,
				runId: testRunId,
				inputContextRevision: 1,
				inputContextDigest: "ctx-1",
				status: "running",
				evidenceJson: {},
				startedAt: now,
			},
		]);
		await db.insert(verificationDocuments).values({
			id: verificationDocumentId,
			taskId,
			runId: testRunId,
			sourceSpecPath: "spec/test.md",
			documentJson: {},
			generatedAt: now,
		});
		await db.insert(verificationChecklistItems).values({
			id: crypto.randomUUID(),
			verificationDocumentId,
			taskId,
			conditionId: "AC-001",
			text: "Review starts after Test passes",
			required: true,
			status: "passed",
			evidenceIdsJson: [],
		});
		await db.insert(verificationEvidenceRuns).values({
			id: crypto.randomUUID(),
			taskId,
			runId: testRunId,
			verificationDocumentId,
			checkKind: "verify",
			command: "bun run verify",
			cwd: "/tmp/mission-pilot-test-review-transition",
			exitCode: 0,
			runner: "test",
			rawStdoutArtifactId: "stdout-artifact",
			rawStderrArtifactId: "stderr-artifact",
			summaryJson: {},
			commandLevelConditionIdsJson: ["AC-001"],
			startedAt: now,
			finishedAt: now,
		});
		await db.insert(taskEvents).values([
			{
				id: completionStartedEventId,
				taskRunId: testRunId,
				seq: 1,
				type: "info",
				eventType: "tool_call",
				message: "completion_check started",
				payloadJson: {
					runEvent: {
						type: "tool.call_started",
						data: {
							mcpTool: "completion_check",
							status: "in_progress",
						},
					},
				},
				timestamp: now,
			},
			{
				id: completionFinishedEventId,
				taskRunId: testRunId,
				seq: 2,
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
										result: {
											ok: true,
											verificationDocumentId,
										},
									},
								},
							},
						},
					},
				},
				timestamp: new Date(now.getTime() + 1_000),
			},
		]);

		const session = await db.query.missionPilotSessions.findFirst({
			where: eq(missionPilotSessions.id, sessionId),
		});
		const phaseRun = await db.query.missionPilotPhaseRuns.findFirst({
			where: eq(missionPilotPhaseRuns.id, testPhaseRunId),
		});
		if (!session || !phaseRun) throw new Error("Test fixture was not created");

		const result = await continueAfterTestRun({
			session,
			phaseRun,
			runId: testRunId,
		});

		expect(result).toMatchObject({
			kind: "start_review",
			input: { anchorRunId: implementationRunId },
		});
		const snapshot = await db.query.missionPilotTestSnapshots.findFirst({
			where: eq(missionPilotTestSnapshots.sessionId, sessionId),
		});
		expect(snapshot).toMatchObject({
			phaseRunId: testPhaseRunId,
			completionCheckEventId: completionFinishedEventId,
			verdict: "pass",
		});
		const updatedSession = await db.query.missionPilotSessions.findFirst({
			where: eq(missionPilotSessions.id, sessionId),
		});
		expect(updatedSession).toMatchObject({
			phase: "review_preparing",
			reviewCycle: 1,
			activeTestSnapshotId: snapshot?.id,
		});
	});
});
