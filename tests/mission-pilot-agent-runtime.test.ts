import crypto from "node:crypto";
import "./helpers/mission-pilot-runtime";
import {
	createSession,
	missionPilotAgentSessions,
	missionPilotSessions,
	missionPilotToolCalls,
} from "@nightworkers/mission-pilot/backend";
import type { MissionPilotTaskReadPort } from "@nightworkers/mission-pilot/testing";
import {
	appendMissionPilotTaskEvent,
	appendMissionPilotUserMessage,
	cancelPendingMissionPilotToolCalls,
	cancelRunningMissionPilotToolCalls,
	claimAgentPlay,
	claimMissionPilotAgentTurn,
	claimMissionPilotToolCall,
	getMissionPilotExecution,
	listMissionPilotConversation,
	missionPilotTaskReadPort,
	persistMissionPilotProviderTurn,
	reconcileInterruptedMissionPilotAgentSessions,
	runMissionPilotAgentWake,
	seedMissionPilotConversation,
	stopMissionPilotAgentRuntime,
} from "@nightworkers/mission-pilot/testing";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ensureNightWorkersSchema } from "../api/db/bootstrap";
import { db } from "../api/db/client";
import {
	activityEvents,
	llmUsageRecords,
	repositories,
	tasks,
} from "../api/db/schema";
import {
	bindSystemContextCatalogSnapshot,
	systemContextPromptAudit,
} from "../api/systemContexts/catalog";

const repositoryIds: string[] = [];
beforeAll(() => ensureNightWorkersSchema());
afterEach(async () => {
	for (const id of repositoryIds.splice(0))
		await db.delete(repositories).where(eq(repositories.id, id));
});

async function fixture() {
	const repositoryId = crypto.randomUUID();
	const taskId = crypto.randomUUID();
	repositoryIds.push(repositoryId);
	const session = await db.transaction(async (tx) => {
		await tx.insert(repositories).values({
			id: repositoryId,
			name: "agent runtime",
			localPath: "/tmp/agent-runtime",
			branch: "main",
		});
		const [task] = await tx
			.insert(tasks)
			.values({
				id: taskId,
				repositoryId,
				title: "agent runtime",
				objective: "永続sessionを検証する",
			})
			.returning();
		return createSession(
			{ task, sourceKind: "task", sourceId: task.id, runtimeKind: "agent" },
			tx,
		);
	});
	const claimed = await claimAgentPlay(taskId, session.version);
	if (!claimed) throw new Error("agent session was not claimed");
	await seedMissionPilotConversation({
		sessionId: claimed.id,
		systemContext: "System Context",
		initialPrompt: claimed.initialPromptSnapshot,
	});
	await appendMissionPilotTaskEvent({
		taskId,
		eventType: "mission_pilot.resume_requested",
		sourceEventId: "runtime-test",
		taskRevision: 1,
		payload: { reason: "test" },
	});
	return { taskId, sessionId: claimed.id, publicVersion: claimed.version };
}

const readPort: MissionPilotTaskReadPort = missionPilotTaskReadPort;

describe("Mission Pilot persistent agent runtime", () => {
	it("keeps an assistant-only turn as waiting and preserves the same logical session", async () => {
		const fixtureState = await fixture();
		const requestId = crypto.randomUUID();
		const result = await runMissionPilotAgentWake(
			{ sessionId: fixtureState.sessionId },
			{
				readPort,
				provider: {
					nextTurn: async (input) => {
						const request = bindSystemContextCatalogSnapshot(
							input.systemContextBinding,
						);
						const invocation = request.invoke(
							"providerExecution.system-prompt",
							{ systemPrompt: input.systemContext },
						);
						return {
							type: "supported",
							content: "現在のFactを確認しました。",
							toolCalls: [],
							usage: usage(),
							requestId,
							systemContextAudit: [
								systemContextPromptAudit("system", request, invocation),
							],
						};
					},
				},
			},
		);
		expect(result).toMatchObject({
			kind: "waiting",
			content: "現在のFactを確認しました。",
		});
		const items = await import("@nightworkers/mission-pilot/testing").then(
			(module) => module.listMissionPilotConversation(fixtureState.sessionId),
		);
		expect(items.map((item) => item.kind)).toEqual(
			expect.arrayContaining([
				"system_context",
				"user",
				"task_event",
				"assistant",
			]),
		);
		const [session] = await db
			.select({
				version: missionPilotSessions.version,
				phase: missionPilotSessions.phase,
			})
			.from(missionPilotSessions)
			.where(eq(missionPilotSessions.id, fixtureState.sessionId));
		expect(session?.version).toBe(fixtureState.publicVersion + 1);
		expect(session?.phase).toBe("paused");
		const [usageRecord] = await db
			.select()
			.from(llmUsageRecords)
			.where(eq(llmUsageRecords.taskId, fixtureState.taskId));
		expect(usageRecord).toMatchObject({
			callId: requestId,
			label: "mission_pilot_agent",
			traceOwner: "mission_pilot",
			traceChannel: "pilot_thought",
			metadataJson: {
				systemContextAudit: [
					expect.objectContaining({
						manifest: expect.objectContaining({
							key: "providerExecution.system-prompt",
						}),
					}),
				],
			},
		});
		const usageActivity = await db
			.select()
			.from(activityEvents)
			.where(eq(activityEvents.externalId, usageRecord?.id ?? ""));
		expect(usageActivity[0]).toMatchObject({
			kind: "llm.usage",
			traceOwner: "mission_pilot",
			traceChannel: "pilot_thought",
		});
		const execution = await getMissionPilotExecution(fixtureState.sessionId);
		expect(execution.entries).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					kind: "thought",
					summary: "現在のFactを確認しました。",
				}),
			]),
		);
	});

	it("preserves the provider response when usage persistence fails", async () => {
		const fixtureState = await fixture();
		const result = await runMissionPilotAgentWake(
			{ sessionId: fixtureState.sessionId },
			{
				readPort,
				provider: {
					nextTurn: async () => ({
						type: "supported",
						content: "Usage保存に失敗しても、この判断本文は保持します。",
						toolCalls: [],
						usage: usage(),
					}),
				},
				recordProviderUsage: async () => {
					throw new Error("usage database unavailable");
				},
			},
		);

		expect(result).toMatchObject({
			kind: "waiting",
			content: "Usage保存に失敗しても、この判断本文は保持します。",
		});
		expect(
			(await listMissionPilotConversation(fixtureState.sessionId)).some(
				(item) =>
					item.kind === "assistant" &&
					(item.bodyJson as { content?: string }).content ===
						"Usage保存に失敗しても、この判断本文は保持します。",
			),
		).toBe(true);
	});

	it("records tool results without importing worker transcript into the conversation", async () => {
		const fixtureState = await fixture();
		const bindings: unknown[] = [];
		const result = await runMissionPilotAgentWake(
			{ sessionId: fixtureState.sessionId },
			{
				readPort,
				provider: {
					nextTurn: async ({ messages, systemContextBinding }) => {
						bindings.push(systemContextBinding);
						return messages.some((message) => message.role === "tool")
							? {
									type: "supported",
									content: "Factを受け取りました。",
									toolCalls: [],
									usage: usage(),
								}
							: {
									type: "supported",
									content: "Task Factを取得します。",
									toolCalls: [
										{
											id: "read-1",
											name: "read_task_operator_view",
											arguments: {},
										},
									],
									usage: usage(),
								};
					},
				},
			},
		);
		expect(result).toMatchObject({ kind: "waiting" });
		const items = await import("@nightworkers/mission-pilot/testing").then(
			(module) => module.listMissionPilotConversation(fixtureState.sessionId),
		);
		const serialized = JSON.stringify(items);
		expect(serialized).not.toContain("nativeApiTurns");
		expect(items.some((item) => item.kind === "tool_result")).toBe(true);
		expect(bindings).toHaveLength(2);
		expect(bindings[1]).toBe(bindings[0]);
	});

	it("executes a claimed Task action once and never reclaims its terminal call", async () => {
		const fixtureState = await fixture();
		let providerCalls = 0;
		const [before] = await db
			.select()
			.from(tasks)
			.where(eq(tasks.id, fixtureState.taskId));
		if (!before) throw new Error("task fixture is missing");
		const result = await runMissionPilotAgentWake(
			{ sessionId: fixtureState.sessionId },
			{
				readPort,
				provider: {
					nextTurn: async () => {
						providerCalls += 1;
						return providerCalls > 2
							? {
									type: "supported",
									content: "Task更新を確認しました。",
									toolCalls: [],
									usage: usage(),
								}
							: {
									type: "supported",
									content: "Task名を更新します。",
									toolCalls: [
										{
											id: "task-update-1",
											name: "execute_task_action",
											arguments: {
												actionId: "task.update",
												expectedTaskRevision: before.revision,
												idempotencyKey: "runtime-task-update",
												arguments: {
													fields: { title: "updated by persistent agent" },
												},
											},
										},
									],
									usage: usage(),
								};
					},
				},
			},
		);
		expect(result).toMatchObject({ kind: "waiting" });
		const [updated] = await db
			.select()
			.from(tasks)
			.where(eq(tasks.id, fixtureState.taskId));
		expect(updated?.title).toBe("updated by persistent agent");
		const toolCalls = await db
			.select()
			.from(missionPilotToolCalls)
			.where(eq(missionPilotToolCalls.sessionId, fixtureState.sessionId));
		expect(toolCalls).toHaveLength(1);
		const [toolCall] = toolCalls;
		expect(toolCall?.status).toBe("succeeded");
		const items = await listMissionPilotConversation(fixtureState.sessionId);
		expect(
			items.filter(
				(item) =>
					item.kind === "tool_result" && item.toolCallId === toolCall?.id,
			),
		).toHaveLength(2);
		expect(
			await claimMissionPilotToolCall({
				id: toolCall?.id ?? "missing",
				leaseOwner: "replay-attempt",
			}),
		).toBeNull();
	});

	it("continues after replaying a succeeded event-driven action receipt", async () => {
		const fixtureState = await fixture();
		let providerCalls = 0;
		const result = await runMissionPilotAgentWake(
			{ sessionId: fixtureState.sessionId },
			{
				readPort,
				provider: {
					nextTurn: async () => {
						providerCalls += 1;
						return providerCalls === 1
							? {
									type: "supported",
									content: "停止済みRunのreceiptを確認します。",
									toolCalls: [
										{
											id: "replayed-run-stop",
											name: "execute_task_action",
											arguments: {
												actionId: "run.stop",
												expectedTaskRevision: 1,
												idempotencyKey: "replayed-run-stop",
												arguments: { runId: crypto.randomUUID() },
											},
										},
									],
									usage: usage(),
								}
							: {
									type: "supported",
									content: "既存結果を確認して次の判断へ進みます。",
									toolCalls: [],
									usage: usage(),
								};
					},
				},
				actionPort: {
					execute: async (input) => ({
						ok: true,
						actionId: input.actionId,
						data: { status: "cancelled" },
						replayed: true,
					}),
				},
			},
		);

		expect(providerCalls).toBe(2);
		expect(result).toMatchObject({
			kind: "waiting",
			content: "既存結果を確認して次の判断へ進みます。",
		});
	});

	it("continues after a fresh run.stop result without waiting for a terminal event", async () => {
		const fixtureState = await fixture();
		let providerCalls = 0;
		const result = await runMissionPilotAgentWake(
			{ sessionId: fixtureState.sessionId },
			{
				readPort,
				provider: {
					nextTurn: async () => {
						providerCalls += 1;
						return providerCalls === 1
							? {
									type: "supported",
									content: "停止結果を確認します。",
									toolCalls: [
										{
											id: "fresh-run-stop",
											name: "execute_task_action",
											arguments: {
												actionId: "run.stop",
												expectedTaskRevision: 1,
												idempotencyKey: "fresh-run-stop",
												arguments: { runId: crypto.randomUUID() },
											},
										},
									],
									usage: usage(),
								}
							: {
									type: "supported",
									content: "停止結果を踏まえて次の判断へ進みます。",
									toolCalls: [],
									usage: usage(),
								};
					},
				},
				actionPort: {
					execute: async (input) => ({
						ok: true,
						actionId: input.actionId,
						data: { status: "cancelled" },
						replayed: false,
					}),
				},
			},
		);

		expect(providerCalls).toBe(2);
		expect(result).toMatchObject({
			kind: "waiting",
			content: "停止結果を踏まえて次の判断へ進みます。",
		});
	});

	it("closes pending tool calls with a persisted result when an expired turn is reconciled", async () => {
		const fixtureState = await fixture();
		const leaseOwner = "expired-runtime";
		const turn = await claimMissionPilotAgentTurn({
			sessionId: fixtureState.sessionId,
			leaseOwner,
		});
		if (!turn) throw new Error("agent turn was not claimed");
		const [task] = await db
			.select()
			.from(tasks)
			.where(eq(tasks.id, fixtureState.taskId));
		if (!task) throw new Error("task fixture is missing");
		await persistMissionPilotProviderTurn({
			sessionId: fixtureState.sessionId,
			turnId: turn.turnId,
			leaseOwner,
			content: "Task名を更新します。",
			toolCalls: [
				{
					id: "pending-before-crash",
					name: "execute_task_action",
					arguments: {
						actionId: "task.update",
						expectedTaskRevision: task.revision,
						idempotencyKey: "pending-before-crash",
						arguments: { fields: { title: "must not be applied" } },
					},
				},
			],
		});
		await db
			.update(missionPilotAgentSessions)
			.set({ leaseExpiresAt: new Date(0) })
			.where(eq(missionPilotAgentSessions.sessionId, fixtureState.sessionId));

		await reconcileInterruptedMissionPilotAgentSessions(new Date());

		const [toolCall] = await db
			.select()
			.from(missionPilotToolCalls)
			.where(eq(missionPilotToolCalls.sessionId, fixtureState.sessionId));
		expect(toolCall).toMatchObject({
			status: "failed",
			failureJson: { kind: "domain_precondition" },
		});
		const items = await listMissionPilotConversation(fixtureState.sessionId);
		expect(
			items.some(
				(item) =>
					item.kind === "tool_result" && item.toolCallId === toolCall?.id,
			),
		).toBe(true);
		const [unchanged] = await db
			.select()
			.from(tasks)
			.where(eq(tasks.id, fixtureState.taskId));
		expect(unchanged?.title).toBe("agent runtime");
	});

	it("does not mark a running tool cancelled until runtime quiescence is confirmed", async () => {
		const fixtureState = await fixture();
		const leaseOwner = "running-tool-stop";
		const turn = await claimMissionPilotAgentTurn({
			sessionId: fixtureState.sessionId,
			leaseOwner,
		});
		if (!turn) throw new Error("agent turn was not claimed");
		const [task] = await db
			.select()
			.from(tasks)
			.where(eq(tasks.id, fixtureState.taskId));
		if (!task) throw new Error("task fixture is missing");
		const [call] =
			(await persistMissionPilotProviderTurn({
				sessionId: fixtureState.sessionId,
				turnId: turn.turnId,
				leaseOwner,
				content: "Task名を更新します。",
				toolCalls: [
					{
						id: "running-before-stop",
						name: "execute_task_action",
						arguments: {
							actionId: "task.update",
							expectedTaskRevision: task.revision,
							idempotencyKey: "running-before-stop",
							arguments: { fields: { title: "must not be applied" } },
						},
					},
				],
			})) ?? [];
		if (!call) throw new Error("tool call was not persisted");
		if (!(await claimMissionPilotToolCall({ id: call.id, leaseOwner })))
			throw new Error("tool call was not claimed");

		expect(
			await cancelPendingMissionPilotToolCalls(fixtureState.sessionId),
		).toBe(0);
		expect(
			(
				await db
					.select()
					.from(missionPilotToolCalls)
					.where(eq(missionPilotToolCalls.id, call.id))
			)[0],
		).toMatchObject({ status: "running" });

		expect(
			await cancelRunningMissionPilotToolCalls(fixtureState.sessionId),
		).toBe(1);
		expect(
			(
				await db
					.select()
					.from(missionPilotToolCalls)
					.where(eq(missionPilotToolCalls.id, call.id))
			)[0],
		).toMatchObject({ status: "cancelled" });
	});

	it("projects the latest compaction summary without deleting canonical conversation", async () => {
		const fixtureState = await fixture();
		const canonicalContent = `永続conversation:${"x".repeat(160_000)}`;
		await appendMissionPilotUserMessage({
			sessionId: fixtureState.sessionId,
			content: canonicalContent,
		});
		let compactionCalls = 0;
		let regularCalls = 0;
		const result = await runMissionPilotAgentWake(
			{ sessionId: fixtureState.sessionId },
			{
				readPort,
				compactionTokenBudget: 5_000,
				maxProviderCallsPerWake: 4,
				provider: {
					nextTurn: async ({ tools }) => {
						if (tools.length === 0) {
							compactionCalls += 1;
							return {
								type: "supported",
								content:
									"ユーザー依頼と未解決事項を保持したcompaction summary。",
								toolCalls: [],
								usage: usage(),
							};
						}
						regularCalls += 1;
						return {
							type: "supported",
							content: "summaryから判断を継続しました。",
							toolCalls: [],
							usage: usage(),
						};
					},
				},
			},
		);
		expect(result).toMatchObject({ kind: "waiting" });
		expect({ compactionCalls, regularCalls }).toEqual({
			compactionCalls: 1,
			regularCalls: 1,
		});
		const canonical = await listMissionPilotConversation(
			fixtureState.sessionId,
		);
		expect(
			canonical.some(
				(item) =>
					item.kind === "user" &&
					JSON.stringify(item.bodyJson).includes(
						canonicalContent.slice(0, 100),
					),
			),
		).toBe(true);
		expect(canonical.some((item) => item.kind === "compaction_summary")).toBe(
			true,
		);
	});

	it("stops a hung provider call at the wake elapsed-time budget", async () => {
		const fixtureState = await fixture();
		const result = await runMissionPilotAgentWake(
			{ sessionId: fixtureState.sessionId },
			{
				readPort,
				maxElapsedMsPerWake: 10,
				provider: {
					nextTurn: ({ signal }) =>
						new Promise<never>((_, reject) => {
							signal.addEventListener("abort", () => reject(signal.reason), {
								once: true,
							});
						}),
				},
			},
		);
		expect(result).toMatchObject({
			kind: "attention",
			failure: { kind: "resource_limit" },
		});
	});

	it("propagates a user stop without discarding a completed Task action outcome", async () => {
		const fixtureState = await fixture();
		const [task] = await db
			.select()
			.from(tasks)
			.where(eq(tasks.id, fixtureState.taskId));
		if (!task) throw new Error("task fixture is missing");
		let resolveActionStarted!: () => void;
		const actionStarted = new Promise<void>((resolve) => {
			resolveActionStarted = resolve;
		});
		let actionSignal: AbortSignal | null = null;
		const runPromise = runMissionPilotAgentWake(
			{ sessionId: fixtureState.sessionId },
			{
				readPort,
				provider: {
					nextTurn: async () => ({
						type: "supported",
						content: "Task名を更新します。",
						toolCalls: [
							{
								id: "stoppable-task-update",
								name: "execute_task_action",
								arguments: {
									actionId: "task.update",
									expectedTaskRevision: task.revision,
									idempotencyKey: "stoppable-task-update",
									arguments: { fields: { title: "must not be applied" } },
								},
							},
						],
						usage: usage(),
					}),
				},
				actionPort: {
					execute: async (input) => {
						if (!input.signal) throw new Error("runtime signal is required");
						actionSignal = input.signal;
						resolveActionStarted();
						await new Promise<void>((resolve) => {
							if (input.signal.aborted) {
								resolve();
								return;
							}
							input.signal.addEventListener("abort", () => resolve(), {
								once: true,
							});
						});
						return {
							ok: true,
							actionId: input.actionId,
							data: { mutationCommitted: true },
						};
					},
				},
			},
		);

		await actionStarted;
		const stopResult = await stopMissionPilotAgentRuntime(
			fixtureState.sessionId,
			1_000,
		);
		const result = await runPromise;

		expect(stopResult).toEqual({ requested: true, quiesced: true });
		expect(actionSignal?.aborted).toBe(true);
		expect(result).toMatchObject({ kind: "stopped" });
		const [toolCall] = await db
			.select()
			.from(missionPilotToolCalls)
			.where(eq(missionPilotToolCalls.sessionId, fixtureState.sessionId));
		expect(toolCall).toMatchObject({
			status: "succeeded",
			resultJson: { mutationCommitted: true },
		});
	});
});

function usage() {
	return {
		inputTokens: 1,
		outputTokens: 1,
		cachedInputTokens: 0,
		reasoningOutputTokens: 0,
		totalTokens: 2,
		mode: "provider_reported" as const,
	};
}
