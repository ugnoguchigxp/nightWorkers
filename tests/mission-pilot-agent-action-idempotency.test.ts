import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ensureNightWorkersSchema } from "../api/db/bootstrap";
import { db } from "../api/db/client";
import {
	missionPilotAgentTurns,
	missionPilotToolCalls,
} from "../api/db/mission-pilot-agent-schema";
import { repositories, taskMessages, tasks } from "../api/db/schema";
import {
	claimMissionPilotActionExecution,
	completeMissionPilotActionExecution,
	createMissionPilotActionExecutionIntent,
	MissionPilotActionExecutionConflictError,
	reconcileMissionPilotActionExecutionReceipts,
} from "../api/modules/missionPilot/agent/mission-pilot-action-execution.repository";
import { createSession } from "../api/modules/missionPilot/mission-pilot.repository";

const repositoryIds: string[] = [];
let nextTurnIndex = 1;

beforeAll(() => ensureNightWorkersSchema());
afterEach(async () => {
	for (const repositoryId of repositoryIds.splice(0))
		await db.delete(repositories).where(eq(repositories.id, repositoryId));
});

async function fixture() {
	const repositoryId = crypto.randomUUID();
	const taskId = crypto.randomUUID();
	repositoryIds.push(repositoryId);
	const session = await db.transaction(async (tx) => {
		await tx.insert(repositories).values({
			id: repositoryId,
			name: "receipt fixture",
			localPath: "/tmp/receipt-fixture",
			branch: "main",
		});
		const [task] = await tx
			.insert(tasks)
			.values({
				id: taskId,
				repositoryId,
				title: "receipt fixture",
				objective: "receipt",
			})
			.returning();
		return createSession(
			{ task, sourceKind: "task", sourceId: task.id, runtimeKind: "agent" },
			tx,
		);
	});
	return { taskId, sessionId: session.id };
}

async function addToolCall(sessionId: string, toolCallId: string) {
	const turnId = crypto.randomUUID();
	const now = new Date();
	await db.insert(missionPilotAgentTurns).values({
		id: turnId,
		sessionId,
		turnIndex: nextTurnIndex++,
		status: "running",
		startedAt: now,
	});
	await db.insert(missionPilotToolCalls).values({
		id: toolCallId,
		sessionId,
		turnId,
		providerCallId: toolCallId,
		actionId: "test",
		argumentsJson: {},
		idempotencyKey: `${sessionId}:${toolCallId}`,
		expectedTaskRevision: 1,
		createdAt: now,
		updatedAt: now,
	});
}

describe("Mission Pilot durable action receipts", () => {
	it("deduplicates the same intent and rejects argument reuse", async () => {
		const { taskId, sessionId } = await fixture();
		const input = {
			sessionId,
			taskId,
			toolCallId: crypto.randomUUID(),
			actionId: "run.implementation.start",
			idempotencyKey: `${sessionId}:run-1`,
			arguments: { request: "first" },
			expectedTaskRevision: 1,
		};
		await addToolCall(sessionId, input.toolCallId);
		const first = await createMissionPilotActionExecutionIntent(input);
		const same = await createMissionPilotActionExecutionIntent(input);
		expect(same.id).toBe(first.id);
		await expect(
			createMissionPilotActionExecutionIntent({
				...input,
				arguments: { request: "different" },
			}),
		).rejects.toBeInstanceOf(MissionPilotActionExecutionConflictError);
	});

	it("uses a CAS transition and stores the terminal result", async () => {
		const { taskId, sessionId } = await fixture();
		const toolCallId = crypto.randomUUID();
		await addToolCall(sessionId, toolCallId);
		const receipt = await createMissionPilotActionExecutionIntent({
			sessionId,
			taskId,
			toolCallId,
			actionId: "task.message.send",
			idempotencyKey: `${sessionId}:message-1`,
			arguments: { content: "hello" },
			expectedTaskRevision: 1,
		});
		expect(await claimMissionPilotActionExecution(receipt.id)).toMatchObject({
			status: "executing",
		});
		const completed = await completeMissionPilotActionExecution({
			id: receipt.id,
			result: { messageId: "message-1" },
		});
		expect(completed?.status).toBe("succeeded");
		expect(await claimMissionPilotActionExecution(receipt.id)).toBeNull();
	});

	it("reconciles a message created immediately before process loss and blocks an equivalent duplicate", async () => {
		const { taskId, sessionId } = await fixture();
		const toolCallId = crypto.randomUUID();
		const idempotencyKey = `${sessionId}:message-crash`;
		await addToolCall(sessionId, toolCallId);
		const receipt = await createMissionPilotActionExecutionIntent({
			sessionId,
			taskId,
			toolCallId,
			actionId: "task.message.send",
			idempotencyKey,
			arguments: { content: "crash-safe" },
			expectedTaskRevision: 1,
		});
		await claimMissionPilotActionExecution(receipt.id);
		const [message] = await db
			.insert(taskMessages)
			.values({
				taskId,
				role: "user",
				content: "crash-safe",
				messageType: "text",
				metadataJson: {
					missionPilotAction: { idempotencyKey, toolCallId },
				},
			})
			.returning();

		const [reconciled] =
			await reconcileMissionPilotActionExecutionReceipts(sessionId);
		expect(reconciled).toMatchObject({
			id: receipt.id,
			status: "succeeded",
			sourceResourceType: "task_message",
			sourceResourceId: message?.id,
		});

		const retryToolCallId = crypto.randomUUID();
		await addToolCall(sessionId, retryToolCallId);
		const equivalent = await createMissionPilotActionExecutionIntent({
			sessionId,
			taskId,
			toolCallId: retryToolCallId,
			actionId: "task.message.send",
			idempotencyKey: `${sessionId}:message-retry`,
			arguments: { content: "crash-safe" },
			expectedTaskRevision: 1,
		});
		expect(equivalent.id).toBe(receipt.id);
	});
});
