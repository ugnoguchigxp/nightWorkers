import { desc, eq } from "drizzle-orm";
import { type DbTransaction, db } from "../../db/client";
import type { TaskStatus } from "../../db/schema";
import { repositories, taskMessages, tasks } from "../../db/schema";
import { nightWorkersRealtimeBroker } from "../../services/realtime/nightworkers-ws";
import {
	appendActivityArtifact,
	enqueueActivityEvent,
	flushActivityEventQueue,
	getToolDiffActivityKind,
	taskMessageRoleToActivityKind,
	taskMessageRoleToActivitySource,
} from "./nightworkers.activity.repository";
import { isJsonRecord, toJsonRecord } from "./nightworkers.json-adapters";

type RepositoryInsert = typeof repositories.$inferInsert;
type Db = typeof db | DbTransaction;
type RepositorySafetyPolicy = RepositoryInsert["safetyPolicy"];

const _ACTIVE_IMPLEMENTATION_QUEUE_STATUSES = [
	"queued",
	"claimed",
	"processing",
	"needs_human",
	"awaiting_commit_decision",
	"execution_completed",
	"failed",
	"cancelled",
] as const;
const _OCCUPIED_PROCESSOR_STATUSES = [
	"claimed",
	"processing",
	"needs_human",
	"awaiting_commit_decision",
] as const;

const _KNOWN_ACTIVITY_KINDS = new Set([
	"user.message",
	"assistant.delta",
	"assistant.message",
	"assistant.pause",
	"assistant.resume",
	"assistant.raw_output",
	"llm.request",
	"llm.response_delta",
	"llm.response_final",
	"llm.decision_json",
	"llm.schema_result",
	"llm.error",
	"llm.usage",
	"llm.provider_activity",
	"runtime.decision",
	"runtime.state",
	"tool.call",
	"tool.result",
	"tool.error",
	"command.output",
	"file.diff",
	"file.patch",
	"file.write",
	"verification.output",
	"run.status",
	"todo.status",
	"transport.subscribe",
	"transport.replay",
	"transport.publish",
	"ui.optimistic",
	"system.info",
	"system.error",
	"unknown.activity",
]);

export type ActivitySource =
	| "user"
	| "assistant"
	| "supervisor"
	| "worker"
	| "tool"
	| "system"
	| "provider"
	| "runtime"
	| "transport"
	| "ui";

export type ActivityStatus =
	| "started"
	| "delta"
	| "completed"
	| "failed"
	| "paused"
	| "resumed"
	| "info"
	| "unknown";

// --- Repositories ---
export async function createRepository(data: {
	name: string;
	localPath: string;
	branch: string;
	allowed?: boolean;
	queueEnabled?: boolean;
	maxConcurrentSessions?: number;
	safetyPolicy?: RepositorySafetyPolicy;
}) {
	const [repo] = await db.insert(repositories).values(data).returning();
	return repo;
}

export async function getRepository(id: string) {
	const [repo] = await db
		.select()
		.from(repositories)
		.where(eq(repositories.id, id));
	return repo;
}

export async function listRepositories() {
	return db.select().from(repositories).orderBy(desc(repositories.createdAt));
}

export async function updateRepository(
	id: string,
	data: {
		queueEnabled?: boolean;
		maxConcurrentSessions?: number;
		safetyPolicy?: RepositorySafetyPolicy;
		projectMeta?: Record<string, unknown> | null;
		featureSettings?: Record<string, unknown> | null;
	},
) {
	const [repo] = await db
		.update(repositories)
		.set({ ...data, updatedAt: new Date() })
		.where(eq(repositories.id, id))
		.returning();
	return repo;
}

export async function updateRepositoryFeatureSettings(
	id: string,
	featureSettings: Record<string, unknown> | null,
) {
	const [repo] = await db
		.update(repositories)
		.set({ featureSettings, updatedAt: new Date() })
		.where(eq(repositories.id, id))
		.returning();
	return repo;
}

export async function updateRepositoryProjectMeta(
	id: string,
	projectMeta: Record<string, unknown> | null,
) {
	const [repo] = await db
		.update(repositories)
		.set({ projectMeta, updatedAt: new Date() })
		.where(eq(repositories.id, id))
		.returning();
	return repo;
}

export async function deleteRepository(id: string) {
	// A repository delete cascades through tasks, so drain their queued ledger
	// entries before those foreign-key targets disappear.
	await flushActivityEventQueue();
	const [repo] = await db
		.delete(repositories)
		.where(eq(repositories.id, id))
		.returning();
	return repo;
}

// --- Tasks ---
export async function createTask(
	data: {
		repositoryId: string;
		title: string;
		description?: string | null;
		objective?: string | null;
		acceptanceCriteria?: string | null;
		worktreePath?: string | null;
		status?: TaskStatus;
		timeoutSeconds?: number;
		priority?: number;
		createdBy?: string | null;
	},
	database: Db = db,
) {
	const [task] = await database.insert(tasks).values(data).returning();
	return task;
}

export async function getTask(id: string) {
	const [task] = await db.select().from(tasks).where(eq(tasks.id, id));
	return task;
}

export async function listTasks() {
	return db.select().from(tasks).orderBy(desc(tasks.createdAt));
}

export async function listTaskMessages(taskId: string) {
	return db
		.select()
		.from(taskMessages)
		.where(eq(taskMessages.taskId, taskId))
		.orderBy(taskMessages.createdAt);
}

export async function createTaskMessage(
	data: {
		taskId: string;
		runId?: string | null;
		role: "user" | "assistant" | "system" | "tool";
		content: string;
		messageType?: string | null;
		payloadJson?: unknown;
	},
	database: Db = db,
) {
	const metadata = toJsonRecord(data.payloadJson);
	const [message] = await database
		.insert(taskMessages)
		.values({
			taskId: data.taskId,
			runId: data.runId ?? null,
			role: data.role,
			content: data.content,
			messageType: data.messageType ?? null,
			metadataJson: data.payloadJson ?? null,
		})
		.returning();
	if (message && database === db) {
		await enqueueActivityEvent({
			taskId: data.taskId,
			runId: data.runId ?? null,
			turnId: message.id,
			kind: taskMessageRoleToActivityKind(data.role),
			source: taskMessageRoleToActivitySource(data.role),
			status: "completed",
			text: data.content,
			payloadJson: {
				message,
				messageType: data.messageType ?? null,
				metadata: data.payloadJson ?? null,
			},
			externalId: message.id,
			dedupeKey: `task_message:${message.id}`,
			createdAt: message.createdAt,
		});
		if (isAppBlueprintProjectionMessage(data.messageType, metadata)) {
			await enqueueActivityEvent({
				taskId: data.taskId,
				runId: data.runId ?? null,
				turnId: message.id,
				kind: "system.info",
				source: "assistant",
				status: "completed",
				text: `Blueprint artifact: ${getBlueprintProjectionTitle(metadata)}`,
				payloadJson: {
					messageId: message.id,
					messageType: data.messageType ?? null,
					artifactRef: metadata.artifactRef,
					display: metadata.display ?? null,
					metadata,
				},
				artifactId: getArtifactRefId(metadata),
				externalId: message.id,
				dedupeKey: `task_message_artifact:${message.id}`,
				createdAt: message.createdAt,
			});
		} else if (isAppBlueprintDocumentMessage(data.messageType, metadata)) {
			const artifact = await appendActivityArtifact({
				taskId: data.taskId,
				runId: data.runId ?? null,
				kind: "app_blueprint",
				path: `${message.id}.app-blueprint.json`,
				contentText: JSON.stringify(metadata.appBlueprint, null, 2),
				metadataJson: {
					messageId: message.id,
					intent: metadata.intent,
					title: metadata.title,
					appBlueprint: metadata.appBlueprint,
					validation: metadata.validation,
					generation: metadata.generation,
					source: metadata.source,
				},
			});
			await enqueueActivityEvent({
				taskId: data.taskId,
				runId: data.runId ?? null,
				turnId: message.id,
				kind: "system.info",
				source: "assistant",
				status: "completed",
				text: `Blueprint artifact: ${getBlueprintDocumentTitle(metadata)}`,
				payloadJson: {
					messageId: message.id,
					messageType: data.messageType ?? null,
					metadata,
				},
				artifactId: artifact?.id ?? null,
				externalId: message.id,
				dedupeKey: `task_message_artifact:${message.id}`,
				createdAt: message.createdAt,
			});
		}
		const diffActivityKind = getToolDiffActivityKind(metadata);
		if (diffActivityKind) {
			const codeBlock = isJsonRecord(metadata.codeBlock)
				? metadata.codeBlock
				: {};
			const toolResult = isJsonRecord(metadata.toolResult)
				? metadata.toolResult
				: {};
			const artifact = await appendActivityArtifact({
				taskId: data.taskId,
				runId: data.runId ?? null,
				kind: diffActivityKind === "file.patch" ? "patch" : "diff",
				path:
					typeof codeBlock.filename === "string"
						? codeBlock.filename
						: `${String(metadata.toolName || "tool")}.diff`,
				contentText:
					typeof codeBlock.code === "string" ? codeBlock.code : data.content,
				metadataJson: {
					messageId: message.id,
					toolName: metadata.toolName,
					title: metadata.title,
					iteration: metadata.iteration,
					toolResult,
				},
			});
			await enqueueActivityEvent({
				taskId: data.taskId,
				runId: data.runId ?? null,
				turnId: message.id,
				kind: diffActivityKind,
				source: "tool",
				status: toolResult.ok === false ? "failed" : "completed",
				text:
					typeof metadata.title === "string"
						? metadata.title
						: message.content.slice(0, 240),
				payloadJson: {
					messageId: message.id,
					toolName: metadata.toolName,
					toolResult,
				},
				artifactId: artifact?.id ?? null,
				externalId: message.id,
				dedupeKey: `task_message_diff:${message.id}`,
				createdAt: message.createdAt,
			});
		}
		nightWorkersRealtimeBroker.publish(data.taskId, {
			type: "task_message_created",
			runId: data.runId ?? undefined,
			payload: { message },
		});
	}
	return message;
}

export async function updateTaskMessageMetadata(
	messageId: string,
	metadataJson: Record<string, unknown>,
) {
	const [message] = await db
		.update(taskMessages)
		.set({ metadataJson })
		.where(eq(taskMessages.id, messageId))
		.returning();
	return message;
}

export async function createBlueprintActivityArtifact(data: {
	taskId: string;
	runId?: string | null;
	messageId?: string | null;
	title: string;
	appBlueprint: unknown;
	validation?: unknown;
	generation?: unknown;
	source?: string | null;
	metadataJson?: Record<string, unknown>;
}) {
	return appendActivityArtifact({
		taskId: data.taskId,
		runId: data.runId ?? null,
		kind: "app_blueprint",
		path: `${data.messageId || crypto.randomUUID()}.app-blueprint.json`,
		contentText: JSON.stringify(data.appBlueprint, null, 2),
		metadataJson: {
			messageId: data.messageId ?? null,
			intent: "app_blueprint",
			title: data.title,
			appBlueprint: data.appBlueprint,
			validation: data.validation,
			generation: data.generation,
			source: data.source,
			schemaName: "app_blueprint",
			schemaVersion: 1,
			status:
				isJsonRecord(data.validation) && data.validation.valid === false
					? "invalid"
					: "valid",
			...(data.metadataJson || {}),
		},
	});
}

export async function createMockBlueprintActivityArtifact(data: {
	taskId: string;
	runId?: string | null;
	messageId?: string | null;
	title: string;
	mockBlueprint: unknown;
	generation?: unknown;
	source?: string | null;
	metadataJson?: Record<string, unknown>;
}) {
	return appendActivityArtifact({
		taskId: data.taskId,
		runId: data.runId ?? null,
		kind: "app_blueprint",
		path: `${data.messageId || crypto.randomUUID()}.mock-blueprint.json`,
		contentText: JSON.stringify(data.mockBlueprint, null, 2),
		metadataJson: {
			messageId: data.messageId ?? null,
			intent: "mock_blueprint",
			artifactType: "mock_blueprint",
			title: data.title,
			mockBlueprint: data.mockBlueprint,
			generation: data.generation,
			source: data.source,
			schemaName: "mock_blueprint",
			schemaVersion: 1,
			status: "valid",
			...(data.metadataJson || {}),
		},
	});
}

function isAppBlueprintDocumentMessage(
	messageType: string | null | undefined,
	payloadJson: Record<string, unknown>,
) {
	return Boolean(
		messageType === "markdown_document" &&
			((payloadJson.intent === "app_blueprint" && payloadJson.appBlueprint) ||
				(payloadJson.intent === "mock_blueprint" && payloadJson.mockBlueprint)),
	);
}

function isAppBlueprintProjectionMessage(
	messageType: string | null | undefined,
	payloadJson: Record<string, unknown>,
) {
	const artifactRef = isJsonRecord(payloadJson.artifactRef)
		? payloadJson.artifactRef
		: {};
	return Boolean(
		messageType === "markdown_document" &&
			(payloadJson.intent === "app_blueprint" ||
				payloadJson.intent === "mock_blueprint") &&
			typeof artifactRef.artifactId === "string",
	);
}

function getArtifactRefId(payloadJson: Record<string, unknown>) {
	const artifactRef = isJsonRecord(payloadJson.artifactRef)
		? payloadJson.artifactRef
		: {};
	return typeof artifactRef.artifactId === "string"
		? artifactRef.artifactId
		: null;
}

function getBlueprintProjectionTitle(payloadJson: Record<string, unknown>) {
	const display = isJsonRecord(payloadJson.display) ? payloadJson.display : {};
	const appBlueprint = isJsonRecord(payloadJson.appBlueprint)
		? payloadJson.appBlueprint
		: {};
	const mockBlueprint = isJsonRecord(payloadJson.mockBlueprint)
		? payloadJson.mockBlueprint
		: {};
	return String(
		display.title ||
			payloadJson.title ||
			appBlueprint.name ||
			mockBlueprint.name ||
			"Blueprint",
	);
}

function getBlueprintDocumentTitle(payloadJson: Record<string, unknown>) {
	const appBlueprint = isJsonRecord(payloadJson.appBlueprint)
		? payloadJson.appBlueprint
		: {};
	const mockBlueprint = isJsonRecord(payloadJson.mockBlueprint)
		? payloadJson.mockBlueprint
		: {};
	return String(
		payloadJson.title || appBlueprint.name || mockBlueprint.name || "Blueprint",
	);
}

export async function updateTaskStatus(id: string, status: TaskStatus) {
	const [task] = await db
		.update(tasks)
		.set({ status, updatedAt: new Date() })
		.where(eq(tasks.id, id))
		.returning();
	if (task) {
		nightWorkersRealtimeBroker.publish(task.id, {
			type: "task_status_updated",
			payload: { status: task.status, task },
		});
	}
	return task;
}

export async function updateTaskCompiledPrompt(
	id: string,
	compiledPrompt: string,
) {
	const [task] = await db
		.update(tasks)
		.set({ compiledPrompt, updatedAt: new Date() })
		.where(eq(tasks.id, id))
		.returning();
	return task;
}

export async function updateTask(
	id: string,
	data: {
		title?: string;
		description?: string | null;
		objective?: string | null;
		acceptanceCriteria?: string | null;
		status?: TaskStatus;
		priority?: number;
	},
) {
	const [task] = await db
		.update(tasks)
		.set({ ...data, updatedAt: new Date() })
		.where(eq(tasks.id, id))
		.returning();
	return task;
}

export async function deleteTask(id: string) {
	// Persist queued ledger entries while their task foreign keys still exist.
	// The task delete then removes them through the schema cascade.
	await flushActivityEventQueue();
	return db.transaction(async (tx) => {
		const existing = await tx
			.select()
			.from(tasks)
			.where(eq(tasks.id, id))
			.limit(1);
		const task = existing[0];
		if (!task) return undefined;
		const [deleted] = await tx
			.delete(tasks)
			.where(eq(tasks.id, id))
			.returning();
		return deleted;
	});
}

// --- Task Runs ---
export * from "./nightworkers.activity.repository";
export * from "./nightworkers.blueprint-adoption.repository";
export * from "./nightworkers.design-questionnaire.repository";
export * from "./nightworkers.queue.repository";
export * from "./nightworkers.runs.repository";
