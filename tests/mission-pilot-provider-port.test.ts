import crypto from "node:crypto";
import "./helpers/mission-pilot-runtime";
import { createSession } from "@nightworkers/mission-pilot/backend";
import {
	appendMissionPilotTaskEvent,
	authorizeMissionPilotProviderCall,
	callMissionPilotProviderCandidates,
	cancelScheduledMissionPilotAgentWake,
	claimAgentPlay,
	claimMissionPilotAgentTurn,
	listPendingMissionPilotTaskEvents,
	MissionPilotProviderRetryScheduledError,
	missionPilotToolTurnProviderExecutionPolicy,
	retryMissionPilotProviderCall,
	scheduleMissionPilotAgentWakeAtNextEvent,
} from "@nightworkers/mission-pilot/testing";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ensureNightWorkersSchema } from "../api/db/bootstrap";
import { db } from "../api/db/client";
import { repositories, tasks } from "../api/db/schema";
import {
	buildNormalizedSupervisorLlmRequestCandidates,
	callProviderToolTurn,
	StructuredProviderError,
} from "../api/services/structured-llm/public";

const repositoryIds: string[] = [];
beforeAll(() => ensureNightWorkersSchema());
afterEach(async () => {
	for (const repositoryId of repositoryIds.splice(0))
		await db.delete(repositories).where(eq(repositories.id, repositoryId));
});

async function retryFixture() {
	const repositoryId = crypto.randomUUID();
	const taskId = crypto.randomUUID();
	repositoryIds.push(repositoryId);
	const session = await db.transaction(async (tx) => {
		await tx.insert(repositories).values({
			id: repositoryId,
			name: "provider retry",
			localPath: "/tmp/provider-retry",
			branch: "main",
		});
		const [task] = await tx
			.insert(tasks)
			.values({ id: taskId, repositoryId, title: "provider retry" })
			.returning();
		return createSession(
			{ task, sourceKind: "task", sourceId: task.id, runtimeKind: "agent" },
			tx,
		);
	});
	const playing = await claimAgentPlay(taskId, session.version);
	if (!playing) throw new Error("provider retry fixture did not start");
	return { taskId, sessionId: playing.id };
}

async function stoppedFixture() {
	const repositoryId = crypto.randomUUID();
	const taskId = crypto.randomUUID();
	repositoryIds.push(repositoryId);
	const session = await db.transaction(async (tx) => {
		await tx.insert(repositories).values({
			id: repositoryId,
			name: "stopped provider",
			localPath: "/tmp/stopped-provider",
			branch: "main",
		});
		const [task] = await tx
			.insert(tasks)
			.values({ id: taskId, repositoryId, title: "stopped provider" })
			.returning();
		return createSession(
			{ task, sourceKind: "task", sourceId: task.id, runtimeKind: "agent" },
			tx,
		);
	});
	return { taskId, session };
}

function providerCandidates() {
	return buildNormalizedSupervisorLlmRequestCandidates({
		systemPrompt: "system",
		userPrompt: "user",
		label: "mission_pilot_agent",
		role: "mission_pilot",
		settings: {
			providerEndpoints: [
				{
					id: "codex",
					name: "Codex SDK",
					kind: "codex",
					enabled: true,
					models: ["codex-model"],
				},
				{
					id: "azure",
					name: "Azure OpenAI",
					kind: "azure",
					enabled: true,
					endpoint: "https://example.openai.azure.com",
					models: ["azure-model"],
				},
			],
			roleRoutes: [
				{
					role: "mission_pilot",
					primary: {
						providerEndpointId: "codex",
						model: "codex-model",
					},
					fallbacks: [
						{
							providerEndpointId: "azure",
							model: "azure-model",
						},
					],
				},
			],
		},
	});
}

describe("Mission Pilot provider route fallback", () => {
	it("preserves every concurrently delivered Task event with a unique sequence", async () => {
		const fixture = await retryFixture();
		await Promise.all(
			Array.from({ length: 4 }, (_, index) =>
				appendMissionPilotTaskEvent({
					taskId: fixture.taskId,
					eventType: "task.state_changed",
					sourceEventId: `concurrent-event:${index}`,
					taskRevision: index + 1,
					payload: { index },
				}),
			),
		);
		const events = await listPendingMissionPilotTaskEvents(fixture.sessionId);
		expect(events).toHaveLength(4);
		expect(new Set(events.map((event) => event.sequence)).size).toBe(4);
	});

	it("rejects every provider call until Mission Pilot is explicitly playing", async () => {
		const fixture = await stoppedFixture();
		const [normalizedRequest] = providerCandidates();
		if (!normalizedRequest) throw new Error("provider candidate is missing");
		await expect(
			callProviderToolTurn({
				provider: "codex",
				messages: [{ role: "user", content: "user" }],
				tools: [],
				systemPrompt: "system",
				userPrompt: "user",
				options: {
					label: "mission_pilot_agent",
					role: "mission_pilot",
					taskId: fixture.taskId,
					normalizedRequest,
					executionPolicy: missionPilotToolTurnProviderExecutionPolicy,
				},
				signal: new AbortController().signal,
				setProviderDebug: vi.fn(),
			}),
		).rejects.toMatchObject({
			code: "MISSION_PILOT_PROVIDER_DISABLED",
		});

		const playing = await claimAgentPlay(
			fixture.taskId,
			fixture.session.version,
		);
		expect(playing).not.toBeNull();
		await expect(
			authorizeMissionPilotProviderCall({ taskId: fixture.taskId }),
		).resolves.toBeUndefined();
	});

	it("continues to the next configured candidate when native tools are unsupported", async () => {
		const candidates = providerCandidates();
		const calls: string[] = [];
		const result = await callMissionPilotProviderCandidates({
			candidates,
			signal: new AbortController().signal,
			callCandidate: vi.fn(async (candidate) => {
				calls.push(candidate.providerId);
				return candidate.providerId === "codex"
					? {
							type: "unsupported" as const,
							reason: "Codex native tools are unsupported",
						}
					: {
							type: "supported" as const,
							content: "Task Factを読みます。",
							toolCalls: [
								{
									id: "read-1",
									name: "read_task_workspace",
									arguments: {},
								},
							],
							usage: usage(),
						};
			}),
		});

		expect(calls).toEqual(["codex", "azure-openai"]);
		expect(result).toMatchObject({
			type: "supported",
			toolCalls: [{ name: "read_task_workspace" }],
		});
	});

	it("tries the next candidate before scheduling a retryable outage", async () => {
		const fixture = await retryFixture();
		const calls: string[] = [];
		const result = await callMissionPilotProviderCandidates({
			candidates: providerCandidates(),
			signal: new AbortController().signal,
			retryContext: {
				sessionId: fixture.sessionId,
				taskId: fixture.taskId,
				turnId: "turn-1",
				providerCallIndex: 1,
				taskRevision: 1,
			},
			callCandidate: vi.fn(async (candidate) => {
				calls.push(candidate.providerId);
				if (candidate.providerId === "codex")
					throw new StructuredProviderError({
						kind: "transport",
						message: "primary temporarily unavailable",
						retryable: true,
					});
				return {
					type: "supported" as const,
					content: "fallback succeeded",
					toolCalls: [],
					usage: usage(),
				};
			}),
		});

		expect(calls).toEqual(["codex", "azure-openai"]);
		expect(result).toMatchObject({ type: "supported" });
		expect(
			await listPendingMissionPilotTaskEvents(
				fixture.sessionId,
				new Date(Date.now() + 60_000),
			),
		).toHaveLength(0);
	});

	it("returns a typed unsupported result when no route candidate is configured", async () => {
		const callCandidate = vi.fn();
		const result = await callMissionPilotProviderCandidates({
			candidates: [],
			signal: new AbortController().signal,
			callCandidate,
		});

		expect(callCandidate).not.toHaveBeenCalled();
		expect(result).toMatchObject({
			type: "unsupported",
			providerDebug: { candidateCount: 0 },
		});
	});

	it("persists one retry event, yields the wake, and cancels it on Stop", async () => {
		const fixture = await retryFixture();
		const operation = vi.fn(async () => {
			throw new StructuredProviderError({
				kind: "rate_limit",
				message: "retry later",
				retryable: true,
				retryAfterMs: 1_000,
			});
		});
		await expect(
			retryMissionPilotProviderCall(operation, new AbortController().signal, {
				sessionId: fixture.sessionId,
				taskId: fixture.taskId,
				turnId: "turn-1",
				providerCallIndex: 1,
				taskRevision: 1,
				attempt: 1,
			}),
		).rejects.toBeInstanceOf(MissionPilotProviderRetryScheduledError);
		await expect(
			retryMissionPilotProviderCall(operation, new AbortController().signal, {
				sessionId: fixture.sessionId,
				taskId: fixture.taskId,
				turnId: "turn-1",
				providerCallIndex: 1,
				taskRevision: 1,
				attempt: 1,
			}),
		).rejects.toBeInstanceOf(MissionPilotProviderRetryScheduledError);
		expect(operation).toHaveBeenCalledTimes(2);
		const events = await listPendingMissionPilotTaskEvents(
			fixture.sessionId,
			new Date(Date.now() + 2_000),
		);
		expect(events).toHaveLength(1);
		expect(events[0]?.payloadJson).toMatchObject({ nextAttempt: 2 });

		await cancelScheduledMissionPilotAgentWake(fixture.sessionId);
		expect(
			await listPendingMissionPilotTaskEvents(
				fixture.sessionId,
				new Date(Date.now() + 2_000),
			),
		).toHaveLength(0);
	});

	it("carries the persisted retry attempt into the claimed agent turn", async () => {
		const fixture = await retryFixture();
		await appendMissionPilotTaskEvent({
			taskId: fixture.taskId,
			eventType: "mission_pilot.retry_timer_elapsed",
			sourceEventId: "provider-retry:turn-1:1:2",
			taskRevision: 1,
			payload: { nextAttempt: 2 },
		});

		const claimed = await claimMissionPilotAgentTurn({
			sessionId: fixture.sessionId,
			leaseOwner: "provider-retry-test",
		});

		expect(claimed).toMatchObject({
			providerRetryAttempt: 2,
			triggerEvents: [
				expect.objectContaining({
					eventType: "mission_pilot.retry_timer_elapsed",
				}),
			],
		});
	});

	it("reserves one future wake while its event lookup is still in flight", async () => {
		const fixture = await retryFixture();
		expect(scheduleMissionPilotAgentWakeAtNextEvent(fixture)).toBe(true);
		expect(scheduleMissionPilotAgentWakeAtNextEvent(fixture)).toBe(false);
		expect(await cancelScheduledMissionPilotAgentWake(fixture.sessionId)).toBe(
			true,
		);
	});

	it("stops retrying at the persisted third attempt", async () => {
		const fixture = await retryFixture();
		const operation = vi.fn(async () => {
			throw new StructuredProviderError({
				kind: "transport",
				message: "still unavailable",
				retryable: true,
			});
		});
		await expect(
			retryMissionPilotProviderCall(operation, new AbortController().signal, {
				sessionId: fixture.sessionId,
				taskId: fixture.taskId,
				turnId: "turn-1",
				providerCallIndex: 1,
				taskRevision: 1,
				attempt: 3,
			}),
		).rejects.toMatchObject({ attempt: 3, retryable: true });
		expect(operation).toHaveBeenCalledTimes(1);
		expect(
			await listPendingMissionPilotTaskEvents(
				fixture.sessionId,
				new Date(Date.now() + 60_000),
			),
		).toHaveLength(0);
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
