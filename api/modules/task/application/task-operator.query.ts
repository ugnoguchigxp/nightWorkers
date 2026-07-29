import { and, asc, eq, isNull, ne } from "drizzle-orm";
import { db } from "../../../db/client";
import { repositories, taskMessages, tasks } from "../../../db/schema";
import { NotFoundError } from "../../../lib/errors";
import { sliceUtf8ContentPage } from "../../agentsShare";

export async function readTaskOperatorTask(taskId: string) {
	const [row] = await db
		.select({ task: tasks, repository: repositories })
		.from(tasks)
		.innerJoin(repositories, eq(repositories.id, tasks.repositoryId))
		.where(eq(tasks.id, taskId))
		.limit(1);
	if (!row) throw new NotFoundError("Task not found");
	return {
		id: row.task.id,
		revision: row.task.revision,
		status: row.task.status,
		title: row.task.title,
		objective: row.task.objective,
		acceptanceCriteria: row.task.acceptanceCriteria,
		repository: {
			id: row.repository.id,
			revision: row.repository.updatedAt.getTime(),
			state: row.repository.localPath
				? ("registered" as const)
				: ("missing" as const),
		},
	};
}

export async function readTaskTimelineFacts(input: {
	taskId: string;
	cursor?: number;
	limit?: number;
}) {
	const cursor = Math.max(0, input.cursor ?? 0);
	const limit = Math.min(50, Math.max(1, input.limit ?? 20));
	const rows = await db
		.select({
			id: taskMessages.id,
			role: taskMessages.role,
			content: taskMessages.content,
			messageType: taskMessages.messageType,
			createdAt: taskMessages.createdAt,
		})
		.from(taskMessages)
		.where(
			and(
				eq(taskMessages.taskId, input.taskId),
				isNull(taskMessages.runId),
				ne(taskMessages.messageType, "mission_pilot_initial_prompt"),
			),
		)
		.orderBy(asc(taskMessages.createdAt), asc(taskMessages.id))
		.limit(limit + 1)
		.offset(cursor);
	const hasMore = rows.length > limit;
	const candidates = rows.slice(0, limit).map((row) => ({
		id: row.id,
		role: row.role,
		content: row.content,
		messageType: row.messageType,
		createdAt: row.createdAt.toISOString(),
		revision: row.createdAt.getTime(),
	}));
	const entries: typeof candidates = [];
	for (const candidate of candidates) {
		const remainingBytes =
			12_000 - Buffer.byteLength(JSON.stringify(entries), "utf8");
		if (remainingBytes <= 1_000) break;
		const bounded = {
			...candidate,
			content: sliceUtf8ContentPage(candidate.content, {
				maxBytes: Math.max(1, remainingBytes - 500),
				maxChars: 12_000,
			}).content,
		};
		if (
			Buffer.byteLength(JSON.stringify([...entries, bounded]), "utf8") > 12_000
		)
			break;
		entries.push(bounded);
	}
	const pageHasMore = hasMore || entries.length < candidates.length;
	return {
		cursor,
		nextCursor: pageHasMore ? cursor + entries.length : null,
		hasMore: pageHasMore,
		entries,
	};
}
