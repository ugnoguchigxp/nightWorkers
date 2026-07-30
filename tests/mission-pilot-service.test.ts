import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ensureNightWorkersSchema } from "../api/db/bootstrap";
import { db } from "../api/db/client";
import {
	missionPilotAgentSessions,
	missionPilotConversationItems,
	missionPilotTaskEventInbox,
} from "../api/db/mission-pilot-agent-schema";
import {
	missionPilotContextSnapshots,
	missionPilotSessions,
} from "../api/db/mission-pilot-schema";
import { repositories, taskMessages, taskRuns, tasks } from "../api/db/schema";
import {
	registerTaskUserIntakeHandler,
	type SubmitTaskUserIntakeCommand,
} from "../api/modules/agentsShare";
import {
	createSession,
	getSessionByTaskId,
} from "../api/modules/missionPilot/mission-pilot.repository";
import { sendTaskOperatorUserMessage } from "../api/modules/task";
import { nightWorkersRealtimeBroker } from "../api/services/realtime/nightworkers-ws";

const service = await import(
	"../api/modules/missionPilot/mission-pilot.service"
);
const repositoryIds: string[] = [];
let unregisterIntakeHandler: (() => void) | null = null;
const providerReady = {
	providerPreflight: () => ({ ok: true as const, candidateCount: 1 }),
};

beforeAll(() => ensureNightWorkersSchema());
afterEach(async () => {
	unregisterIntakeHandler?.();
	unregisterIntakeHandler = null;
	for (const id of repositoryIds.splice(0)) {
		await db.delete(repositories).where(eq(repositories.id, id));
	}
});

async function createPilotFixture(options: { runtimeKind?: "agent" } = {}) {
	const repositoryId = crypto.randomUUID();
	const taskId = crypto.randomUUID();
	const runId = crypto.randomUUID();
	repositoryIds.push(repositoryId);
	await db.transaction(async (tx) => {
		await tx.insert(repositories).values({
			id: repositoryId,
			name: "Mission Pilot service test",
			localPath: "/tmp/mission-pilot-service",
			branch: "main",
		});
		const [task] = await tx
			.insert(tasks)
			.values({
				id: taskId,
				repositoryId,
				title: "Pilot service",
				objective: "初期プロンプトを一度だけ送信する",
				status: "draft",
			})
			.returning();
		await createSession(
			{
				task,
				sourceKind: "mission_task_candidate",
				sourceId: crypto.randomUUID(),
				...(options.runtimeKind ? { runtimeKind: options.runtimeKind } : {}),
			},
			tx,
		);
	});
	registerIntakeHandler();
	return { repositoryId, taskId, runId };
}

function registerIntakeHandler(
	handler: (
		command: SubmitTaskUserIntakeCommand,
	) => Promise<{ taskId: string; messageId: string }> = persistIntakeMessage,
) {
	unregisterIntakeHandler?.();
	unregisterIntakeHandler = registerTaskUserIntakeHandler(handler);
}

async function persistIntakeMessage(command: SubmitTaskUserIntakeCommand) {
	const message = await sendTaskOperatorUserMessage(
		command.taskId,
		command.prompt,
		{
			source: "workbench",
			actor: command.actor,
			commandProvenance: {
				requestId: command.requestId,
				idempotencyKey: command.idempotencyKey,
			},
		},
		command.idempotencyKey,
	);
	if (!message) throw new Error("message was not persisted");
	return { taskId: command.taskId, messageId: message.id };
}

describe("Mission Pilot service", () => {
	it("dispatches the generated initial prompt through the user intake command and waits", async () => {
		const publishSpy = vi.spyOn(nightWorkersRealtimeBroker, "publish");
		const fixture = await createPilotFixture();
		const intake = vi.fn(async (command: SubmitTaskUserIntakeCommand) => {
			return persistIntakeMessage(command);
		});
		registerIntakeHandler(intake);
		await db
			.update(tasks)
			.set({ objective: "Play時点の最新プロンプト" })
			.where(eq(tasks.id, fixture.taskId));

		const played = await service.play(fixture.taskId, 0, {
			providerPreflight: providerReady.providerPreflight,
		});
		expect(played.missionPilot).toMatchObject({
			desiredState: "playing",
			authorizationVersion: 4,
			initialPromptState: "sent",
			activeRunId: null,
			phase: "initial_intake",
		});
		expect(played.run).toBeNull();
		expect(intake).toHaveBeenCalledOnce();
		expect(intake).toHaveBeenCalledWith(
			expect.objectContaining({
				taskId: fixture.taskId,
				prompt: "Play時点の最新プロンプト",
				requestId: expect.stringContaining("mission-pilot-initial-prompt:"),
				idempotencyKey: expect.stringContaining(
					"mission-pilot-initial-prompt:",
				),
				actor: {
					kind: "delegated_user",
					actorId: expect.any(String),
				},
			}),
		);
		const activated = await getSessionByTaskId(fixture.taskId);
		expect(activated?.authorizationJson).toMatchObject({
			version: 4,
			taskRef: { source: "task", id: fixture.taskId },
			activationContextRevision: 2,
			activationContextDigest: activated?.contextDigest,
			subjectUserId: "local-task-operator-user",
			userAuthorizationRef: "local-user",
		});
		expect(
			await db
				.select()
				.from(missionPilotContextSnapshots)
				.where(eq(missionPilotContextSnapshots.sessionId, activated?.id ?? "")),
		).toHaveLength(2);
		expect(
			await db
				.select()
				.from(taskRuns)
				.where(eq(taskRuns.taskId, fixture.taskId)),
		).toHaveLength(0);
		expect(
			await db
				.select()
				.from(missionPilotTaskEventInbox)
				.where(
					eq(missionPilotTaskEventInbox.sessionId, activated?.id ?? "missing"),
				),
		).toHaveLength(0);
		const [agent] = await db
			.select()
			.from(missionPilotAgentSessions)
			.where(
				eq(missionPilotAgentSessions.sessionId, activated?.id ?? "missing"),
			);
		expect(agent?.runtimeState).toBe("waiting");
		const [initialPromptMessage] = await db
			.select()
			.from(taskMessages)
			.where(
				and(
					eq(taskMessages.taskId, fixture.taskId),
					eq(taskMessages.role, "user"),
				),
			);
		expect(initialPromptMessage).toMatchObject({
			content: "Play時点の最新プロンプト",
			messageType: "text",
			metadataJson: expect.objectContaining({
				source: "workbench",
				actor: expect.objectContaining({
					kind: "delegated_user",
					actorId: activated?.id,
				}),
			}),
		});
		expect(played.missionPilot.initialPromptMessageId).toBe(
			initialPromptMessage?.id,
		);
		expect(publishSpy).toHaveBeenCalledWith(
			fixture.taskId,
			expect.objectContaining({
				type: "task_message_created",
				payload: {
					message: expect.objectContaining({
						id: initialPromptMessage?.id,
						role: "user",
						content: "Play時点の最新プロンプト",
					}),
				},
			}),
		);
		publishSpy.mockRestore();
	});

	it("does not mark the initial prompt sent when user intake dispatch fails", async () => {
		const fixture = await createPilotFixture();
		registerIntakeHandler(async () => {
			throw new Error("Task intake dispatch failed");
		});

		await expect(
			service.play(fixture.taskId, 0, {
				providerPreflight: providerReady.providerPreflight,
			}),
		).rejects.toMatchObject({
			code: "MISSION_PILOT_INITIAL_PROMPT_DISPATCH_FAILED",
		});
		expect(await getSessionByTaskId(fixture.taskId)).toMatchObject({
			desiredState: "stopped",
			phase: "attention",
			initialPromptState: "failed",
			activeRunId: null,
			lastErrorCode: "MISSION_PILOT_INITIAL_PROMPT_DISPATCH_FAILED",
		});
	});

	it("reuses the visible initial prompt when a failed dispatch is retried", async () => {
		const fixture = await createPilotFixture();
		registerIntakeHandler(async (command) => {
			await persistIntakeMessage(command);
			throw new Error("temporary intake acknowledgement failure");
		});
		await expect(
			service.play(fixture.taskId, 0, providerReady),
		).rejects.toMatchObject({
			code: "MISSION_PILOT_INITIAL_PROMPT_DISPATCH_FAILED",
		});
		const failed = await getSessionByTaskId(fixture.taskId);
		if (!failed) throw new Error("Mission Pilot session was not found");
		registerIntakeHandler();

		const retried = await service.play(
			fixture.taskId,
			failed.version,
			providerReady,
		);

		expect(retried.missionPilot).toMatchObject({
			initialPromptState: "sent",
			activeRunId: null,
			phase: "initial_intake",
		});
		expect(
			await db
				.select()
				.from(taskMessages)
				.where(
					and(
						eq(taskMessages.taskId, fixture.taskId),
						eq(taskMessages.role, "user"),
					),
				),
		).toHaveLength(1);
	});

	it("does not inspect or attach itself to a pre-existing Coding Agent Run", async () => {
		const fixture = await createPilotFixture();
		await db.insert(taskRuns).values({
			id: fixture.runId,
			taskId: fixture.taskId,
			repositoryId: fixture.repositoryId,
			status: "running",
		});
		const played = await service.play(fixture.taskId, 0, providerReady);
		expect(played.missionPilot).toMatchObject({
			desiredState: "playing",
			initialPromptState: "sent",
			activeRunId: null,
			phase: "initial_intake",
		});
		expect(
			await db
				.select()
				.from(taskMessages)
				.where(eq(taskMessages.taskId, fixture.taskId)),
		).toHaveLength(1);
	});

	it("allows a previously-dispatched Mission Pilot session to resume monitoring", async () => {
		const fixture = await createPilotFixture();
		await db
			.update(missionPilotSessions)
			.set({ initialPromptState: "sent" })
			.where(eq(missionPilotSessions.taskId, fixture.taskId));
		await db.insert(taskRuns).values({
			id: fixture.runId,
			taskId: fixture.taskId,
			repositoryId: fixture.repositoryId,
			status: "running",
		});

		const played = await service.play(fixture.taskId, 0, {
			providerPreflight: providerReady.providerPreflight,
		});

		expect(played).toMatchObject({
			missionPilot: {
				desiredState: "playing",
				initialPromptState: "sent",
				phase: "starting",
			},
			run: null,
		});
	});

	it("rejects unsupported provider capability before Play is committed", async () => {
		const fixture = await createPilotFixture();
		await expect(
			service.play(fixture.taskId, 0, {
				providerPreflight: () => ({
					ok: false,
					code: "MISSION_PILOT_PROVIDER_TOOL_TURN_UNSUPPORTED",
					message: "tool turn is unsupported",
				}),
			}),
		).rejects.toMatchObject({
			code: "MISSION_PILOT_PROVIDER_TOOL_TURN_UNSUPPORTED",
		});
		const session = await getSessionByTaskId(fixture.taskId);
		expect(session).toMatchObject({
			desiredState: "stopped",
			authorizationJson: null,
			version: 0,
		});
	});

	it("activates from the complete paged Task Goal without truncating canonical text", async () => {
		const fixture = await createPilotFixture();
		const objective = "完全なTask Goal。".repeat(2_000);
		const acceptanceCriteria = "完全な受入条件。".repeat(1_500);
		await db
			.update(tasks)
			.set({ objective, acceptanceCriteria })
			.where(eq(tasks.id, fixture.taskId));
		await service.play(fixture.taskId, 0, providerReady);
		const session = await getSessionByTaskId(fixture.taskId);
		expect(session?.initialPromptSnapshot).toBe(objective);
		const contexts = await db
			.select()
			.from(missionPilotContextSnapshots)
			.where(eq(missionPilotContextSnapshots.sessionId, session?.id ?? ""))
			.orderBy(missionPilotContextSnapshots.revision);
		const latestContext = contexts.at(-1)?.contextJson as
			| { task?: { initialPrompt?: string; acceptanceCriteria?: string } }
			| undefined;
		expect(contexts).not.toHaveLength(0);
		expect(latestContext?.task).toMatchObject({
			initialPrompt: objective,
			acceptanceCriteria,
		});
		const conversation = await db
			.select()
			.from(missionPilotConversationItems)
			.where(eq(missionPilotConversationItems.sessionId, session?.id ?? ""))
			.orderBy(missionPilotConversationItems.sequence);
		expect(conversation.find((item) => item.kind === "user")?.bodyJson).toEqual(
			{ content: objective },
		);
	});

	it("stores the initial prompt as a canonical text message, not a pseudo message", async () => {
		const fixture = await createPilotFixture();
		const played = await service.play(fixture.taskId, 0, providerReady);
		expect(played.missionPilot).toMatchObject({
			initialPromptState: "sent",
		});
		expect(played.missionPilot.initialPromptMessageId).toEqual(
			expect.any(String),
		);
		expect(
			await db
				.select()
				.from(taskMessages)
				.where(
					and(
						eq(taskMessages.taskId, fixture.taskId),
						eq(
							taskMessages.id,
							played.missionPilot.initialPromptMessageId ?? "",
						),
						eq(taskMessages.role, "user"),
						eq(taskMessages.messageType, "text"),
					),
				),
		).toHaveLength(1);
		expect(
			await db
				.select()
				.from(taskMessages)
				.where(
					and(
						eq(taskMessages.taskId, fixture.taskId),
						eq(taskMessages.messageType, "mission_pilot_initial_prompt"),
					),
				),
		).toHaveLength(0);
	});

	it("does not create or answer a Questionnaire during Mission Pilot Play", async () => {
		const fixture = await createPilotFixture();
		const played = await service.play(fixture.taskId, 0, providerReady);
		expect(played.missionPilot).toMatchObject({
			desiredState: "playing",
			phase: "initial_intake",
		});
		expect(
			(
				await db
					.select()
					.from(taskMessages)
					.where(eq(taskMessages.taskId, fixture.taskId))
			).some(
				(message) =>
					message.metadataJson?.intent === "design_questionnaire_ready",
			),
		).toBe(false);
	});

	it("stops Mission Pilot without stopping a Coding Agent-owned Run", async () => {
		const fixture = await createPilotFixture();
		const played = await service.play(fixture.taskId, 0, providerReady);
		const [codingAgentRun] = await db
			.insert(taskRuns)
			.values({
				id: crypto.randomUUID(),
				taskId: fixture.taskId,
				repositoryId: fixture.repositoryId,
				status: "running",
			})
			.returning();
		const stopped = await service.stop(
			fixture.taskId,
			played.missionPilot.version,
		);
		expect(stopped.missionPilot).toMatchObject({
			desiredState: "stopped",
			activityState: "idle",
			activeRunId: null,
		});
		expect(
			await db.query.taskRuns.findFirst({
				where: eq(taskRuns.id, codingAgentRun.id),
			}),
		).toMatchObject({ status: "running" });
	});

	it("does not stop an active Run that is not owned by Mission Pilot", async () => {
		const fixture = await createPilotFixture({ runtimeKind: "agent" });
		const [manualRun] = await db
			.insert(taskRuns)
			.values({
				id: fixture.runId,
				taskId: fixture.taskId,
				repositoryId: fixture.repositoryId,
				status: "running",
			})
			.returning();
		const [playing] = await db
			.update(missionPilotSessions)
			.set({
				desiredState: "playing",
				phase: "implementation",
				version: 1,
				updatedAt: new Date(),
			})
			.where(eq(missionPilotSessions.taskId, fixture.taskId))
			.returning();
		if (!playing) throw new Error("failed to prepare agent session");

		const stopped = await service.stop(fixture.taskId, playing.version);

		expect(stopped.missionPilot).toMatchObject({
			desiredState: "stopped",
			phase: "paused",
			activeRunId: null,
		});
		expect(
			await db.query.taskRuns.findFirst({
				where: eq(taskRuns.id, manualRun.id),
			}),
		).toMatchObject({ status: "running" });
	});

	it("requires a Stop retry before replay after a runtime stop timeout", async () => {
		const fixture = await createPilotFixture({ runtimeKind: "agent" });
		const [timedOut] = await db
			.update(missionPilotSessions)
			.set({
				desiredState: "stopped",
				phase: "attention",
				version: 1,
				lastErrorCode: "MISSION_PILOT_RUNTIME_STOP_TIMEOUT",
				lastErrorMessage: "runtime did not acknowledge stop",
				updatedAt: new Date(),
			})
			.where(eq(missionPilotSessions.taskId, fixture.taskId))
			.returning();
		if (!timedOut) throw new Error("failed to prepare timeout state");

		await expect(
			service.play(fixture.taskId, timedOut.version, providerReady),
		).rejects.toMatchObject({
			code: "MISSION_PILOT_VERSION_CONFLICT",
		});
	});

	it("stops an agent session that is waiting in attention", async () => {
		const fixture = await createPilotFixture({ runtimeKind: "agent" });
		const [playing] = await db
			.update(missionPilotSessions)
			.set({
				desiredState: "playing",
				phase: "attention",
				version: 1,
				lastErrorCode: "PROVIDER_UNSUPPORTED",
				lastErrorMessage: "provider route unavailable",
				updatedAt: new Date(),
			})
			.where(eq(missionPilotSessions.taskId, fixture.taskId))
			.returning();
		if (!playing) throw new Error("failed to prepare agent session");
		await db
			.update(missionPilotAgentSessions)
			.set({
				runtimeState: "attention",
				lastFailureJson: {
					kind: "unknown",
					retryable: false,
					providerCode: null,
					httpStatus: null,
					message: "provider route unavailable",
					retryAfterMs: null,
					attempt: 1,
					actionId: "provider.next_turn",
					idempotencyKey: null,
				},
			})
			.where(eq(missionPilotAgentSessions.sessionId, playing.id));

		const stopped = await service.stop(fixture.taskId, playing.version);

		expect(stopped.missionPilot).toMatchObject({
			desiredState: "stopped",
			activityState: "idle",
			phase: "paused",
			activeRunId: null,
		});
		const [agent] = await db
			.select()
			.from(missionPilotAgentSessions)
			.where(eq(missionPilotAgentSessions.sessionId, playing.id));
		expect(agent).toMatchObject({
			runtimeState: "stopped",
			currentTurnId: null,
			leaseOwner: null,
			leaseExpiresAt: null,
		});
	});
});
