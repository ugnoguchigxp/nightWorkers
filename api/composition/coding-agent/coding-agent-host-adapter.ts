import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../db/client";
import { taskRuns } from "../../db/schema";
import { runCompletionCheck } from "../../modules/codingAgent/application/completion-check.service";
import type { CodingAgentHostPorts } from "../../modules/codingAgent/ports/coding-agent-host.port";
import type {
	CodingAgentRepositorySnapshot,
	CodingAgentRunSnapshot,
	CodingAgentRunTodoSnapshot,
	CodingAgentTaskSnapshot,
} from "../../modules/codingAgent/ports/coding-agent-host.types";
import * as nightworkers from "../../modules/nightworkers/nightworkers.repository";
import { publishTaskRunUpdate } from "../../modules/nightworkers/nightworkers.runs.repository";
import {
	createRunEvent,
	createTaskEvent,
} from "../../modules/nightworkers/nightworkers.runs-event.repository";
import { getLatestActiveVerificationDocumentForTask } from "../../modules/nightworkers/nightworkers.verification.repository";
import { resumeTaskRunTodo } from "../../modules/nightworkers/run-orchestration/resume-task-run";
import { startTaskRun } from "../../modules/nightworkers/run-orchestration/start-task-run-entry";
import { readArtifactOperatorContent } from "../../modules/specification";

/**
 * NightWorkers private repository/orchestration を Coding Agent の bounded port
 * へ投影する唯一の adapter。ここでのみ row と role module contract を接続する。
 */
export function createCodingAgentHostAdapter(): CodingAgentHostPorts {
	return {
		taskReader: {
			async getTask(taskId) {
				const task = await nightworkers.getTask(taskId);
				return task ? toTaskSnapshot(task) : null;
			},
			async getRepository(repositoryId) {
				const repository = await nightworkers.getRepository(repositoryId);
				return repository ? toRepositorySnapshot(repository) : null;
			},
			readArtifactContent: readArtifactOperatorContent,
		},
		runReader: {
			async getRun(runId) {
				const run = await nightworkers.getTaskRun(runId);
				return run ? toRunSnapshot(run) : null;
			},
			async listRunTodos(runId) {
				return (await nightworkers.listTaskRunTodosForRun(runId)).map(
					toTodoSnapshot,
				);
			},
		},
		runLifecycle: {
			async startRun(input) {
				return toRunSnapshot(
					await startTaskRun(input.taskId, {
						executionMode: input.executionMode,
						executionModeSource: "explicit",
						planModeRequested: input.planModeRequested,
						latestUserMessageOverride: input.instruction ?? undefined,
					}),
				);
			},
			async resumeRunTodo(input) {
				return toRunSnapshot(await resumeTaskRunTodo(input));
			},
			async resumeInterruptedRun(input) {
				return toRunSnapshot(
					await startTaskRun(input.taskId, {
						executionMode: "implementation",
						executionModeSource: "explicit",
						planModeRequested: input.planModeRequested,
						resumeRunId: input.runId,
						latestUserMessageOverride: input.userContext,
						resumeCommand: {
							kind: "process_interruption",
							expectedInterruptionRevision: input.expectedInterruptionRevision,
							todoId: input.todoId,
							expectedTodoRevision: input.expectedTodoRevision,
							userContext: input.userContext,
						},
					}),
				);
			},
			async updateRunContext(input) {
				const [updated] = await db
					.update(taskRuns)
					.set({
						contextSnapshot: input.contextSnapshot,
						updatedAt: new Date(),
					})
					.where(
						and(
							eq(taskRuns.id, input.runId),
							eq(taskRuns.updatedAt, input.expectedUpdatedAt),
							inArray(taskRuns.status, [...input.expectedStatuses]),
						),
					)
					.returning();
				if (updated) {
					await publishTaskRunUpdate(updated);
					return { kind: "applied", run: toRunSnapshot(updated) };
				}
				const current = await nightworkers.getTaskRun(input.runId);
				return current
					? { kind: "conflict", current: toRunSnapshot(current) }
					: { kind: "not_found" };
			},
		},
		runJournal: {
			async appendRunEvent(input) {
				await createRunEvent({
					version: 1,
					runId: input.runId,
					taskId: input.taskId,
					timestamp: input.timestamp,
					type: input.type,
					severity: input.severity,
					actor: input.actor,
					message: input.message,
					data: input.data,
				} as Parameters<typeof createRunEvent>[0]);
			},
			async appendTaskMessage(input) {
				await nightworkers.createTaskMessage({
					taskId: input.taskId,
					runId: input.runId,
					role: input.role,
					content: input.content,
					messageType: input.messageType,
					payloadJson: input.payloadJson,
				});
			},
			async publishRun(run) {
				const current = await nightworkers.getTaskRun(run.id);
				if (current) await publishTaskRunUpdate(current);
			},
			async appendTaskEvent(input) {
				const runId = input.taskRunId ?? input.runId;
				if (!runId)
					throw new Error("Coding Agent task event requires a Run id.");
				await createTaskEvent({
					taskRunId: runId,
					type: input.type,
					message: input.message,
					actor: input.actor,
					eventType: input.eventType,
					payloadJson: input.payloadJson,
					timestamp: input.timestamp,
				});
			},
		},
		verificationReader: {
			async getLatestActiveDocument(taskId) {
				const document =
					await getLatestActiveVerificationDocumentForTask(taskId);
				return document
					? {
							id: document.id,
							taskId: document.taskId,
							status: document.status,
							sourceStateHash: null,
							updatedAt: document.updatedAt,
						}
					: null;
			},
			async runCompletionCheck(input) {
				const result = await runCompletionCheck({
					taskId: input.taskId,
					runId: input.runId,
					verificationDocumentId: input.verificationDocumentId,
					repoRoot: input.repositoryRoot,
				});
				return {
					ok: result.ok,
					reason: result.reason ?? null,
					suggestedAction: result.suggestedAction ?? null,
					sourceStateHash: result.sourceStateHash,
					verify: { status: result.verify.status },
					confirmation: { status: result.confirmation.status },
				};
			},
		},
	};
}

function toTaskSnapshot(
	task: Awaited<ReturnType<typeof nightworkers.getTask>> & {},
) {
	return {
		id: task.id,
		repositoryId: task.repositoryId,
		revision: task.revision,
		status: task.status,
		title: task.title,
		description: task.description,
		objective: task.objective,
		acceptanceCriteria: task.acceptanceCriteria,
		timeoutSeconds: task.timeoutSeconds,
		priority: task.priority,
		worktreePath: task.worktreePath,
		currentRevisionSnapshotId: task.currentRevisionSnapshotId,
		updatedAt: task.updatedAt,
	} satisfies CodingAgentTaskSnapshot;
}

function toRepositorySnapshot(
	repository: Awaited<ReturnType<typeof nightworkers.getRepository>> & {},
) {
	return {
		id: repository.id,
		localPath: repository.localPath,
		branch: repository.branch,
		safetyPolicy: repository.safetyPolicy,
		queueEnabled: repository.queueEnabled,
		maxConcurrentSessions: repository.maxConcurrentSessions,
		updatedAt: repository.updatedAt,
	} satisfies CodingAgentRepositorySnapshot;
}

function toRunSnapshot(
	run: Awaited<ReturnType<typeof nightworkers.getTaskRun>> & {},
) {
	return {
		id: run.id,
		taskId: run.taskId,
		repositoryId: run.repositoryId,
		status: run.status,
		todoPlanRevision: run.todoPlanRevision,
		workerKind: run.workerKind,
		agentModeSessionId: run.agentModeSessionId,
		contextSnapshot: run.contextSnapshot,
		summary: run.summary,
		finalReport: run.finalReport,
		startedAt: run.startedAt,
		updatedAt: run.updatedAt,
	} satisfies CodingAgentRunSnapshot;
}

function toTodoSnapshot(
	todo: Awaited<ReturnType<typeof nightworkers.listTaskRunTodosForRun>>[number],
) {
	return {
		id: todo.id,
		runId: todo.runId,
		todoKey: todo.todoKey,
		seq: todo.seq,
		revision: todo.revision,
		status: todo.status,
		title: todo.title,
		description: todo.description,
		objective: todo.objective,
		taskType: todo.taskType,
		procedureId: todo.procedureId,
		context: todo.context,
		nextAction: todo.nextAction,
		acceptanceCriteria: todo.acceptanceCriteriaJson,
		dependsOn: todo.dependsOn,
		humanBlocker: todo.humanBlockerJson,
		lastFailure: todo.lastFailure,
		attemptCount: todo.attemptCount,
		statusReason: todo.statusReason,
		systemContextVersion: todo.systemContextVersion,
		systemContextSnapshot: todo.systemContextSnapshot,
	} satisfies CodingAgentRunTodoSnapshot;
}
