import crypto from "node:crypto";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import type { MissionPilotTaskReadModel } from "../../../../shared/schemas/mission-pilot-agent.schema";
import { db } from "../../../db/client";
import { missionPilotSessions } from "../../../db/mission-pilot-schema";
import {
	implementationQueueEntries,
	repositories,
	taskMessages,
	taskRuns,
	tasks,
} from "../../../db/schema";
import { AppError } from "../../../lib/errors";
import { listDesignQuestionnaires } from "../../questionnaire/questionnaire.service";
import type { MissionPilotTaskReadPort } from "./mission-pilot-agent.ports";
import { sliceMissionPilotUtf8Page } from "./mission-pilot-content-page";
import {
	readMissionPilotRunChangeSummary,
	readMissionPilotRunOutcome,
	readMissionPilotRunVerification,
} from "./mission-pilot-run-outcome.adapter";
import { describeMissionPilotActions } from "./mission-pilot-task-action.registry";

const ACTIVE_RUN_STATUSES = [
	"running",
	"context_compiling",
	"finalizing",
] as const;
const TERMINAL_RUN_STATUSES = [
	"completed",
	"failed",
	"cancelled",
	"needs_review",
	"blocked",
	"timed_out",
	"needs_human",
] as const;

export const missionPilotTaskReadPort: MissionPilotTaskReadPort = {
	async readTaskWorkspace(input) {
		const [task] = await db
			.select()
			.from(tasks)
			.where(eq(tasks.id, input.taskId));
		const [session] = await db
			.select()
			.from(missionPilotSessions)
			.where(
				and(
					eq(missionPilotSessions.id, input.sessionId),
					eq(missionPilotSessions.taskId, input.taskId),
				),
			);
		if (!task || !session)
			throw new AppError(404, "TASK_NOT_FOUND", "Task workspace not found");
		const [project, messages, queueRows, activeRuns, terminalRuns] =
			await Promise.all([
				db.query.repositories.findFirst({
					where: eq(repositories.id, task.repositoryId),
				}),
				db
					.select()
					.from(taskMessages)
					.where(
						and(eq(taskMessages.taskId, task.id), isNull(taskMessages.runId)),
					)
					.orderBy(taskMessages.createdAt),
				db
					.select()
					.from(implementationQueueEntries)
					.where(eq(implementationQueueEntries.taskId, task.id))
					.orderBy(desc(implementationQueueEntries.createdAt)),
				db
					.select()
					.from(taskRuns)
					.where(
						and(
							eq(taskRuns.taskId, task.id),
							inArray(taskRuns.status, [...ACTIVE_RUN_STATUSES]),
						),
					)
					.orderBy(desc(taskRuns.startedAt)),
				db
					.select()
					.from(taskRuns)
					.where(
						and(
							eq(taskRuns.taskId, task.id),
							inArray(taskRuns.status, [...TERMINAL_RUN_STATUSES]),
						),
					)
					.orderBy(desc(taskRuns.startedAt))
					.limit(20),
			]);
		if (!project)
			throw new AppError(404, "PROJECT_NOT_FOUND", "Project not found");
		const artifacts = messages.filter((message) =>
			isPlanArtifactMetadata(asRecord(message.metadataJson)),
		);
		const questionnaire = await listDesignQuestionnaires(task.id).catch(
			() => [],
		);
		const terminalOutcomes = (
			await Promise.all(
				terminalRuns.map((run) =>
					readMissionPilotRunOutcome(run.id, { maxChars: 2_000 }),
				),
			)
		).filter(Boolean);
		const taskRevision = task.updatedAt.getTime();
		return {
			task: {
				id: task.id,
				title: task.title,
				description: task.description,
				objective: task.objective,
				acceptanceCriteria: task.acceptanceCriteria,
				status: task.status,
				revision: taskRevision,
			},
			project: {
				id: project.id,
				name: project.name,
				repositoryState: project.localPath ? "registered" : "missing",
			},
			currentView: latestCurrentView(messages),
			questionnaire: questionnaire.at(-1) ?? null,
			planArtifacts: artifacts.map((message, index) => {
				const metadata = asRecord(message.metadataJson);
				return {
					id: message.id,
					kind: artifactKind(metadata),
					revision: index + 1,
					title: nonEmpty(metadata.title),
				};
			}),
			queue: queueRows[0] ?? null,
			activeRun: activeRuns[0]
				? {
						id: activeRuns[0].id,
						status: activeRuns[0].status,
						startedAt: activeRuns[0].startedAt,
					}
				: null,
			terminalRuns: terminalOutcomes,
			availableActions: describeMissionPilotActions({
				authorization: session.authorizationJson,
				taskRevision,
				runtimeState: session.runtimeState,
			}),
		} satisfies MissionPilotTaskReadModel;
	},

	async readCurrentSpecification(taskId, options) {
		const messages = await listPlanMessages(taskId);
		const message = messages.findLast((candidate) => {
			const metadata = asRecord(candidate.metadataJson);
			return metadata.intent === "feature_plan";
		});
		return message
			? {
					messageId: message.id,
					revision: messages.filter(
						(candidate) =>
							asRecord(candidate.metadataJson).intent === "feature_plan",
					).length,
					digest: sha256(message.content),
					...pageContent(message.content, options),
					sourceArtifactRefs: readSourceRefs(asRecord(message.metadataJson)),
				}
			: null;
	},

	async readQuestionnaireDecisions(taskId) {
		const sessions = await listDesignQuestionnaires(taskId);
		const current = sessions.findLast((session) =>
			["review_ready", "accepted"].includes(session.status),
		);
		if (!current) return null;
		return {
			sessionId: current.id,
			status: current.status,
			decisions: current.answers.map((answer) => ({
				questionId: answer.questionId,
				answer: answer.answer,
				freeText: answer.answer.freeText ?? null,
			})),
			sourceRevision: current.questionSets.length,
		};
	},

	async readPlanArtifact(taskId, artifactId, options) {
		const [message] = await db
			.select()
			.from(taskMessages)
			.where(
				and(
					eq(taskMessages.id, artifactId),
					eq(taskMessages.taskId, taskId),
					isNull(taskMessages.runId),
				),
			);
		const metadata = asRecord(message?.metadataJson);
		if (!message || !isPlanArtifactMetadata(metadata))
			throw new AppError(
				404,
				"ARTIFACT_NOT_FOUND",
				"Current Plan Artifact not found",
			);
		return {
			id: message.id,
			kind: artifactKind(metadata),
			...pageContent(message.content, options),
			digest: sha256(message.content),
			metadata,
		};
	},

	readRunOutcome: readMissionPilotRunOutcome,
	readRunChangeSummary: readMissionPilotRunChangeSummary,
	readRunVerification: readMissionPilotRunVerification,

	async listAvailableTaskActions(input) {
		const model = await this.readTaskWorkspace(input);
		return model.availableActions;
	},
};

async function listPlanMessages(taskId: string) {
	return db
		.select()
		.from(taskMessages)
		.where(and(eq(taskMessages.taskId, taskId), isNull(taskMessages.runId)))
		.orderBy(taskMessages.createdAt);
}

function isPlanArtifactMetadata(metadata: Record<string, unknown>) {
	return (
		metadata.intent === "feature_plan" ||
		metadata.intent === "app_blueprint" ||
		metadata.intent === "mock_blueprint" ||
		metadata.artifactKind === "plan_mode_dedicated_view" ||
		metadata.artifactKind === "plan_mode_api_contract" ||
		metadata.artifactKind === "plan_mode_zod_schema"
	);
}

function artifactKind(metadata: Record<string, unknown>) {
	if (metadata.intent === "feature_plan") return "feature_plan";
	if (
		metadata.intent === "app_blueprint" ||
		metadata.intent === "mock_blueprint"
	)
		return "blueprint";
	return (
		nonEmpty(metadata.view) ?? nonEmpty(metadata.artifactKind) ?? "unknown"
	);
}

function latestCurrentView(messages: Array<{ metadataJson: unknown }>) {
	for (let index = messages.length - 1; index >= 0; index--) {
		const metadata = asRecord(messages[index]?.metadataJson);
		const view = nonEmpty(metadata.view) ?? nonEmpty(metadata.intent);
		if (view) return view;
	}
	return null;
}

function readSourceRefs(metadata: Record<string, unknown>) {
	return Object.entries(metadata).flatMap(([kind, id]) =>
		kind.endsWith("MessageId") && typeof id === "string" ? [{ kind, id }] : [],
	);
}

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}
function nonEmpty(value: unknown) {
	return typeof value === "string" && value.trim() ? value : null;
}
function sha256(value: string) {
	return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function pageContent(
	content: string,
	options?: { cursor?: number; maxChars?: number },
) {
	const page = sliceMissionPilotUtf8Page(content, {
		cursor: options?.cursor,
		maxChars: Math.min(24_000, Math.max(1_000, options?.maxChars ?? 16_000)),
		maxBytes: 16_000,
	});
	return {
		content: page.content,
		contentPage: page.page,
	};
}
