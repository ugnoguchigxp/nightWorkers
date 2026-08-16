import { and, desc, eq } from "drizzle-orm";
import { type DbTransaction, db } from "../../../db/client";
import { repositories, taskEvents, taskRuns, tasks } from "../../../db/schema";
import {
	codingAgentConditionConfirmations,
	verificationChecklistItems,
	verificationDocuments,
} from "../../../db/verification-schema";
import { AppError } from "../../../lib/errors";
import { captureWorkspaceSourceSnapshot } from "../verification/workspace-source-snapshot";

export async function recordManualConditionConfirmationsForReview(
	input: {
		taskId: string;
		runId: string;
		actorKind: "human_reviewer";
		actorId: string;
		evidenceRef: string;
	},
	database: typeof db | DbTransaction = db,
) {
	if (input.actorKind !== "human_reviewer") {
		throw new AppError(
			403,
			"manual_confirmation_actor_invalid",
			"Manual condition confirmation requires a human reviewer.",
		);
	}
	await assertCompletedHumanReview(input, database);
	const document = await database
		.select()
		.from(verificationDocuments)
		.where(
			and(
				eq(verificationDocuments.taskId, input.taskId),
				eq(verificationDocuments.status, "active"),
			),
		)
		.orderBy(desc(verificationDocuments.generatedAt))
		.limit(1)
		.then((rows) => rows[0]);
	if (!document) return { confirmationCount: 0, sourceSnapshot: null };
	const scope = await database
		.select({
			runWorktreePath: taskRuns.worktreePath,
			taskWorktreePath: tasks.worktreePath,
			repositoryPath: repositories.localPath,
		})
		.from(taskRuns)
		.innerJoin(tasks, eq(tasks.id, taskRuns.taskId))
		.innerJoin(repositories, eq(repositories.id, tasks.repositoryId))
		.where(and(eq(taskRuns.id, input.runId), eq(tasks.id, input.taskId)))
		.limit(1)
		.then((rows) => rows[0]);
	if (!scope)
		throw new Error("Manual condition confirmation scope was not found.");
	const repositoryRoot =
		scope.runWorktreePath || scope.taskWorktreePath || scope.repositoryPath;
	const sourceSnapshot = await captureWorkspaceSourceSnapshot(repositoryRoot);
	const conditions = await database
		.select()
		.from(verificationChecklistItems)
		.where(
			and(
				eq(verificationChecklistItems.verificationDocumentId, document.id),
				eq(verificationChecklistItems.verificationKind, "manual"),
			),
		);
	const required = conditions.filter((condition) => condition.required);
	if (required.length === 0) {
		return { confirmationCount: 0, sourceSnapshot };
	}
	await database
		.insert(codingAgentConditionConfirmations)
		.values(
			required.map((condition) => ({
				taskId: input.taskId,
				runId: input.runId,
				verificationDocumentId: document.id,
				conditionId: condition.conditionId,
				actorKind: input.actorKind,
				actorId: input.actorId,
				sourceStateHash: sourceSnapshot.sourceStateHash,
				evidenceRef: input.evidenceRef,
			})),
		)
		.onConflictDoNothing();
	return { confirmationCount: required.length, sourceSnapshot };
}

async function assertCompletedHumanReview(
	input: {
		taskId: string;
		runId: string;
		actorId: string;
		evidenceRef: string;
	},
	database: typeof db | DbTransaction = db,
) {
	if (input.evidenceRef !== `review-result:${input.actorId}`) {
		throw new AppError(
			409,
			"manual_confirmation_review_mismatch",
			"Manual confirmation evidence does not match the human review.",
		);
	}
	const events = await database
		.select({ actor: taskEvents.actor, payloadJson: taskEvents.payloadJson })
		.from(taskEvents)
		.where(eq(taskEvents.taskRunId, input.runId))
		.orderBy(desc(taskEvents.seq));
	const authorized = events.some((event) => {
		if (event.actor !== "human") return false;
		const review = asRecord(asRecord(event.payloadJson)?.reviewResult);
		const reviewer = asRecord(review?.reviewer);
		return (
			review?.id === input.actorId &&
			review.runId === input.runId &&
			review.taskId === input.taskId &&
			review.action === "complete" &&
			review.verdict === "approved" &&
			review.statusAfter === "completed" &&
			reviewer?.type === "human"
		);
	});
	if (!authorized) {
		throw new AppError(
			409,
			"manual_confirmation_review_missing",
			"A completed human review is required before recording manual confirmation.",
		);
	}
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}
