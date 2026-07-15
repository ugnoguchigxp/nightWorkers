import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ensureNightWorkersSchema } from "../api/db/bootstrap";
import { db } from "../api/db/client";
import {
	nativeApiTurns,
	repositories,
	taskRuns,
	tasks,
} from "../api/db/schema";
import { readMissionPilotRunOutcome } from "../api/modules/missionPilot/agent/mission-pilot-run-outcome.adapter";

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
});
