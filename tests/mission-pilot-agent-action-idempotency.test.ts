import crypto from "node:crypto";
import {
	createSession,
	missionPilotActionExecutions,
	missionPilotAgentTurns,
	missionPilotToolCalls,
} from "@nightworkers/mission-pilot/backend";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ensureNightWorkersSchema } from "../api/db/bootstrap";
import { db } from "../api/db/client";
import {
	designQuestionnaireReviews,
	designQuestionnaireSessions,
} from "../api/db/design-questionnaire-schema";
import {
	repositories,
	taskMessages,
	taskOperatorCommandReceipts,
	tasks,
} from "../api/db/schema";
import {
	claimMissionPilotActionExecution,
	completeMissionPilotActionExecution,
	createMissionPilotActionExecutionIntent,
	MissionPilotActionExecutionConflictError,
	reconcileMissionPilotActionExecutionReceipts,
} from "../api/modules/missionPilot/agent/mission-pilot-action-execution.repository";
import { claimAgentPlay } from "../api/modules/missionPilot/agent/mission-pilot-agent-session.repository";
import {
	claimMissionPilotAgentTurn,
	claimMissionPilotToolCall,
	persistMissionPilotProviderTurn,
} from "../api/modules/missionPilot/agent/mission-pilot-conversation.repository";
import { missionPilotTaskActionPort } from "../api/modules/missionPilot/agent/mission-pilot-task-action.adapter";
import * as nightworkersService from "../api/modules/nightworkers/nightworkers.service";

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
	return { taskId, sessionId: session.id, sessionVersion: session.version };
}

async function addToolCall(
	sessionId: string,
	toolCallId: string,
	input: { actionId?: string; argumentsJson?: unknown } = {},
) {
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
		actionId: input.actionId ?? "test",
		argumentsJson: input.argumentsJson ?? {},
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

	it("does not deduplicate the same action arguments across Task revisions", async () => {
		const { taskId, sessionId } = await fixture();
		const firstToolCallId = crypto.randomUUID();
		const secondToolCallId = crypto.randomUUID();
		await addToolCall(sessionId, firstToolCallId);
		await addToolCall(sessionId, secondToolCallId);
		const first = await createMissionPilotActionExecutionIntent({
			sessionId,
			taskId,
			toolCallId: firstToolCallId,
			actionId: "task.message.send",
			idempotencyKey: `${sessionId}:revision-1`,
			arguments: { content: "same arguments" },
			expectedTaskRevision: 1,
		});
		const second = await createMissionPilotActionExecutionIntent({
			sessionId,
			taskId,
			toolCallId: secondToolCallId,
			actionId: "task.message.send",
			idempotencyKey: `${sessionId}:revision-2`,
			arguments: { content: "same arguments" },
			expectedTaskRevision: 2,
		});
		expect(second.id).not.toBe(first.id);
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
				role: "assistant",
				content: "crash-safe",
				messageType: "text",
				metadataJson: {
					missionPilotAction: { idempotencyKey, toolCallId },
				},
			})
			.returning();
		await db.insert(taskOperatorCommandReceipts).values({
			actorKind: "delegated_user",
			actorId: sessionId,
			taskId,
			actionId: "task.message.send",
			idempotencyKey,
			argumentsDigest: "test-command-digest",
			status: "succeeded",
			resultJson: message,
		});

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

	it("reconciles an accepted Questionnaire review committed before receipt completion", async () => {
		const { taskId, sessionId } = await fixture();
		const questionnaireSessionId = crypto.randomUUID();
		const toolCallId = crypto.randomUUID();
		const idempotencyKey = `${sessionId}:questionnaire-review-accept`;
		const argumentsJson = { questionnaireSessionId };
		await addToolCall(sessionId, toolCallId, {
			actionId: "questionnaire.review.accept",
			argumentsJson,
		});
		const receipt = await createMissionPilotActionExecutionIntent({
			sessionId,
			taskId,
			toolCallId,
			actionId: "questionnaire.review.accept",
			idempotencyKey,
			arguments: argumentsJson,
			expectedTaskRevision: 1,
		});
		await claimMissionPilotActionExecution(receipt.id);
		const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId));
		if (!task) throw new Error("task fixture is missing");
		await db.insert(designQuestionnaireSessions).values({
			id: questionnaireSessionId,
			taskId,
			repositoryId: task.repositoryId,
			status: "accepted",
		});
		const [message] = await db
			.insert(taskMessages)
			.values({
				taskId,
				role: "assistant",
				content: "Questionnaire review accepted",
				messageType: "markdown_document",
				metadataJson: {
					missionPilotAction: {
						idempotencyKey,
						toolCallId,
					},
				},
			})
			.returning();
		await db.insert(designQuestionnaireReviews).values({
			id: crypto.randomUUID(),
			sessionId: questionnaireSessionId,
			status: "accepted",
			publishedMessageId: message?.id ?? null,
		});
		await db.insert(taskOperatorCommandReceipts).values({
			actorKind: "delegated_user",
			actorId: sessionId,
			taskId,
			actionId: "questionnaire.review.accept",
			idempotencyKey,
			argumentsDigest: "test-command-digest",
			status: "succeeded",
			resultJson: {
				id: questionnaireSessionId,
				status: "accepted",
			},
		});

		const [reconciled] =
			await reconcileMissionPilotActionExecutionReceipts(sessionId);
		expect(reconciled).toMatchObject({
			id: receipt.id,
			status: "succeeded",
			sourceResourceType: "questionnaire",
			sourceResourceId: questionnaireSessionId,
		});
	});

	it("returns an interrupted Mission Pilot receipt to pending when delivery never started", async () => {
		const { taskId, sessionId } = await fixture();
		const toolCallId = crypto.randomUUID();
		await addToolCall(sessionId, toolCallId);
		const receipt = await createMissionPilotActionExecutionIntent({
			sessionId,
			taskId,
			toolCallId,
			actionId: "task.message.send",
			idempotencyKey: `${sessionId}:not-delivered`,
			arguments: { content: "safe to retry" },
			expectedTaskRevision: 1,
		});
		await claimMissionPilotActionExecution(receipt.id);

		const [reconciled] =
			await reconcileMissionPilotActionExecutionReceipts(sessionId);
		expect(reconciled).toMatchObject({
			id: receipt.id,
			status: "pending",
			startedAt: null,
			failureJson: null,
		});
	});

	it("persists a typed application rejection as failed instead of outcome_unknown", async () => {
		const state = await fixture();
		const playing = await claimAgentPlay(state.taskId, state.sessionVersion);
		if (!playing) throw new Error("agent fixture did not start");
		const leaseOwner = `typed-rejection:${crypto.randomUUID()}`;
		const turn = await claimMissionPilotAgentTurn({
			sessionId: state.sessionId,
			leaseOwner,
		});
		if (!turn) throw new Error("agent turn was not claimed");
		const [task] = await db
			.select()
			.from(tasks)
			.where(eq(tasks.id, state.taskId));
		if (!task) throw new Error("task fixture is missing");
		const argumentsJson = {};
		const [call] =
			(await persistMissionPilotProviderTurn({
				sessionId: state.sessionId,
				turnId: turn.turnId,
				leaseOwner,
				content: "完了前のTaskをarchiveします。",
				toolCalls: [
					{
						id: "archive-before-complete",
						name: "execute_task_action",
						arguments: {
							actionId: "task.archive",
							expectedTaskRevision: task.revision,
							idempotencyKey: `${state.sessionId}:archive-before-complete`,
							arguments: {},
						},
					},
				],
			})) ?? [];
		if (!call) throw new Error("tool call was not persisted");
		const running = await claimMissionPilotToolCall({
			id: call.id,
			leaseOwner,
		});
		if (!running) throw new Error("tool call was not claimed");

		const result = await missionPilotTaskActionPort.execute({
			toolCallId: running.id,
			leaseOwner,
			taskId: state.taskId,
			sessionId: state.sessionId,
			actionId: running.actionId,
			arguments: argumentsJson,
			expectedTaskRevision: task.revision,
			idempotencyKey: running.idempotencyKey,
			signal: new AbortController().signal,
		});

		expect(result).toMatchObject({
			ok: false,
			failure: {
				kind: "domain_precondition",
				providerCode: "TASK_OPERATOR_COMMAND_UNAVAILABLE",
			},
		});
		const [receipt] = await db
			.select()
			.from(missionPilotActionExecutions)
			.where(eq(missionPilotActionExecutions.toolCallId, running.id));
		expect(receipt).toMatchObject({
			status: "failed",
			failureJson: { kind: "domain_precondition" },
		});
	});

	it("persists task.message.send in the Pilot Thought trace channel", async () => {
		const state = await fixture();
		const playing = await claimAgentPlay(state.taskId, state.sessionVersion);
		if (!playing) throw new Error("agent fixture did not start");
		const leaseOwner = `visible-message:${crypto.randomUUID()}`;
		const turn = await claimMissionPilotAgentTurn({
			sessionId: state.sessionId,
			leaseOwner,
		});
		if (!turn) throw new Error("agent turn was not claimed");
		const [task] = await db
			.select()
			.from(tasks)
			.where(eq(tasks.id, state.taskId));
		if (!task) throw new Error("task fixture is missing");
		const argumentsJson = {
			content: "ユーザーへ確認したいことがあります。",
		};
		const [call] =
			(await persistMissionPilotProviderTurn({
				sessionId: state.sessionId,
				turnId: turn.turnId,
				leaseOwner,
				content: "確認事項をユーザーへ送信します。",
				toolCalls: [
					{
						id: "visible-message",
						name: "execute_task_action",
						arguments: {
							actionId: "task.message.send",
							expectedTaskRevision: task.revision,
							idempotencyKey: `${state.sessionId}:visible-message`,
							arguments: {
								content: argumentsJson.content,
							},
						},
					},
				],
			})) ?? [];
		if (!call) throw new Error("tool call was not persisted");
		const running = await claimMissionPilotToolCall({
			id: call.id,
			leaseOwner,
		});
		if (!running) throw new Error("tool call was not claimed");

		const result = await missionPilotTaskActionPort.execute({
			toolCallId: running.id,
			leaseOwner,
			taskId: state.taskId,
			sessionId: state.sessionId,
			actionId: running.actionId,
			arguments: argumentsJson,
			expectedTaskRevision: task.revision,
			idempotencyKey: running.idempotencyKey,
			signal: new AbortController().signal,
		});

		expect(result).toMatchObject({ ok: true });
		const [message] = await db
			.select()
			.from(taskMessages)
			.where(eq(taskMessages.taskId, state.taskId))
			.orderBy(taskMessages.createdAt);
		expect(message).toMatchObject({
			content: "ユーザーへ確認したいことがあります。",
			traceOwner: "mission_pilot",
			traceChannel: "pilot_thought",
		});
	});

	it("enforces the expected Task revision inside the shared update command", async () => {
		const state = await fixture();
		const [before] = await db
			.select()
			.from(tasks)
			.where(eq(tasks.id, state.taskId));
		if (!before) throw new Error("task fixture is missing");
		await db
			.update(tasks)
			.set({
				revision: before.revision + 1,
				updatedAt: new Date(before.updatedAt.getTime() + 1_000),
			})
			.where(eq(tasks.id, state.taskId));

		await expect(
			nightworkersService.updateTask(
				state.taskId,
				{ title: "must not overwrite a newer Task" },
				{ expectedRevision: before.revision },
			),
		).rejects.toMatchObject({
			code: "TASK_REVISION_CONFLICT",
			statusCode: 409,
		});
		const [after] = await db
			.select()
			.from(tasks)
			.where(eq(tasks.id, state.taskId));
		expect(after?.title).toBe("receipt fixture");
	});

	it("stores Mission Pilot visible messages as assistant messages", async () => {
		const state = await fixture();
		const message = await nightworkersService.appendAssistantTaskMessage(
			state.taskId,
			"ユーザーへ確認したいことがあります。",
			{
				source: "mission_pilot",
				missionPilotAction: { idempotencyKey: "visible-message" },
			},
		);
		expect(message).toMatchObject({
			role: "assistant",
			content: "ユーザーへ確認したいことがあります。",
			metadataJson: { source: "mission_pilot" },
		});
	});
});
