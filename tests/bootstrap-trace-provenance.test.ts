import crypto from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { ensureNightWorkersSchema } from "../api/db/bootstrap";
import { backfillTraceProvenance } from "../api/db/bootstrap-trace-provenance";
import * as repo from "../api/modules/nightworkers/nightworkers.repository";
import { taskMessageSchema } from "../shared/schemas/nightworkers/activity-message.schema";

beforeAll(async () => {
	await ensureNightWorkersSchema();
});

describe("trace provenance bootstrap repair", () => {
	it("does not synthesize obsolete Coding Agent Questionnaire output", async () => {
		const repository = await repo.createRepository({
			name: `TEST: Trace Repair ${crypto.randomUUID()}`,
			localPath: "/Users/y.noguchi/Code/nightWorkers",
			branch: "main",
		});
		const task = await repo.createTask({
			repositoryId: repository.id,
			title: "TEST: Preserve settled planning provenance",
			status: "running",
		});
		const questionnaireSessionId = crypto.randomUUID();
		const run = await repo.createTaskRun({
			taskId: task.id,
			repositoryId: repository.id,
			status: "needs_human",
			summary: "Planning is settled.",
			finalReport: "Mission Pilotの設計判断が確定しています。",
			contextSnapshot: {
				planModeClosed: true,
			},
			endedAt: new Date(),
			finishedAt: new Date(),
		});
		const readyMessage = await repo.createTaskMessage({
			taskId: task.id,
			role: "system",
			content: "Design Questionnaireの判断が確定しました。",
			messageType: "text",
			payloadJson: {
				source: "mission_pilot",
				intent: "design_questionnaire_ready",
				questionnaireSessionId,
			},
		});

		await backfillTraceProvenance();
		await backfillTraceProvenance();

		const messages = await repo.listTaskMessages(task.id);
		expect(
			messages.find((message) => message.id === readyMessage?.id),
		).toMatchObject({
			runId: null,
			traceOwner: "mission_pilot",
			traceChannel: "pilot_thought",
		});
		const assistantMessages = messages.filter(
			(message) => message.role === "assistant" && message.runId === run.id,
		);
		expect(assistantMessages).toEqual([]);
		expect(() => taskMessageSchema.parse(messages[0])).not.toThrow();
	});
});
