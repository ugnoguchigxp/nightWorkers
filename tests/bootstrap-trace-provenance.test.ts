import crypto from "node:crypto";
import { backfillMissionPilotTraceProvenance } from "@nightworkers/mission-pilot/testing";
import { beforeAll, describe, expect, it } from "vitest";
import { ensureNightWorkersSchema } from "../api/db/bootstrap";
import { client } from "../api/db/client";
import * as repo from "../api/modules/nightworkers/nightworkers.repository";
import { codingAgentChatTrace } from "../api/modules/nightworkers/nightworkers.trace-provenance";
import {
	recordLlmUsage,
	summarizeLlmUsageForTask,
} from "../api/services/llm-usage";
import { taskMessageSchema } from "../shared/schemas/nightworkers/activity-message.schema";

beforeAll(async () => {
	await ensureNightWorkersSchema();
});

describe("trace provenance bootstrap repair", () => {
	it("moves legacy Mission Pilot Plan usage out of Coding Agent chat", async () => {
		const repository = await repo.createRepository({
			name: `TEST: Trace Usage Repair ${crypto.randomUUID()}`,
			localPath: "/Users/y.noguchi/Code/nightWorkers",
			branch: "main",
		});
		const task = await repo.createTask({
			repositoryId: repository.id,
			title: "TEST: Repair Mission Pilot Plan usage",
			status: "running",
		});
		await recordLlmUsage({
			taskId: task.id,
			callId: crypto.randomUUID(),
			provider: "codex",
			model: "gpt-5.4-mini",
			label: "specification_document",
			usage: {
				inputTokens: 100,
				cachedInputTokens: 40,
				outputTokens: 10,
				reasoningOutputTokens: 2,
				totalTokens: 110,
				mode: "measured",
			},
			durationMs: 100,
			metadataJson: {
				role: "mission_pilot",
				missionPilotSessionId: crypto.randomUUID(),
			},
			trace: codingAgentChatTrace(),
		});

		await backfillMissionPilotTraceProvenance(client);

		await expect(summarizeLlmUsageForTask(task.id)).resolves.toMatchObject({
			byOwner: {
				codingAgent: { callCount: 0, inputTokens: 0 },
				missionPilot: { callCount: 1, inputTokens: 100 },
			},
		});
	});

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

		await backfillMissionPilotTraceProvenance(client);
		await backfillMissionPilotTraceProvenance(client);

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
