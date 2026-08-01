import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../../../db/client";
import {
	activityArtifacts,
	taskRunCommitRecords,
	taskRuns,
} from "../../../db/schema";
import { taskRunTodos } from "../../../db/schema-task-execution";
import { verificationEvidenceRuns } from "../../../db/verification-schema";
import { digestText } from "../../../services/text-digest";

const activeStatuses = [
	"running",
	"context_compiling",
	"finalizing",
	"needs_human",
] as const;
const terminalStatuses = [
	"completed",
	"failed",
	"cancelled",
	"needs_review",
	"blocked",
	"timed_out",
] as const;

export async function readRunOperatorState(taskId: string) {
	const [activeRows, terminalRows] = await Promise.all([
		db
			.select()
			.from(taskRuns)
			.where(
				and(
					eq(taskRuns.taskId, taskId),
					inArray(taskRuns.status, [...activeStatuses]),
				),
			)
			.orderBy(desc(taskRuns.startedAt))
			.limit(1),
		db
			.select()
			.from(taskRuns)
			.where(
				and(
					eq(taskRuns.taskId, taskId),
					inArray(taskRuns.status, [...terminalStatuses]),
				),
			)
			.orderBy(desc(taskRuns.startedAt))
			.limit(1),
	]);
	const active = activeRows[0] ?? null;
	const currentTodo = active
		? await db
				.select()
				.from(taskRunTodos)
				.where(
					and(
						eq(taskRunTodos.runId, active.id),
						inArray(taskRunTodos.status, ["running", "needs_human"]),
					),
				)
				.orderBy(desc(taskRunTodos.updatedAt))
				.limit(1)
				.then((rows) => rows[0] ?? null)
		: null;
	const terminal = terminalRows[0] ?? null;
	return {
		active: active
			? {
					id: active.id,
					revision: active.updatedAt.getTime(),
					status: active.status,
					currentTodo: currentTodo
						? {
								id: currentTodo.id,
								revision: currentTodo.revision,
								status: currentTodo.status,
								blockerDigest: currentTodo.lastFailure
									? digestText(currentTodo.lastFailure)
									: null,
							}
						: null,
				}
			: null,
		terminal: terminal
			? {
					id: terminal.id,
					revision: terminal.updatedAt.getTime(),
					status: terminal.status,
					outcomeDigest: digestText(
						terminal.finalReport ?? terminal.summary ?? terminal.status,
					),
				}
			: null,
	};
}

export async function readLatestTaskRunReference(taskId: string) {
	const [run] = await db
		.select({ runId: taskRuns.id, updatedAt: taskRuns.updatedAt })
		.from(taskRuns)
		.where(eq(taskRuns.taskId, taskId))
		.orderBy(desc(taskRuns.startedAt))
		.limit(1);
	return run ?? null;
}

export async function readRunOperatorOutcome(input: {
	taskId: string;
	runId: string;
}) {
	const [run] = await db
		.select({
			id: taskRuns.id,
			taskId: taskRuns.taskId,
			status: taskRuns.status,
			updatedAt: taskRuns.updatedAt,
			summary: taskRuns.summary,
			finalReport: taskRuns.finalReport,
			finalJudgment: taskRuns.finalJudgment,
		})
		.from(taskRuns)
		.where(and(eq(taskRuns.id, input.runId), eq(taskRuns.taskId, input.taskId)))
		.limit(1);
	if (!run) return null;
	const [todos, commitRecords, verification, artifacts] = await Promise.all([
		db
			.select({
				id: taskRunTodos.id,
				status: taskRunTodos.status,
				statusReason: taskRunTodos.statusReason,
				lastFailure: taskRunTodos.lastFailure,
				revision: taskRunTodos.revision,
			})
			.from(taskRunTodos)
			.where(eq(taskRunTodos.runId, run.id))
			.orderBy(desc(taskRunTodos.updatedAt))
			.limit(1),
		db
			.select({
				ownedCandidatePaths: taskRunCommitRecords.ownedCandidatePathsJson,
				stageableOwnedPaths: taskRunCommitRecords.stageableOwnedPathsJson,
				excludedPaths: taskRunCommitRecords.excludedPathsJson,
				verificationStatus: taskRunCommitRecords.verificationStatus,
				statusReason: taskRunCommitRecords.statusReason,
				commitSha: taskRunCommitRecords.commitSha,
			})
			.from(taskRunCommitRecords)
			.where(eq(taskRunCommitRecords.runId, run.id))
			.limit(1),
		db
			.select({
				id: verificationEvidenceRuns.id,
				checkKind: verificationEvidenceRuns.checkKind,
				exitCode: verificationEvidenceRuns.exitCode,
				runner: verificationEvidenceRuns.runner,
				summary: verificationEvidenceRuns.summaryJson,
				testExecutionObserved: verificationEvidenceRuns.testExecutionObserved,
				sourceMutatedDuringCheck:
					verificationEvidenceRuns.sourceMutatedDuringCheck,
				startedAt: verificationEvidenceRuns.startedAt,
				finishedAt: verificationEvidenceRuns.finishedAt,
			})
			.from(verificationEvidenceRuns)
			.where(
				and(
					eq(verificationEvidenceRuns.taskId, input.taskId),
					eq(verificationEvidenceRuns.runId, run.id),
				),
			)
			.orderBy(desc(verificationEvidenceRuns.finishedAt))
			.limit(20),
		db
			.select({
				id: activityArtifacts.id,
				kind: activityArtifacts.kind,
				path: activityArtifacts.path,
				createdAt: activityArtifacts.createdAt,
			})
			.from(activityArtifacts)
			.where(
				and(
					eq(activityArtifacts.taskId, input.taskId),
					eq(activityArtifacts.runId, run.id),
				),
			)
			.orderBy(desc(activityArtifacts.createdAt))
			.limit(50),
	]);
	const todo = todos[0] ?? null;
	const commit = commitRecords[0] ?? null;
	return {
		id: run.id,
		revision: run.updatedAt.getTime(),
		status: run.status,
		summary: run.summary,
		finalReport: run.finalReport,
		finalJudgment: run.finalJudgment,
		blocker:
			todo &&
			(todo.status === "needs_human" ||
				todo.lastFailure !== null ||
				todo.statusReason !== null)
				? {
						todoId: todo.id,
						revision: todo.revision,
						status: todo.status,
						reason: todo.lastFailure ?? todo.statusReason,
					}
				: null,
		verification: {
			status: commit?.verificationStatus ?? "not_recorded",
			statusReason: commit?.statusReason ?? null,
			checks: verification.map((check) => ({
				...check,
				startedAt: check.startedAt.toISOString(),
				finishedAt: check.finishedAt.toISOString(),
			})),
		},
		changedPaths: Array.from(
			new Set([
				...(commit?.ownedCandidatePaths ?? []),
				...(commit?.stageableOwnedPaths ?? []),
			]),
		),
		excludedPaths: commit?.excludedPaths ?? [],
		commitSha: commit?.commitSha ?? null,
		artifactRefs: artifacts.map((artifact) => ({
			id: artifact.id,
			kind: artifact.kind,
			path: artifact.path,
			createdAt: artifact.createdAt.toISOString(),
		})),
	};
}
