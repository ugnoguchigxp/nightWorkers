import { createHash } from "node:crypto";
import { and, asc, count, desc, eq, gte, isNull, max, sql } from "drizzle-orm";
import { TASK_OPERATOR_CONTENT_PAGE_SERIALIZED_CONTENT_BYTE_BUDGET } from "../../../../shared/modules/taskOperator";
import { db } from "../../../db/client";
import { repositories, taskMessages, tasks } from "../../../db/schema";
import { NotFoundError } from "../../../lib/errors";
import { sliceUtf8ContentPageToJsonBudget } from "../../agentsShare";

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
	const filter = and(
		eq(taskMessages.taskId, input.taskId),
		isNull(taskMessages.runId),
	);
	const [rows, [snapshot]] = await Promise.all([
		db
			.select({
				id: taskMessages.id,
				role: taskMessages.role,
				content: taskMessages.content,
				messageType: taskMessages.messageType,
				createdAt: taskMessages.createdAt,
			})
			.from(taskMessages)
			.where(filter)
			.orderBy(asc(taskMessages.createdAt), asc(sql<number>`rowid`))
			.limit(limit + 1)
			.offset(cursor),
		db
			.select({
				totalCount: count(),
				latestCreatedAt: max(taskMessages.createdAt),
			})
			.from(taskMessages)
			.where(filter),
	]);
	const hasMore = rows.length > limit;
	const candidates = rows.slice(0, limit).map((row) => ({
		id: row.id,
		role: row.role,
		content: row.content,
		contentDigest: digest(row.content),
		contentTruncated: false,
		messageType: row.messageType,
		createdAt: row.createdAt.toISOString(),
		revision: row.createdAt.getTime(),
	}));
	const entries: typeof candidates = [];
	for (const candidate of candidates) {
		const contentPage = (() => {
			try {
				return sliceUtf8ContentPageToJsonBudget(candidate.content, {
					maxChars: 12_000,
					maxSerializedBytes:
						TASK_OPERATOR_CONTENT_PAGE_SERIALIZED_CONTENT_BYTE_BUDGET,
					buildSerializedValue: (content, truncated) => ({
						entries: [
							...entries,
							{
								...candidate,
								content,
								contentTruncated: truncated,
							},
						],
					}),
				});
			} catch (error) {
				if (entries.length > 0 && error instanceof RangeError) return null;
				throw error;
			}
		})();
		if (!contentPage) break;
		const bounded = {
			...candidate,
			content: contentPage.content,
			contentTruncated: contentPage.page.truncated,
		};
		entries.push(bounded);
	}
	const pageHasMore = hasMore || entries.length < candidates.length;
	if (pageHasMore && entries.length === 0) {
		throw new RangeError(
			"Task timeline page cannot advance within the serialized content budget.",
		);
	}
	return {
		sourceRevision: snapshot?.latestCreatedAt?.getTime() ?? 0,
		sourceDigest: digest(
			JSON.stringify({
				totalCount: snapshot?.totalCount ?? 0,
				latestCreatedAt: snapshot?.latestCreatedAt?.toISOString() ?? null,
			}),
		),
		cursor,
		nextCursor: pageHasMore ? cursor + entries.length : null,
		hasMore: pageHasMore,
		entries,
	};
}

export async function readLatestTaskUserMessageAfter(input: {
	taskId: string;
	after: Date;
}) {
	const [message] = await db
		.select({
			id: taskMessages.id,
			content: taskMessages.content,
			createdAt: taskMessages.createdAt,
		})
		.from(taskMessages)
		.where(
			and(
				eq(taskMessages.taskId, input.taskId),
				eq(taskMessages.role, "user"),
				gte(taskMessages.createdAt, input.after),
			),
		)
		.orderBy(desc(taskMessages.createdAt), desc(sql<number>`rowid`))
		.limit(1);
	return message ?? null;
}

export async function readTaskMessageFact(input: {
	taskId: string;
	messageId: string;
}) {
	const [message] = await db
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
				eq(taskMessages.id, input.messageId),
				eq(taskMessages.taskId, input.taskId),
				isNull(taskMessages.runId),
			),
		)
		.limit(1);
	return message
		? {
				...message,
				revision: message.createdAt.getTime(),
				createdAt: message.createdAt.toISOString(),
				contentDigest: digest(message.content),
			}
		: null;
}

function digest(value: string) {
	return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
