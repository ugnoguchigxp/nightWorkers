import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ensureNightWorkersSchema } from "../api/db/bootstrap";
import { db } from "../api/db/client";
import {
	agentModeSessions,
	implementationQueueEntries,
	taskRunTodos,
} from "../api/db/schema";
import {
	activateInterruptedCodingAgentRun,
	claimCodingAgentRunExecution,
	findInterruptedCodingAgentRunCandidate,
	interruptCodingAgentRun,
	interruptCodingAgentRunsAfterWorkerExit,
	projectUnknownOutcomeToolCalls,
	reconcileCodingAgentProcessInterruptions,
	restoreInterruptedCodingAgentRunAfterLaunchFailure,
	suspendActiveCodingAgentRunsForHostShutdown,
} from "../api/modules/codingAgent";
import { codingAgentRunExecutions } from "../api/modules/codingAgent/persistence/runtime-execution-schema";
import type { CodingAgentExecutionOwnerIdentity } from "../api/modules/codingAgent/runtime/execution-owner-identity";
import * as nightworkersRepo from "../api/modules/nightworkers/nightworkers.repository";
import { activatePreparedTaskRun } from "../api/modules/nightworkers/run-orchestration/start-task-run-launch";
import { persistPreparedRuntimePrompt } from "../api/modules/nightworkers/run-orchestration/start-task-run-persistence";
import * as queueRepo from "../api/modules/queue/queue.repository";

const repositoryIds: string[] = [];

beforeAll(async () => {
	await ensureNightWorkersSchema();
});

afterEach(async () => {
	for (const repositoryId of repositoryIds.splice(0)) {
		await nightworkersRepo.deleteRepository(repositoryId);
	}
});

describe("Coding Agent process restart continuation", () => {
	it("projects started-without-finished tool calls as unknown outcomes", () => {
		const events = [
			toolEvent(1, "tool.call_started", {
				callId: "call-open",
				toolName: "worker.shell",
				arguments: { command: "bun run test" },
			}),
			toolEvent(2, "tool.call_started", {
				providerItemId: "call-closed",
				toolName: "command_execution",
				command: "bun run lint",
			}),
			toolEvent(3, "tool.call_finished", {
				providerItemId: "call-closed",
				toolName: "command_execution",
			}),
		];

		expect(projectUnknownOutcomeToolCalls(events)).toEqual([
			expect.objectContaining({
				callId: "call-open",
				toolName: "worker.shell",
				startedEventSeq: 1,
				evidenceRef: "task_event:event-1",
				outcome: "unknown",
			}),
		]);
	});

	it("reconciles an old boot owner and resumes the same Run, Todo, Session, and Queue entry", async () => {
		const fixture = await createActiveRunFixture();
		const ownerA: CodingAgentExecutionOwnerIdentity = {
			kind: "api_process",
			instanceId: "api_process:boot-a",
			pid: 111,
		};
		const ownerB: CodingAgentExecutionOwnerIdentity = {
			kind: "api_process",
			instanceId: "api_process:boot-b",
			pid: 222,
		};
		await claimCodingAgentRunExecution({
			runId: fixture.run.id,
			agentModeSessionId: fixture.session.id,
			owner: ownerA,
			now: new Date("2026-08-03T04:45:37.000Z"),
		});
		await nightworkersRepo.createRunEvent({
			version: 1,
			runId: fixture.run.id,
			taskId: fixture.task.id,
			timestamp: "2026-08-03T04:45:37.000Z",
			type: "tool.call_started",
			severity: "info",
			actor: "worker",
			message: "coverage started",
			data: {
				providerItemId: "coverage-call",
				toolName: "command_execution",
				command: "bun run test:coverage",
			},
		});

		const reconciled = await reconcileCodingAgentProcessInterruptions({
			owner: ownerB,
			now: new Date("2026-08-03T04:45:53.000Z"),
		});
		expect(reconciled.map((item) => item.run.id)).toContain(fixture.run.id);
		await expect(
			reconcileCodingAgentProcessInterruptions({
				owner: ownerB,
				now: new Date("2026-08-03T04:45:54.000Z"),
			}),
		).resolves.toEqual([]);

		const [interruptedRun, interruptedTask, interruptedQueue, execution] =
			await Promise.all([
				nightworkersRepo.getTaskRun(fixture.run.id),
				nightworkersRepo.getTask(fixture.task.id),
				queueRepo.getImplementationQueueEntry(fixture.queue.id),
				getExecution(fixture.run.id),
			]);
		expect(interruptedRun?.status).toBe("needs_human");
		expect(interruptedTask?.status).toBe("needs_human");
		expect(interruptedQueue).toMatchObject({
			status: "needs_human",
			activeRunId: fixture.run.id,
			leaseOwnerId: null,
		});
		expect(execution).toMatchObject({
			status: "interrupted",
			interruptionRevision: 1,
			interruptionReason: "process_restarted",
		});
		expect(execution?.interruptionSnapshotJson).toMatchObject({
			kind: "process_interrupted",
			currentTodo: {
				id: fixture.todo.id,
				revision: fixture.todo.revision,
				status: "running",
			},
			unresolvedToolCalls: [
				expect.objectContaining({
					callId: "coverage-call",
					outcome: "unknown",
				}),
			],
		});
		if (!interruptedRun) throw new Error("interrupted Run missing");
		await persistPreparedRuntimePrompt({
			taskId: fixture.task.id,
			run: interruptedRun,
			resuming: true,
			compiledPromptText: "resume preparation A",
			runtimeContextSnapshot: {
				...(interruptedRun.contextSnapshot as Record<string, unknown>),
				resumePreparation: "A",
			},
		});
		await expect(
			persistPreparedRuntimePrompt({
				taskId: fixture.task.id,
				run: interruptedRun,
				resuming: true,
				compiledPromptText: "resume preparation B",
				runtimeContextSnapshot: {
					...(interruptedRun.contextSnapshot as Record<string, unknown>),
					resumePreparation: "B",
				},
			}),
		).rejects.toMatchObject({ code: "RUN_RESUME_PREPARATION_CONFLICT" });
		await expect(
			nightworkersRepo.getTask(fixture.task.id),
		).resolves.toMatchObject({ compiledPrompt: "resume preparation A" });

		const candidate = await findInterruptedCodingAgentRunCandidate(
			fixture.task.id,
		);
		expect(candidate).toMatchObject({
			runId: fixture.run.id,
			agentModeSessionId: fixture.session.id,
			todoId: fixture.todo.id,
			todoRevision: fixture.todo.revision,
			interruptionRevision: 1,
		});
		if (!candidate) throw new Error("candidate missing");

		const resumed = await activateInterruptedCodingAgentRun({
			runId: candidate.runId,
			expectedInterruptionRevision: candidate.interruptionRevision,
			todoId: candidate.todoId,
			expectedTodoRevision: candidate.todoRevision,
			owner: ownerB,
			now: new Date("2026-08-03T04:46:11.000Z"),
		});
		expect(resumed).toMatchObject({
			id: fixture.run.id,
			agentModeSessionId: fixture.session.id,
			status: "running",
		});
		await expect(
			activateInterruptedCodingAgentRun({
				runId: candidate.runId,
				expectedInterruptionRevision: candidate.interruptionRevision,
				todoId: candidate.todoId,
				expectedTodoRevision: candidate.todoRevision,
				owner: ownerB,
			}),
		).rejects.toMatchObject({ code: "RUN_INTERRUPTION_REVISION_CONFLICT" });
		await expect(
			activatePreparedTaskRun({
				run: resumed,
				resumeRunId: candidate.runId,
				resumeCommand: {
					kind: "process_interruption",
					expectedInterruptionRevision: candidate.interruptionRevision,
					todoId: candidate.todoId,
					expectedTodoRevision: candidate.todoRevision,
					userContext: "再開してください",
				},
				taskId: fixture.task.id,
				executionMode: "implementation",
			}),
		).rejects.toMatchObject({ code: "RUN_INTERRUPTION_REVISION_CONFLICT" });
		await expect(
			nightworkersRepo.getTaskRun(fixture.run.id),
		).resolves.toMatchObject({ status: "running" });

		const [resumedTodo, resumedQueue, resumedExecution] = await Promise.all([
			db
				.select()
				.from(taskRunTodos)
				.where(eq(taskRunTodos.id, fixture.todo.id))
				.then((rows) => rows[0]),
			queueRepo.getImplementationQueueEntry(fixture.queue.id),
			getExecution(fixture.run.id),
		]);
		expect(resumedTodo).toMatchObject({
			id: fixture.todo.id,
			status: "running",
			revision: fixture.todo.revision,
		});
		expect(resumedQueue).toMatchObject({
			status: "processing",
			activeRunId: fixture.run.id,
		});
		expect(resumedExecution).toMatchObject({
			status: "active",
			ownerInstanceId: ownerB.instanceId,
			interruptionRevision: 1,
		});

		const restored = await restoreInterruptedCodingAgentRunAfterLaunchFailure({
			runId: fixture.run.id,
			expectedInterruptionRevision: 1,
			error: new Error(
				"runtime launch fixture failed; Authorization: Bearer top-secret-token",
			),
			owner: ownerB,
			now: new Date("2026-08-03T04:46:20.000Z"),
		});
		expect(restored).toMatchObject({
			id: fixture.run.id,
			status: "needs_human",
		});
		const launchFailureMessage = (
			await nightworkersRepo.listTaskMessages(fixture.task.id)
		).find(
			(message) =>
				(message.metadataJson as { intent?: unknown } | null)?.intent ===
				"coding_agent_resume_launch_failed",
		);
		expect(launchFailureMessage?.content).toContain("[REDACTED]");
		expect(launchFailureMessage?.content).not.toContain("top-secret-token");
		const retryCandidate = await findInterruptedCodingAgentRunCandidate(
			fixture.task.id,
		);
		expect(retryCandidate).toMatchObject({
			runId: fixture.run.id,
			interruptionRevision: 1,
			todoId: fixture.todo.id,
			todoRevision: fixture.todo.revision,
		});
		if (!retryCandidate) throw new Error("retry candidate missing");
		await expect(
			activateInterruptedCodingAgentRun({
				runId: retryCandidate.runId,
				expectedInterruptionRevision: retryCandidate.interruptionRevision,
				todoId: retryCandidate.todoId,
				expectedTodoRevision: retryCandidate.todoRevision,
				owner: ownerB,
			}),
		).resolves.toMatchObject({ id: fixture.run.id, status: "running" });
	});

	it("suspends the current API owner as graceful_shutdown without cancelling the Run", async () => {
		const fixture = await createActiveRunFixture();
		const owner: CodingAgentExecutionOwnerIdentity = {
			kind: "api_process",
			instanceId: "api_process:graceful-boot",
			pid: 303,
		};
		await claimCodingAgentRunExecution({
			runId: fixture.run.id,
			agentModeSessionId: fixture.session.id,
			owner,
		});

		const suspended = await suspendActiveCodingAgentRunsForHostShutdown({
			owner,
			now: new Date("2026-08-03T05:10:00.000Z"),
		});

		expect(suspended).toHaveLength(1);
		await expect(
			nightworkersRepo.getTaskRun(fixture.run.id),
		).resolves.toMatchObject({
			id: fixture.run.id,
			status: "needs_human",
		});
		await expect(getExecution(fixture.run.id)).resolves.toMatchObject({
			status: "interrupted",
			interruptionReason: "graceful_shutdown",
		});
	});

	it("leaves a worker owner intact at API startup and interrupts it only after worker loss", async () => {
		const fixture = await createActiveRunFixture();
		const workerOwner: CodingAgentExecutionOwnerIdentity = {
			kind: "worker_process",
			instanceId: "worker_process:worker-a",
			pid: 404,
		};
		await claimCodingAgentRunExecution({
			runId: fixture.run.id,
			agentModeSessionId: fixture.session.id,
			owner: workerOwner,
		});

		await expect(
			reconcileCodingAgentProcessInterruptions({
				owner: {
					kind: "api_process",
					instanceId: "api_process:startup",
					pid: 505,
				},
			}),
		).resolves.toEqual([]);
		await expect(
			nightworkersRepo.getTaskRun(fixture.run.id),
		).resolves.toMatchObject({ status: "running" });
		await expect(
			interruptCodingAgentRun({
				runId: fixture.run.id,
				reason: "worker_lost",
				requireExpiredExecutionLease: true,
			}),
		).resolves.toBeNull();
		await expect(
			nightworkersRepo.getTaskRun(fixture.run.id),
		).resolves.toMatchObject({ status: "running" });

		await expect(
			interruptCodingAgentRunsAfterWorkerExit([
				{ runId: fixture.run.id, ownerPid: 999 },
			]),
		).resolves.toEqual([]);
		await expect(getExecution(fixture.run.id)).resolves.toMatchObject({
			status: "active",
			ownerPid: workerOwner.pid,
		});

		const interrupted = await interruptCodingAgentRunsAfterWorkerExit([
			{ runId: fixture.run.id, ownerPid: workerOwner.pid },
			{ runId: fixture.run.id, ownerPid: workerOwner.pid },
		]);
		expect(interrupted).toHaveLength(1);
		await expect(getExecution(fixture.run.id)).resolves.toMatchObject({
			status: "interrupted",
			interruptionReason: "worker_lost",
		});
	});
});

async function createActiveRunFixture() {
	const repository = await nightworkersRepo.createRepository({
		name: `TEST: process restart ${crypto.randomUUID()}`,
		localPath: "/Users/y.noguchi/Code/nightWorkers",
		branch: "main",
	});
	repositoryIds.push(repository.id);
	const task = await nightworkersRepo.createTask({
		repositoryId: repository.id,
		title: `TEST: interrupted Run ${crypto.randomUUID()}`,
		description: "Restart continuation fixture",
		objective: "Resume the same Run",
		acceptanceCriteria: "Identity remains stable",
		status: "running",
	});
	const [session] = await db
		.insert(agentModeSessions)
		.values({
			taskId: task.id,
			repositoryId: repository.id,
			epoch: 1,
			executionMode: "implementation",
			llmRole: "implementation",
			runtimeLane: "codex-sdk",
			provider: "codex",
			model: "gpt-test",
			routeFingerprint: "restart-fixture",
			status: "active",
			openedAt: new Date(),
		})
		.returning();
	if (!session) throw new Error("session missing");
	const run = await nightworkersRepo.createTaskRun({
		taskId: task.id,
		repositoryId: repository.id,
		taskRevisionSnapshotId: task.currentRevisionSnapshotId,
		taskRevision: task.revision,
		agentModeSessionId: session.id,
		status: "running",
		workerKind: "codex-agent",
		contextSnapshot: { executionMode: "implementation" },
	});
	if (!run) throw new Error("run missing");
	const [todo] = await db
		.insert(taskRunTodos)
		.values({
			runId: run.id,
			todoKey: "step-5",
			seq: 5,
			title: "検証する",
			nextAction: "coverageを確認する",
			taskType: "verification",
			status: "running",
			createdBy: "agent",
			revision: 3,
			startedAt: new Date(),
		})
		.returning();
	if (!todo) throw new Error("todo missing");
	const queue = await queueRepo.createImplementationQueueEntry({
		taskId: task.id,
		repositoryId: repository.id,
	});
	await db
		.update(implementationQueueEntries)
		.set({
			status: "processing",
			activeRunId: run.id,
			processorSlot: 1,
			leaseOwnerId: "api-process:111",
			leaseAcquiredAt: new Date(),
			leaseExpiresAt: new Date(Date.now() + 30 * 60_000),
		})
		.where(eq(implementationQueueEntries.id, queue.id));
	return { repository, task, session, run, todo, queue };
}

async function getExecution(runId: string) {
	const [row] = await db
		.select()
		.from(codingAgentRunExecutions)
		.where(eq(codingAgentRunExecutions.runId, runId));
	return row;
}

function toolEvent(
	seq: number,
	type: "tool.call_started" | "tool.call_finished",
	data: Record<string, unknown>,
) {
	return {
		id: `event-${seq}`,
		seq,
		payloadJson: {
			runEvent: {
				version: 1,
				runId: crypto.randomUUID(),
				timestamp: new Date().toISOString(),
				type,
				severity: "info",
				actor: "worker",
				message: type,
				data,
			},
		},
	};
}
