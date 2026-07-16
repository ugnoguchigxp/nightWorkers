import crypto from "node:crypto";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import type { MissionPilotTaskReadModel } from "../../../../shared/modules/missionPilot";
import { db } from "../../../db/client";
import { missionPilotAgentSessions } from "../../../db/mission-pilot-agent-schema";
import { missionPilotSessions } from "../../../db/mission-pilot-schema";
import {
	implementationQueueEntries,
	repositories,
	taskMessages,
	taskRuns,
	tasks,
} from "../../../db/schema";
import { listDesignQuestionnaires } from "../../questionnaire/questionnaire.service";
import type { MissionPilotTaskReadPort } from "./mission-pilot-agent.ports";
import { sliceMissionPilotUtf8Page } from "./mission-pilot-content-page";
import {
	readMissionPilotRunChangeSummary,
	readMissionPilotRunOutcome,
	readMissionPilotRunVerification,
} from "./mission-pilot-run-outcome.adapter";
import { describeMissionPilotActions } from "./mission-pilot-task-action.registry";

const activeStatuses = ["running", "context_compiling", "finalizing"] as const;
const terminalStatuses = [
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
		const [agent] = await db
			.select({ runtimeState: missionPilotAgentSessions.runtimeState })
			.from(missionPilotAgentSessions)
			.where(eq(missionPilotAgentSessions.sessionId, input.sessionId));
		if (!task || !session) throw new Error("Task workspace not found");
		const [project, messages, queue, activeRuns, terminalRuns] =
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
					.orderBy(desc(implementationQueueEntries.createdAt))
					.limit(1),
				db
					.select()
					.from(taskRuns)
					.where(
						and(
							eq(taskRuns.taskId, task.id),
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
							eq(taskRuns.taskId, task.id),
							inArray(taskRuns.status, [...terminalStatuses]),
						),
					)
					.orderBy(desc(taskRuns.startedAt))
					.limit(20),
			]);
		if (!project) throw new Error("Project not found");
		const questionnaire = await listDesignQuestionnaires(task.id).catch(
			() => [],
		);
		const artifacts = messages.filter((message) =>
			isArtifact(message.metadataJson),
		);
		const projectedArtifacts = artifacts.map((message, index) => {
			const metadata = asRecord(message.metadataJson);
			return {
				id: message.id,
				kind: artifactKind(metadata),
				title: textOrNull(metadata.title) ?? "",
				revision: index + 1,
				digest: digest(message.content),
				sourceMessageId: message.id,
			};
		});
		const specificationMessage = artifacts.findLast(
			(message) => asRecord(message.metadataJson).intent === "feature_plan",
		);
		const outcomes = (
			await Promise.all(
				terminalRuns.map((run) =>
					readMissionPilotRunOutcome(task.id, run.id, { maxChars: 2_000 }),
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
			repository: {
				id: project.id,
				localPath: project.localPath,
				branch: project.branch,
				allowed: project.allowed,
				worktreePath: task.worktreePath,
			},
			specification: specificationMessage
				? {
						messageId: specificationMessage.id,
						artifactKind: "feature_plan",
						revision:
							projectedArtifacts.find(
								(artifact) => artifact.id === specificationMessage.id,
							)?.revision ?? null,
						digest: digest(specificationMessage.content),
					}
				: null,
			currentView: latestView(messages),
			questionnaire: questionnaire.at(-1) ?? null,
			planArtifacts: artifacts.map((message, index) => {
				const metadata = asRecord(message.metadataJson);
				return {
					id: message.id,
					kind: artifactKind(metadata),
					revision: index + 1,
					title: textOrNull(metadata.title),
				};
			}),
			artifacts: projectedArtifacts,
			queue: queue[0] ?? null,
			activeRun: activeRuns[0]
				? {
						id: activeRuns[0].id,
						status: activeRuns[0].status,
						startedAt: activeRuns[0].startedAt,
					}
				: null,
			activeRuns: activeRuns.map((run) => ({
				id: run.id,
				status: run.status,
				startedAt: run.startedAt,
			})),
			terminalRuns: outcomes,
			availableActions: describeMissionPilotActions({
				authorization: session.authorizationJson,
				taskRevision,
				runtimeState: agent?.runtimeState ?? "stopped",
			}),
			observedAt: new Date().toISOString(),
		} satisfies MissionPilotTaskReadModel;
	},
	async readCurrentSpecification(taskId, options) {
		const messages = await listTaskMessages(taskId);
		const message = messages.findLast(
			(candidate) => asRecord(candidate.metadataJson).intent === "feature_plan",
		);
		if (!message) return null;
		const page = sliceMissionPilotUtf8Page(message.content, {
			cursor: options?.cursor,
			maxChars: options?.maxChars ?? 16_000,
			maxBytes: 16_000,
		});
		return {
			messageId: message.id,
			digest: digest(message.content),
			content: page.content,
			contentPage: page.page,
			sourceArtifactRefs: sourceRefs(asRecord(message.metadataJson)),
		};
	},
	async readQuestionnaireDecisions(taskId) {
		const sessions = await listDesignQuestionnaires(taskId);
		const current = sessions.findLast((session) =>
			["review_ready", "accepted"].includes(session.status),
		);
		return current
			? {
					sessionId: current.id,
					status: current.status,
					decisions: current.answers.map((answer) => ({
						questionId: answer.questionId,
						answer: answer.answer,
						freeText: answer.answer.freeText ?? null,
					})),
					sourceRevision: current.questionSets.length,
				}
			: null;
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
		if (!message || !isArtifact(message.metadataJson))
			throw new Error("Plan Artifact not found");
		const page = sliceMissionPilotUtf8Page(message.content, {
			cursor: options?.cursor,
			maxChars: options?.maxChars ?? 16_000,
			maxBytes: 16_000,
		});
		return {
			id: message.id,
			kind: artifactKind(asRecord(message.metadataJson)),
			digest: digest(message.content),
			content: page.content,
			contentPage: page.page,
			metadata: message.metadataJson,
		};
	},
	readRunOutcome: readMissionPilotRunOutcome,
	readRunChangeSummary: readMissionPilotRunChangeSummary,
	readRunVerification: readMissionPilotRunVerification,
	async listAvailableTaskActions(input) {
		return (await this.readTaskWorkspace(input)).availableActions;
	},
};

async function listTaskMessages(taskId: string) {
	return db
		.select()
		.from(taskMessages)
		.where(and(eq(taskMessages.taskId, taskId), isNull(taskMessages.runId)))
		.orderBy(taskMessages.createdAt);
}
function isArtifact(value: unknown) {
	const metadata = asRecord(value);
	return [
		"feature_plan",
		"app_blueprint",
		"mock_blueprint",
		"plan_mode_dedicated_view",
		"plan_mode_api_contract",
		"plan_mode_zod_schema",
	].includes(String(metadata.intent ?? metadata.artifactKind));
}
function artifactKind(metadata: Record<string, unknown>) {
	return metadata.intent === "feature_plan"
		? "feature_plan"
		: metadata.intent === "app_blueprint" ||
				metadata.intent === "mock_blueprint"
			? "blueprint"
			: (textOrNull(metadata.view) ??
				textOrNull(metadata.artifactKind) ??
				"unknown");
}
function latestView(messages: Array<{ metadataJson: unknown }>) {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const metadata = asRecord(messages[index]?.metadataJson);
		const view = textOrNull(metadata.view) ?? textOrNull(metadata.intent);
		if (view) return view;
	}
	return null;
}
function sourceRefs(metadata: Record<string, unknown>) {
	return Object.entries(metadata).flatMap(([kind, id]) =>
		kind.endsWith("MessageId") && typeof id === "string" ? [{ kind, id }] : [],
	);
}
function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}
function textOrNull(value: unknown) {
	return typeof value === "string" && value.trim() ? value : null;
}
function digest(value: string) {
	return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}
