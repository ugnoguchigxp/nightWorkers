import { shouldUseIsolatedTaskExecutor } from "../../../services/execution/executor-mode";
import { runImplementationQueueInWorker } from "../../../services/execution/worker-process-manager";
import { getSessionQueueMaxConcurrencyFromEnv } from "../../../services/runtime-env";
import {
	holdBlockedMissionPilotImplementationStart,
	resolveMissionPilotImplementationStart,
} from "../../missionPilot/mission-pilot-implementation-todo-projection.service";
import { associateMissionPilotImplementationRun } from "../../missionPilot/mission-pilot-run-association.service";
import * as repo from "../nightworkers.repository";
import { prepareTaskRunInProcess, startTaskRun } from "./start-task-run";
import { assertRunStatusTransition, runStatusTransitionTable } from "./status";
import { applyMissionPilotTaskStatusAfterRun } from "./task-status-projection-policy";
import { toErrorMessage } from "./utils";

function getSessionQueueMaxConcurrency() {
	return getSessionQueueMaxConcurrencyFromEnv();
}

export function shouldContinueSessionQueue(status: string) {
	return ["completed", "cancelled", "failed"].includes(status);
}

let implementationQueueDrainPromise: Promise<void> | null = null;
export const IMPLEMENTATION_QUEUE_LEASE_TTL_MS = 30 * 60 * 1000;
export const IMPLEMENTATION_QUEUE_HEARTBEAT_INTERVAL_MS = Math.min(
	60_000,
	Math.floor(IMPLEMENTATION_QUEUE_LEASE_TTL_MS / 3),
);
const implementationQueueLeaseOwnerRole =
	process.env.NIGHTWORKERS_EXECUTION_ROLE === "worker"
		? "worker-process"
		: "api-process";
const IMPLEMENTATION_QUEUE_LEASE_OWNER_ID = `${implementationQueueLeaseOwnerRole}:${process.pid}`;

export async function activatePreparedQueueRun<T>(input: {
	attach: () => Promise<T | null>;
	associate: () => Promise<void>;
	launch: (() => Promise<void>) | null;
}) {
	const attachment = await input.attach();
	if (!attachment) return { kind: "lease_conflict" as const };
	try {
		if (!input.launch) {
			return { kind: "not_launchable" as const, attachment };
		}
		await input.associate();
		await input.launch();
		return { kind: "launched" as const, attachment };
	} catch (error) {
		return { kind: "activation_failed" as const, attachment, error };
	}
}

export function resolveLeaseConflictRunStatus(currentStatus: string) {
	if (currentStatus === "needs_human") return "needs_human" as const;
	const transitions: Record<string, readonly string[]> =
		runStatusTransitionTable;
	return transitions[currentStatus]?.includes("cancelled")
		? ("cancelled" as const)
		: currentStatus;
}

async function failPreparedQueueRunBeforeLaunch(input: {
	runId: string;
	taskId: string;
	error: unknown;
}) {
	const latestRun = await repo.getTaskRun(input.runId);
	if (!latestRun) return;
	const nextStatus =
		latestRun.status === "needs_human" ? "needs_human" : "failed";
	if (["completed", "cancelled", "failed"].includes(latestRun.status)) {
		await completeImplementationQueueEntryForRun(input.runId, latestRun.status);
		return;
	}
	if (nextStatus === "needs_human") {
		await completeImplementationQueueEntryForRun(input.runId, nextStatus);
		return;
	}
	const errorMessage = toErrorMessage(input.error);
	assertRunStatusTransition(latestRun.status, "failed");
	const failedRun = await repo.updateTaskRunIfStatus(
		input.runId,
		latestRun.status,
		{
			status: "failed",
			endedAt: new Date(),
			finishedAt: new Date(),
			finalReport: `Implementation Queue failed before runtime launch: ${errorMessage}`,
			finalJudgment: null,
			summary: "Implementation Queue activation failed before runtime launch.",
		},
	);
	if (!failedRun) {
		const concurrentRun = await repo.getTaskRun(input.runId);
		if (concurrentRun) {
			await completeImplementationQueueEntryForRun(
				input.runId,
				concurrentRun.status,
			);
		}
		return;
	}
	await applyMissionPilotTaskStatusAfterRun({
		taskId: input.taskId,
		runId: input.runId,
		runStatus: "failed",
	});
	await completeImplementationQueueEntryForRun(input.runId, "failed");
}

export function shouldAutoDrainImplementationQueue(
	environment: NodeJS.ProcessEnv = process.env,
) {
	return environment.NIGHTWORKERS_QUEUE_WORKER !== "1";
}

export async function runImplementationQueue() {
	if (shouldUseIsolatedTaskExecutor()) {
		return runImplementationQueueInWorker();
	}
	return runImplementationQueueInProcess();
}

export async function runImplementationQueueInProcess() {
	if (implementationQueueDrainPromise) {
		await implementationQueueDrainPromise;
		return [];
	}
	const started: Awaited<ReturnType<typeof startTaskRun>>[] = [];
	implementationQueueDrainPromise = drainImplementationQueue(started).finally(
		() => {
			implementationQueueDrainPromise = null;
		},
	);
	await implementationQueueDrainPromise;
	return started;
}

async function drainImplementationQueue(
	started: Awaited<ReturnType<typeof startTaskRun>>[],
) {
	while (true) {
		const settings = await repo.getImplementationQueueSettings();
		const claimed = await repo.claimNextImplementationQueueEntry({
			processorCount: settings.processorCount,
			leaseOwnerId: IMPLEMENTATION_QUEUE_LEASE_OWNER_ID,
			leaseTtlMs: IMPLEMENTATION_QUEUE_LEASE_TTL_MS,
			allowExpiredClaimRecovery: false,
		});
		if (claimed.kind !== "claimed") break;
		const claimedEntry = claimed.entry;
		try {
			const missionPilot =
				await resolveMissionPilotImplementationStart(claimedEntry);
			if (missionPilot.kind === "blocked") {
				await holdBlockedMissionPilotImplementationStart({
					entry: claimedEntry,
					code: missionPilot.code,
					message: missionPilot.message,
					sessionGuard: missionPilot.sessionGuard,
				});
				await repo
					.createTaskMessage({
						taskId: claimedEntry.taskId,
						role: "system",
						content: `Implementation Queue held this task before run start: ${missionPilot.message}`,
						messageType: "text",
						payloadJson: {
							source: "implementation_queue",
							status: "mission_pilot_todo_projection_blocked",
							queueEntryId: claimedEntry.id,
							code: missionPilot.code,
						},
					})
					.catch(() => null);
				continue;
			}
			const missionPilotReady =
				missionPilot.kind === "ready" ? missionPilot : null;
			const prepared = await prepareTaskRunInProcess(claimedEntry.taskId, {
				executionMode: "implementation",
				executionModeSource: "implementation_queue",
				missionPilotAgent: claimedEntry.missionPilotAgentJson ?? undefined,
				...(missionPilotReady
					? {
							implementationPlanConstraint:
								missionPilotReady.implementationPlanProvenance,
							runtimeOptionsPatch: {
								missionPilot: missionPilotReady.envelope,
							},
						}
					: {}),
			});
			const run = prepared.run;
			const activation = await activatePreparedQueueRun({
				attach: () =>
					repo.markImplementationQueueEntryProcessing({
						entryId: claimedEntry.id,
						runId: run.id,
						leaseOwnerId: IMPLEMENTATION_QUEUE_LEASE_OWNER_ID,
						leaseVersion: claimedEntry.leaseVersion,
						leaseTtlMs: IMPLEMENTATION_QUEUE_LEASE_TTL_MS,
					}),
				associate: async () => {
					if (!missionPilotReady) return;
					const associated = await associateMissionPilotImplementationRun({
						taskId: claimedEntry.taskId,
						runId: run.id,
						missionPilot: missionPilotReady.envelope,
					});
					if (!associated) {
						throw new Error(
							"Mission Pilot could not claim the prepared Implementation run.",
						);
					}
				},
				launch: prepared.launch,
			});
			if (activation.kind === "lease_conflict") {
				const currentEntry = await repo.getImplementationQueueEntry(
					claimedEntry.id,
				);
				const latestRun = (await repo.getTaskRun(run.id)) ?? run;
				let nextRunStatus = resolveLeaseConflictRunStatus(latestRun.status);
				let cancellationApplied = false;
				if (nextRunStatus === "cancelled") {
					assertRunStatusTransition(latestRun.status, nextRunStatus);
					const cancelledRun = await repo.updateTaskRunIfStatus(
						run.id,
						latestRun.status,
						{
							status: nextRunStatus,
							endedAt: new Date(),
							finishedAt: new Date(),
							summary:
								"Implementation Queue lease changed before runtime launch.",
							finalReport:
								"Implementation Queue lease changed before run ownership was recorded; runtime was not launched.",
							finalJudgment: null,
						},
					);
					if (cancelledRun) {
						cancellationApplied = true;
					} else {
						const concurrentRun = await repo.getTaskRun(run.id);
						nextRunStatus = concurrentRun?.status ?? latestRun.status;
					}
				}
				if (cancellationApplied && !currentEntry?.activeRunId) {
					await repo.updateTaskStatus(claimedEntry.taskId, "queued");
				}
				await repo.createRunEvent({
					version: 1,
					runId: run.id,
					taskId: claimedEntry.taskId,
					timestamp: new Date().toISOString(),
					type: "system.warning",
					severity: "warning",
					actor: "system",
					message:
						"Implementation Queue lease changed before run ownership was recorded; runtime was not launched.",
					data: {
						source: "implementation_queue",
						queueEntryId: claimedEntry.id,
						leaseOwnerId: IMPLEMENTATION_QUEUE_LEASE_OWNER_ID,
						leaseVersion: claimedEntry.leaseVersion,
						actualStatus: currentEntry?.status ?? null,
						actualLeaseOwnerId: currentEntry?.leaseOwnerId ?? null,
						actualLeaseVersion: currentEntry?.leaseVersion ?? null,
						actualActiveRunId: currentEntry?.activeRunId ?? null,
						nextRunStatus,
						runtimeLaunched: false,
					},
				});
				await repo.createTaskMessage({
					taskId: claimedEntry.taskId,
					runId: run.id,
					role: "system",
					content:
						"Implementation Queue did not launch the prepared run because the lease changed.",
					messageType: "text",
					payloadJson: {
						source: "implementation_queue",
						status: "lease_conflict",
						queueEntryId: claimedEntry.id,
						runId: run.id,
					},
				});
				continue;
			}
			if (activation.kind === "activation_failed") {
				await failPreparedQueueRunBeforeLaunch({
					runId: run.id,
					taskId: claimedEntry.taskId,
					error: activation.error,
				});
				await repo
					.createTaskMessage({
						taskId: claimedEntry.taskId,
						runId: run.id,
						role: "system",
						content: `Implementation Queue failed before runtime launch: ${toErrorMessage(activation.error)}`,
						messageType: "text",
						payloadJson: {
							source: "implementation_queue",
							status: "activation_failed",
							queueEntryId: claimedEntry.id,
						},
					})
					.catch(() => null);
				continue;
			}
			if (activation.kind === "not_launchable") {
				await completeImplementationQueueEntryForRun(run.id, run.status);
				continue;
			}
			started.push(run);
			const processingEntry = activation.attachment;
			await repo
				.createTaskMessage({
					taskId: claimedEntry.taskId,
					runId: run.id,
					role: "system",
					content: `Implementation Queue processor ${processingEntry.processorSlot ?? 1} started this run.`,
					messageType: "text",
					payloadJson: {
						source: "implementation_queue",
						status: "processing",
						queueEntryId: claimedEntry.id,
						processorSlot: processingEntry.processorSlot,
						leaseOwnerId: processingEntry.leaseOwnerId,
						leaseVersion: processingEntry.leaseVersion,
					},
				})
				.catch(() => null);
		} catch (err) {
			await repo.recoverImplementationQueueEntryFromSnapshot(
				claimedEntry.id,
				{ status: "claimed", leaseVersion: claimedEntry.leaseVersion },
				{
					status: "failed",
					processorSlot: null,
					leaseOwnerId: null,
					leaseAcquiredAt: null,
					leaseExpiresAt: null,
					lastFailureKind: "start_task_run_failed",
					statusReason: err instanceof Error ? err.message : String(err),
				},
			);
			await repo.createTaskMessage({
				taskId: claimedEntry.taskId,
				role: "system",
				content: `Implementation Queue failed to start this task: ${
					err instanceof Error ? err.message : String(err)
				}`,
				messageType: "text",
				payloadJson: {
					source: "implementation_queue",
					status: "failed_to_start",
					queueEntryId: claimedEntry.id,
				},
			});
			break;
		}
	}
}

export async function completeImplementationQueueEntryForRun(
	runId: string,
	status: string,
) {
	try {
		const entry = await repo.getImplementationQueueEntryForRun(runId);
		if (!entry) return;
		const completed = await repo.completeImplementationQueueEntryForRunId({
			runId,
			runStatus: status,
		});
		const finalStatus = completed?.status ?? entry.status;
		if (
			["execution_completed", "cancelled", "failed"].includes(finalStatus) &&
			shouldAutoDrainImplementationQueue()
		) {
			void runImplementationQueue();
		}
	} catch {
		// Queue bookkeeping must not change the run outcome.
	}
}

export async function archiveImplementationQueueEntryForRun(runId: string) {
	try {
		const entry = await repo.getImplementationQueueEntryForRun(runId);
		if (
			!entry ||
			!["execution_completed", "failed", "cancelled"].includes(entry.status)
		)
			return;
		await repo.updateImplementationQueueEntry(entry.id, {
			status: "execution_archived",
			processorSlot: null,
			archivedAt: new Date(),
		});
	} catch {
		// Queue archive bookkeeping must not change the review outcome.
	}
}

const pendingSessionQueueRepositoryIds = new Set<string>();
let sessionQueueDrainPromise: Promise<void> | null = null;

export async function runSessionQueueForRepository(repositoryId: string) {
	const started: Awaited<ReturnType<typeof startTaskRun>>[] = [];
	pendingSessionQueueRepositoryIds.add(repositoryId);
	if (sessionQueueDrainPromise) {
		await sessionQueueDrainPromise;
		return started;
	}

	sessionQueueDrainPromise = drainPendingSessionQueues(started).finally(() => {
		sessionQueueDrainPromise = null;
	});
	await sessionQueueDrainPromise;
	return started;
}

async function drainPendingSessionQueues(
	started: Awaited<ReturnType<typeof startTaskRun>>[],
) {
	while (pendingSessionQueueRepositoryIds.size > 0) {
		const repositoryIds = [...pendingSessionQueueRepositoryIds];
		pendingSessionQueueRepositoryIds.clear();
		for (const repositoryId of repositoryIds) {
			started.push(...(await drainSessionQueueForRepository(repositoryId)));
		}
	}
}

async function drainSessionQueueForRepository(repositoryId: string) {
	const repository = await repo.getRepository(repositoryId);
	if (!repository?.queueEnabled) return [];

	const started: Awaited<ReturnType<typeof startTaskRun>>[] = [];
	while (true) {
		const globalActive = await repo.countActiveTaskRuns();
		const globalLimit = getSessionQueueMaxConcurrency();
		if (globalActive >= globalLimit) break;

		const projectActive = await repo.countActiveTaskRuns(repositoryId);
		const projectLimit = Math.max(
			1,
			Math.floor(repository.maxConcurrentSessions || 1),
		);
		if (projectActive >= projectLimit) break;

		const nextTask = await repo.claimNextQueuedTask(repositoryId);
		if (!nextTask) break;

		try {
			const run = await startTaskRun(nextTask.id, {
				executionMode: "implementation",
				executionModeSource: "session_queue",
			});
			started.push(run);
		} catch (err) {
			await repo.updateTaskStatus(nextTask.id, "failed");
			await repo.createTaskMessage({
				taskId: nextTask.id,
				role: "system",
				content: `Session queue failed to start this task: ${err instanceof Error ? err.message : String(err)}`,
				messageType: "text",
				payloadJson: { source: "session_queue", status: "failed_to_start" },
			});
			break;
		}
	}
	return started;
}
