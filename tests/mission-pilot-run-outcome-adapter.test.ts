import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ensureNightWorkersSchema } from "../api/db/bootstrap";
import { db } from "../api/db/client";
import {
	nativeApiTurns,
	repositories,
	taskRunCommitRecords,
	taskRuns,
	tasks,
} from "../api/db/schema";
import {
	verificationEvidenceCases,
	verificationEvidenceRuns,
} from "../api/db/verification-schema";
import {
	readMissionPilotRunChangeSummary,
	readMissionPilotRunOutcome,
	readMissionPilotRunVerification,
} from "../api/modules/missionPilot/agent/mission-pilot-run-outcome.adapter";

const repositoryIds: string[] = [];
beforeAll(() => ensureNightWorkersSchema());
afterEach(async () => {
	for (const id of repositoryIds.splice(0))
		await db.delete(repositories).where(eq(repositories.id, id));
});

describe("Mission Pilot public Run outcome", () => {
	it("preserves the last native assistant body instead of replacing it with a fixed diagnostic", async () => {
		const repositoryId = crypto.randomUUID();
		const taskId = crypto.randomUUID();
		const runId = crypto.randomUUID();
		repositoryIds.push(repositoryId);
		await db.transaction(async (tx) => {
			await tx.insert(repositories).values({
				id: repositoryId,
				name: "run outcome",
				localPath: "/tmp/run-outcome",
				branch: "main",
			});
			await tx.insert(tasks).values({
				id: taskId,
				repositoryId,
				title: "run outcome",
			});
			await tx.insert(taskRuns).values({
				id: runId,
				taskId,
				repositoryId,
				status: "failed",
				finalReport: "固定診断に置換された本文",
				finalJudgment: {
					blocker: {
						code: "provider_failure",
						message: "接続できませんでした",
					},
					verificationSummary: "検証は開始前に停止",
				},
				finishedAt: new Date(),
			});
			await tx.insert(nativeApiTurns).values({
				id: crypto.randomUUID(),
				runId,
				taskId,
				turnIndex: 1,
				status: "failed",
				historyJson: [
					{ type: "user", source: "user", content: "実装してください" },
					{ type: "assistant", content: "providerが返した元の最終本文" },
				],
				startedAt: new Date(),
				finishedAt: new Date(),
				errorJson: { kind: "transport" },
			});
			await tx.insert(nativeApiTurns).values({
				id: crypto.randomUUID(),
				runId,
				taskId,
				turnIndex: 2,
				status: "running",
				historyJson: [
					{ type: "assistant", content: "terminalではない途中本文" },
				],
				startedAt: new Date(),
			});
		});
		const outcome = await readMissionPilotRunOutcome(runId);
		expect(outcome).toMatchObject({
			finalReport: "providerが返した元の最終本文",
			blocker: { code: "provider_failure", message: "接続できませんでした" },
			verificationSummary: "検証は開始前に停止",
		});
	});

	it("exposes change and verification evidence without worker transcript", async () => {
		const repositoryId = crypto.randomUUID();
		const taskId = crypto.randomUUID();
		const runId = crypto.randomUUID();
		repositoryIds.push(repositoryId);
		await db.transaction(async (tx) => {
			await tx.insert(repositories).values({
				id: repositoryId,
				name: "run evidence",
				localPath: "/tmp/run-evidence",
				branch: "main",
			});
			await tx.insert(tasks).values({
				id: taskId,
				repositoryId,
				title: "run evidence",
			});
			await tx.insert(taskRuns).values({
				id: runId,
				taskId,
				repositoryId,
				status: "completed",
				diffPatch:
					"diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n-old\n+new\n+more",
				testResults: { summary: "unit tests passed" },
				finishedAt: new Date(),
			});
			await tx.insert(taskRunCommitRecords).values({
				runId,
				repositoryId,
				status: "committed",
				ownedCandidatePathsJson: ["src/a.ts"],
				stageableOwnedPathsJson: ["src/a.ts"],
				commitSha: "abc123",
			});
			const evidenceId = crypto.randomUUID();
			await tx.insert(verificationEvidenceRuns).values({
				id: evidenceId,
				taskId,
				runId,
				verificationDocumentId: null,
				checkKind: "unit",
				command: "bun test",
				cwd: "/tmp/run-evidence",
				exitCode: 0,
				runner: "vitest",
				rawStdoutArtifactId: "stdout-1",
				rawStderrArtifactId: "stderr-1",
				parsedArtifactId: "parsed-1",
				summaryJson: { passed: 4 },
				commandLevelConditionIdsJson: [],
				startedAt: new Date(1000),
				finishedAt: new Date(2500),
			});
			await tx.insert(verificationEvidenceCases).values({
				evidenceRunId: evidenceId,
				verificationDocumentId: null,
				conditionIdsJson: [],
				name: "does work",
				status: "passed",
				durationMs: 10,
			});
		});

		expect(await readMissionPilotRunChangeSummary(runId)).toMatchObject({
			changedFiles: ["src/a.ts"],
			additions: 2,
			deletions: 1,
			gitStatus: "committed",
			commitSha: "abc123",
		});
		const verification = await readMissionPilotRunVerification(runId);
		expect(verification).toMatchObject({
			verificationSummary: "unit tests passed",
			commands: [
				{
					command: "bun test",
					exitCode: 0,
					durationMs: 1000,
					testCounts: { passed: 1 },
				},
			],
			page: { total: 1, nextCursor: null },
		});
		expect(JSON.stringify(verification)).not.toContain("historyJson");
	});
});
