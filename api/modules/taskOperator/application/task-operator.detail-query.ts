import { createHash } from "node:crypto";
import { z } from "@hono/zod-openapi";
import {
	TASK_OPERATOR_CONTENT_PAGE_SERIALIZED_CONTENT_BYTE_BUDGET,
	TASK_OPERATOR_CONTENT_PAGE_TOKEN_BUDGET,
	type TaskOperatorQueryContext,
	taskOperatorContentPageSchema,
} from "../../../../shared/modules/taskOperator";
import {
	designQuestionDependencySchema,
	designQuestionnaireAnswerSchema,
	designQuestionOptionSchema,
} from "../../../../shared/schemas/design-questionnaire.schema";
import { AppError } from "../../../lib/errors";
import { sliceUtf8ContentPageToJsonBudget } from "../../agentsShare";
import {
	getDesignQuestionnaireSession,
	listDesignQuestionnaires,
} from "../../questionnaire";
import { readQueueOperatorState } from "../../queue";
import {
	readRunOperatorOutcome,
	readRunOperatorState,
} from "../../run/application/run-operator.query";
import {
	readArtifactOperatorContent,
	readArtifactOperatorIndex,
} from "../../specification";
import {
	readTaskMessageFact,
	readTaskOperatorTask,
	readTaskTimelineFacts,
} from "../../task";
import {
	resolveTaskOperatorPrincipalCapabilities,
	type TaskOperatorDelegatedAuthorizationPort,
} from "../policies/task-operator-authorization";

const timelineContentSchema = z
	.object({
		entries: z.array(
			z
				.object({
					id: z.string(),
					role: z.string(),
					content: z.string().max(12_000),
					contentDigest: z.string(),
					contentTruncated: z.boolean(),
					messageType: z.string().nullable(),
					createdAt: z.string(),
					revision: z.number().int().nonnegative(),
				})
				.strict(),
		),
	})
	.strict();
const taskMessageContentSchema = z
	.object({
		id: z.string(),
		role: z.string(),
		messageType: z.string().nullable(),
		text: z.string().max(12_000),
		truncated: z.boolean(),
		createdAt: z.string(),
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
const questionnairePageContentSchema = z
	.object({
		id: z.string().uuid(),
		taskId: z.string().uuid(),
		repositoryId: z.string().uuid(),
		status: z.string(),
		totalQuestionCount: z.number().int().nonnegative(),
		questions: z.array(
			z
				.object({
					id: z.string(),
					question: z.string(),
					why: z.string(),
					answerType: z.enum([
						"single_choice",
						"multi_choice",
						"boolean",
						"free_text",
						"ranked",
					]),
					recommendedAnswerId: z.string().optional(),
					options: z.array(designQuestionOptionSchema).optional(),
					allowsCustomAnswer: z.boolean().optional(),
					dependsOn: z.array(designQuestionDependencySchema).optional(),
				})
				.strict(),
		),
		answers: z.array(
			z
				.object({
					questionId: z.string(),
					answer: designQuestionnaireAnswerSchema,
				})
				.strict(),
		),
	})
	.strict();

export const TASK_OPERATOR_RESOURCE_KINDS = [
	"task_text",
	"task_timeline",
	"task_message",
	"artifact_index",
	"artifact",
	"questionnaire",
	"questionnaire_decisions",
	"run_outcome",
	"current_todo",
	"queue",
] as const;

export async function readTaskOperatorResource(input: {
	taskId: string;
	resourceKind: string;
	resourceId?: string;
	cursor?: number;
	limit?: number;
	context: TaskOperatorQueryContext;
	delegatedAuthorization?: TaskOperatorDelegatedAuthorizationPort;
}) {
	await resolveTaskOperatorPrincipalCapabilities({
		principal: input.context.principal,
		taskId: input.taskId,
		delegatedAuthorization: input.delegatedAuthorization,
	});
	switch (input.resourceKind) {
		case "task_text": {
			if (
				input.resourceId !== "objective" &&
				input.resourceId !== "acceptance_criteria"
			)
				throw new AppError(
					422,
					"TASK_OPERATOR_RESOURCE_ARGUMENT_INVALID",
					"task_text resourceId must be objective or acceptance_criteria",
				);
			const task = await readTaskOperatorTask(input.taskId);
			const value =
				input.resourceId === "objective"
					? (task.objective ?? "")
					: (task.acceptanceCriteria ?? "");
			const page = boundedTextPage(value, {
				cursor: input.cursor,
				maxChars: 4_000,
				buildContent: (text, truncated) => ({
					field: input.resourceId,
					text,
					truncated,
				}),
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
			const page = await readTaskTimelineFacts({
				taskId: input.taskId,
				cursor: input.cursor,
				limit: input.limit,
			});
			return pageResult(
				timelineContentSchema,
				{ kind: "task_timeline", id: input.taskId },
				page.sourceRevision,
				page.cursor,
				page.nextCursor,
				page.hasMore,
				{ entries: page.entries },
				page.sourceDigest,
			);
		}
		case "task_message": {
			if (!input.resourceId) throw resourceIdRequired("task_message");
			const message = await readTaskMessageFact({
				taskId: input.taskId,
				messageId: input.resourceId,
			});
			if (!message) throw resourceNotFound("Task message");
			const page = boundedTextPage(message.content, {
				cursor: input.cursor,
				maxChars: 4_000,
				buildContent: (text, truncated) => ({
					id: message.id,
					role: message.role,
					messageType: message.messageType,
					text,
					truncated,
					createdAt: message.createdAt,
				}),
			});
			return pageResult(
				taskMessageContentSchema,
				{ kind: "task_message", id: message.id },
				message.revision,
				page.page.cursor,
				page.page.nextCursor,
				page.page.truncated,
				{
					id: message.id,
					role: message.role,
					messageType: message.messageType,
					text: page.content,
					truncated: page.page.truncated,
					createdAt: message.createdAt,
				},
				message.contentDigest,
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
				digest(
					JSON.stringify({
						revision: page.revision,
						totalCount: page.totalCount,
					}),
				),
			);
		}
		case "artifact": {
			if (!input.resourceId) throw resourceIdRequired("artifact");
			const artifact = await readArtifactOperatorContent({
				taskId: input.taskId,
				artifactId: input.resourceId,
			});
			if (!artifact) throw resourceNotFound("Artifact");
			const page = boundedTextPage(artifact.content, {
				cursor: input.cursor,
				maxChars: 12_000,
				buildContent: (text, truncated) => ({
					id: artifact.id,
					kind: artifact.kind,
					revision: artifact.revision,
					digest: artifact.digest,
					status: artifact.status,
					text,
					truncated,
				}),
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
				artifact.digest,
			);
		}
		case "questionnaire": {
			if (!input.resourceId) throw resourceIdRequired("questionnaire");
			const questionnaire = await getDesignQuestionnaireSession(
				input.taskId,
				input.resourceId,
			);
			return questionnaireContentPage(
				{ kind: "questionnaire", id: questionnaire.id },
				new Date(questionnaire.updatedAt).getTime(),
				questionnaire,
				input.cursor,
				input.limit,
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
			if (!input.resourceId) throw resourceIdRequired("run_outcome");
			const outcome = await readRunOperatorOutcome({
				taskId: input.taskId,
				runId: input.resourceId,
			});
			if (!outcome) throw resourceNotFound("Run");
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
			throw new AppError(
				422,
				"TASK_OPERATOR_RESOURCE_UNSUPPORTED",
				`Unsupported Task Operator resource: ${input.resourceKind}`,
			);
	}
}

function resourceIdRequired(kind: string) {
	return new AppError(
		422,
		"TASK_OPERATOR_RESOURCE_ARGUMENT_INVALID",
		`${kind} resourceId is required`,
	);
}

function resourceNotFound(label: string) {
	return new AppError(
		404,
		"TASK_OPERATOR_RESOURCE_NOT_FOUND",
		`${label} not found`,
	);
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
	const basePage = {
		sourceRef,
		sourceRevision,
		sourceDigest,
		cursor,
		nextCursor,
		hasMore,
		tokenEstimate: 0,
		content,
	};
	const tokenEstimate = estimateTokens({
		...basePage,
		tokenEstimate: TASK_OPERATOR_CONTENT_PAGE_TOKEN_BUDGET,
	});
	if (tokenEstimate > TASK_OPERATOR_CONTENT_PAGE_TOKEN_BUDGET) {
		throw new AppError(
			500,
			"TASK_OPERATOR_CONTENT_PAGE_BUDGET_EXCEEDED",
			"Task Operator content page exceeds its serialized response budget.",
		);
	}
	return taskOperatorContentPageSchema(contentSchema).parse({
		...basePage,
		tokenEstimate,
	});
}

function boundedObjectPage(
	sourceRef: { kind: string; id: string },
	sourceRevision: number,
	content: unknown,
	requestedCursor?: number,
) {
	const serialized = JSON.stringify(content);
	const page = boundedTextPage(serialized, {
		cursor: requestedCursor,
		maxChars: 12_000,
		buildContent: (json) => ({ json }),
	});
	return pageResult(
		jsonPageContentSchema,
		sourceRef,
		sourceRevision,
		page.page.cursor,
		page.page.nextCursor,
		page.page.truncated,
		{ json: page.content },
		digest(serialized),
	);
}

function questionnaireContentPage(
	sourceRef: { kind: string; id: string },
	sourceRevision: number,
	questionnaire: Awaited<ReturnType<typeof getDesignQuestionnaireSession>>,
	requestedCursor?: number,
	requestedLimit?: number,
) {
	const questions = questionnaire.questionSets.flatMap((questionSet) =>
		(questionSet.questionnaire?.questionSets ?? []).flatMap((group) =>
			group.questions.map((question) => ({
				id: question.id,
				question: question.question,
				why: question.why,
				answerType: question.answerType,
				recommendedAnswerId: question.recommendedAnswerId,
				options: question.options,
				allowsCustomAnswer: question.allowsCustomAnswer,
				dependsOn: question.dependsOn,
			})),
		),
	);
	const cursor = Math.max(0, requestedCursor ?? 0);
	if (cursor > questions.length)
		throw new AppError(
			422,
			"TASK_OPERATOR_RESOURCE_CURSOR_INVALID",
			"questionnaire cursor must be 0 or a nextCursor returned by the preceding page.",
		);
	const limit = Math.min(100, Math.max(1, requestedLimit ?? 100));
	const stableSourceDigest = digest(JSON.stringify(questionnaire));
	const answers = questionnaire.answers.map((answer) => ({
		questionId: answer.questionId,
		answer: answer.answer,
	}));
	const minimumEnd = cursor < questions.length ? cursor + 1 : cursor;
	for (
		let end = Math.min(questions.length, cursor + limit);
		end >= minimumEnd;
		end -= 1
	) {
		const nextCursor = end < questions.length ? end : null;
		const content = {
			id: questionnaire.id,
			taskId: questionnaire.taskId,
			repositoryId: questionnaire.repositoryId,
			status: questionnaire.status,
			totalQuestionCount: questions.length,
			questions: questions.slice(cursor, end),
			answers,
		};
		if (
			Buffer.byteLength(
				JSON.stringify({
					sourceRef,
					sourceRevision,
					sourceDigest: stableSourceDigest,
					cursor,
					nextCursor,
					hasMore: nextCursor !== null,
					tokenEstimate: TASK_OPERATOR_CONTENT_PAGE_TOKEN_BUDGET,
					content,
				}),
				"utf8",
			) > TASK_OPERATOR_CONTENT_PAGE_SERIALIZED_CONTENT_BYTE_BUDGET
		)
			continue;
		const page = pageResult(
			questionnairePageContentSchema,
			sourceRef,
			sourceRevision,
			cursor,
			nextCursor,
			nextCursor !== null,
			content,
			stableSourceDigest,
		);
		return page;
	}
	throw new AppError(
		413,
		"TASK_OPERATOR_CONTENT_PAGE_BUDGET_EXCEEDED",
		"A single Questionnaire question exceeds the Task Operator response budget.",
	);
}

function boundedTextPage<T>(
	content: string,
	options: {
		cursor?: number;
		maxChars: number;
		buildContent: (text: string, truncated: boolean) => T;
	},
) {
	return sliceUtf8ContentPageToJsonBudget(content, {
		cursor: options.cursor,
		maxChars: options.maxChars,
		maxSerializedBytes:
			TASK_OPERATOR_CONTENT_PAGE_SERIALIZED_CONTENT_BYTE_BUDGET,
		buildSerializedValue: options.buildContent,
	});
}

function estimateTokens(value: unknown) {
	return Math.ceil(Buffer.byteLength(JSON.stringify(value), "utf8") / 4);
}
function digest(value: string) {
	return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
