import { createHash } from "node:crypto";
import { z } from "@hono/zod-openapi";
import {
	type TaskOperatorQueryContext,
	taskOperatorContentPageSchema,
} from "../../../../shared/modules/taskOperator";
import { sliceUtf8ContentPage } from "../../agentsShare";
import { listDesignQuestionnaires } from "../../questionnaire";
import { readQueueOperatorState } from "../../queue";
import { readRunOperatorOutcome, readRunOperatorState } from "../../run";
import {
	readArtifactOperatorContent,
	readArtifactOperatorIndex,
} from "../../specification";
import { readTaskOperatorTask, readTaskTimelineFacts } from "../../task";

const timelineContentSchema = z
	.object({
		entries: z.array(
			z
				.object({
					id: z.string(),
					role: z.string(),
					content: z.string().max(12_000),
					messageType: z.string().nullable(),
					createdAt: z.string(),
					revision: z.number().int().nonnegative(),
				})
				.strict(),
		),
	})
	.strict();
const artifactIndexContentSchema = z
	.object({
		artifacts: z.array(
			z
				.object({
					id: z.string(),
					kind: z.string(),
					revision: z.number().int().nonnegative(),
					digest: z.string(),
					status: z.string(),
				})
				.strict(),
		),
	})
	.strict();
const artifactContentSchema = z
	.object({
		id: z.string(),
		kind: z.string(),
		revision: z.number().int().nonnegative(),
		digest: z.string(),
		status: z.string(),
		text: z.string().max(12_000),
		truncated: z.boolean(),
	})
	.strict();
const taskTextContentSchema = z
	.object({
		field: z.enum(["objective", "acceptance_criteria"]),
		text: z.string().max(12_000),
		truncated: z.boolean(),
	})
	.strict();
const jsonPageContentSchema = z
	.object({ json: z.string().max(12_000) })
	.strict();

export async function readTaskOperatorResource(input: {
	taskId: string;
	resourceKind: string;
	resourceId?: string;
	cursor?: number;
	limit?: number;
	context: TaskOperatorQueryContext;
}) {
	void input.context;
	switch (input.resourceKind) {
		case "task_text": {
			if (
				input.resourceId !== "objective" &&
				input.resourceId !== "acceptance_criteria"
			)
				throw new Error(
					"task_text resourceId must be objective or acceptance_criteria",
				);
			const task = await readTaskOperatorTask(input.taskId);
			const value =
				input.resourceId === "objective"
					? (task.objective ?? "")
					: (task.acceptanceCriteria ?? "");
			const page = sliceUtf8ContentPage(value, {
				cursor: input.cursor,
				maxBytes: 12_000,
				maxChars: 4_000,
			});
			return pageResult(
				taskTextContentSchema,
				{ kind: "task_text", id: input.resourceId },
				task.revision,
				page.page.cursor,
				page.page.nextCursor,
				page.page.truncated,
				{
					field: input.resourceId,
					text: page.content,
					truncated: page.page.truncated,
				},
				digest(value),
			);
		}
		case "task_timeline": {
			const [task, page] = await Promise.all([
				readTaskOperatorTask(input.taskId),
				readTaskTimelineFacts({
					taskId: input.taskId,
					cursor: input.cursor,
					limit: input.limit,
				}),
			]);
			return pageResult(
				timelineContentSchema,
				{ kind: "task_timeline", id: input.taskId },
				task.revision,
				page.cursor,
				page.nextCursor,
				page.hasMore,
				{ entries: page.entries },
			);
		}
		case "artifact_index": {
			const page = await readArtifactOperatorIndex({
				taskId: input.taskId,
				cursor: input.cursor,
				limit: input.limit,
			});
			return pageResult(
				artifactIndexContentSchema,
				{ kind: "artifact_index", id: input.taskId },
				page.revision,
				Math.max(0, input.cursor ?? 0),
				page.nextCursor,
				page.nextCursor !== null,
				{ artifacts: page.page },
			);
		}
		case "artifact": {
			if (!input.resourceId) throw new Error("artifact resourceId is required");
			const artifact = await readArtifactOperatorContent({
				taskId: input.taskId,
				artifactId: input.resourceId,
			});
			if (!artifact) throw new Error("Artifact not found");
			const page = sliceUtf8ContentPage(artifact.content, {
				cursor: input.cursor,
				maxBytes: 12_000,
				maxChars: 12_000,
			});
			return pageResult(
				artifactContentSchema,
				{ kind: "artifact", id: artifact.id },
				artifact.revision,
				page.page.cursor,
				page.page.nextCursor,
				page.page.truncated,
				{
					id: artifact.id,
					kind: artifact.kind,
					revision: artifact.revision,
					digest: artifact.digest,
					status: artifact.status,
					text: page.content,
					truncated: page.page.truncated,
				},
			);
		}
		case "questionnaire_decisions": {
			const sessions = await listDesignQuestionnaires(input.taskId);
			const current = sessions.find((session) =>
				["review_ready", "accepted"].includes(session.status),
			);
			const content = current
				? {
						id: current.id,
						status: current.status,
						answers: current.answers.map((answer) => ({
							questionId: answer.questionId,
							answer: answer.answer,
						})),
					}
				: null;
			return boundedObjectPage(
				{ kind: "questionnaire_decisions", id: current?.id ?? input.taskId },
				current ? new Date(current.updatedAt).getTime() : 0,
				content,
				input.cursor,
			);
		}
		case "run_outcome": {
			if (!input.resourceId) throw new Error("run resourceId is required");
			const outcome = await readRunOperatorOutcome({
				taskId: input.taskId,
				runId: input.resourceId,
			});
			if (!outcome) throw new Error("Run not found");
			return boundedObjectPage(
				{ kind: "run_outcome", id: outcome.id },
				outcome.revision,
				outcome,
				input.cursor,
			);
		}
		case "current_todo": {
			const run = await readRunOperatorState(input.taskId);
			return boundedObjectPage(
				{
					kind: "current_todo",
					id: run.active?.currentTodo?.id ?? input.taskId,
				},
				run.active?.currentTodo?.revision ?? 0,
				run.active?.currentTodo ?? null,
				input.cursor,
			);
		}
		case "queue": {
			const queue = await readQueueOperatorState(input.taskId);
			return boundedObjectPage(
				{ kind: "queue", id: queue?.id ?? input.taskId },
				queue?.revision ?? 0,
				queue,
				input.cursor,
			);
		}
		default:
			throw new Error(
				`Unsupported Task Operator resource: ${input.resourceKind}`,
			);
	}
}

function pageResult<T extends z.ZodType>(
	contentSchema: T,
	sourceRef: { kind: string; id: string },
	sourceRevision: number,
	cursor: number,
	nextCursor: number | null,
	hasMore: boolean,
	content: z.input<T>,
	stableSourceDigest?: string,
) {
	const sourceDigest = stableSourceDigest ?? digest(JSON.stringify(content));
	const tokenEstimate = estimateTokens(content);
	return taskOperatorContentPageSchema(contentSchema).parse({
		sourceRef,
		sourceRevision,
		sourceDigest,
		cursor,
		nextCursor,
		hasMore,
		tokenEstimate,
		content,
	});
}

function boundedObjectPage(
	sourceRef: { kind: string; id: string },
	sourceRevision: number,
	content: unknown,
	requestedCursor?: number,
) {
	const serialized = JSON.stringify(content);
	const page = sliceUtf8ContentPage(serialized, {
		cursor: requestedCursor,
		maxBytes: 12_000,
		maxChars: 12_000,
	});
	return taskOperatorContentPageSchema(jsonPageContentSchema).parse({
		sourceRef,
		sourceRevision,
		sourceDigest: digest(serialized),
		cursor: page.page.cursor,
		nextCursor: page.page.nextCursor,
		hasMore: page.page.truncated,
		tokenEstimate: estimateTokens({ json: page.content }),
		content: { json: page.content },
	});
}
function estimateTokens(value: unknown) {
	return Math.ceil(Buffer.byteLength(JSON.stringify(value), "utf8") / 4);
}
function digest(value: string) {
	return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
