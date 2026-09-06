import { and, desc, eq, sql } from "drizzle-orm";
import type {
	TraceChannel,
	TraceProvenance,
} from "../../../shared/schemas/trace-provenance.schema";
import { type DbTransaction, db } from "../../db/client";
import { repositories, taskMessages } from "../../db/schema";
import { AppError } from "../../lib/errors";
import { inspectProjectRepositoryIdentity } from "../../services/git/project-repository-identity";
import { nightWorkersRealtimeBroker } from "../../services/realtime/nightworkers-ws";
import { sanitizePersistenceValue } from "../../services/security/secret-persistence-firewall";
import {
	appendActivityArtifact,
	enqueueActivityEvent,
	flushActivityEventQueue,
	getToolDiffActivityKind,
	taskMessageRoleToActivityKind,
	taskMessageRoleToActivitySource,
} from "./nightworkers.activity.repository";
import { isJsonRecord, toJsonRecord } from "./nightworkers.json-adapters";
import {
	resolveTaskMessageTrace,
	withTraceProvenance,
} from "./nightworkers.trace-provenance";

type RepositoryInsert = typeof repositories.$inferInsert;
type Db = typeof db | DbTransaction;
type RepositorySafetyPolicy = RepositoryInsert["safetyPolicy"];

export type {
	ActivitySource,
	ActivityStatus,
} from "./nightworkers.activity-types";

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
	const identity = await inspectProjectRepositoryIdentity(data.localPath);
	if (identity.status === "invalid") {
		throw new AppError(
			409,
			identity.failureCode ?? "repository_identity_invalid",
			"登録Project rootはcanonicalなbase worktreeのGit top-levelである必要があります。",
		);
	}
	if (
		identity.status === "ready" &&
		identity.gitCommonDirCanonical &&
		!process.env.VITEST
	) {
		const [duplicate] = await db
			.select({ id: repositories.id })
			.from(repositories)
			.where(
				and(
					eq(
						repositories.gitCommonDirCanonical,
						identity.gitCommonDirCanonical,
					),
					eq(repositories.allowed, true),
				),
			);
		if (duplicate) {
			throw new AppError(
				409,
				"repository_identity_duplicate",
				"同じGit repositoryは別のProjectとして重複登録できません。",
			);
		}
	}
	const [repo] = await db
		.insert(repositories)
		.values({
			...data,
			localPath: identity.registeredRootCanonical,
			repositoryKind: identity.repositoryKind,
			repositoryIdentityStatus: identity.status,
			registeredRootCanonical: identity.registeredRootCanonical,
			gitCommonDirCanonical: identity.gitCommonDirCanonical,
			baseWorktreePathCanonical: identity.baseWorktreePathCanonical,
			baseWorktreeId: identity.baseWorktreeId,
			baseWorktreeBranch: identity.observedBranch,
			baseWorktreeHeadSha: identity.observedHeadSha,
			baseWorktreeDirty: identity.baseWorktreeDirty,
			repositoryIdentityDigest: identity.digest,
			repositoryIdentityRevision: identity.revision,
			repositoryIdentityVerifiedAt: new Date(identity.verifiedAt),
		})
		.returning();
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

export async function listTaskMessages(
	taskId: string,
	options?: { traceChannel?: TraceChannel },
) {
	const query = db.select().from(taskMessages);
	return (
		query
			.where(
				options?.traceChannel
					? and(
							eq(taskMessages.taskId, taskId),
							eq(taskMessages.traceChannel, options.traceChannel),
						)
					: eq(taskMessages.taskId, taskId),
			)
			// `created_at` is stored at second precision.  Use SQLite's insertion
			// sequence to preserve the causal order of messages created in the same
			// second (for example, a user retry immediately after a policy block).
			.orderBy(taskMessages.createdAt, sql<number>`rowid`)
	);
}

export async function createTaskMessage(
	data: {
		taskId: string;
		runId?: string | null;
		role: "user" | "assistant" | "system" | "tool";
		content: string;
		messageType?: string | null;
		payloadJson?: unknown;
		trace?: TraceProvenance;
	},
	database: Db = db,
) {
	data = sanitizePersistenceValue(data);
	const trace = resolveTaskMessageTrace({
		role: data.role,
		runId: data.runId,
		metadata: data.payloadJson,
		trace: data.trace,
	});
	const storedMetadata = withTraceProvenance(data.payloadJson, trace);
	const metadata = toJsonRecord(storedMetadata);
	const [message] = await database
		.insert(taskMessages)
		.values({
			taskId: data.taskId,
			runId: data.runId ?? null,
			role: data.role,
			content: data.content,
			messageType: data.messageType ?? null,
			metadataJson: storedMetadata,
			traceOwner: trace.owner,
			traceChannel: trace.channel,
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
				metadata: storedMetadata,
			},
			trace,
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
				trace,
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
				trace,
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
				trace,
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

// --- Task Runs ---
export * from "./nightworkers.activity.repository";
export * from "./nightworkers.blueprint-adoption.repository";
export * from "./nightworkers.design-questionnaire.repository";
export * from "./nightworkers.queue.repository";
export { updateRepository } from "./nightworkers.repository-settings";
export * from "./nightworkers.runs.repository";
export * from "./nightworkers.task.repository";
export { updateTaskStatusIfUnchanged } from "./nightworkers.task-status-cas.repository";
