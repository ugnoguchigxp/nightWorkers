import { createHash } from "node:crypto";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "../../db/client";
import { taskMessages } from "../../db/schema";

export type OperatorArtifactRef = {
	id: string;
	kind: string;
	revision: number;
	digest: string;
	status: string;
};

export async function readArtifactOperatorIndex(input: {
	taskId: string;
	cursor?: number;
	limit?: number;
}) {
	const cursor = Math.max(0, input.cursor ?? 0);
	const limit = Math.min(100, Math.max(1, input.limit ?? 32));
	const rows = await db
		.select({
			id: taskMessages.id,
			content: taskMessages.content,
			metadataJson: taskMessages.metadataJson,
			createdAt: taskMessages.createdAt,
		})
		.from(taskMessages)
		.where(
			and(eq(taskMessages.taskId, input.taskId), isNull(taskMessages.runId)),
		)
		.orderBy(asc(taskMessages.createdAt), asc(taskMessages.id));
	const artifacts = rows.filter(
		(row) => artifactKind(row.metadataJson) !== null,
	);
	const page = artifacts.slice(cursor, cursor + limit).map(toRef);
	const latestByKind = new Map<string, OperatorArtifactRef>();
	for (const artifact of artifacts.map(toRef))
		latestByKind.set(artifact.kind, artifact);
	const nextCursor = cursor + limit < artifacts.length ? cursor + limit : null;
	return {
		revision: artifacts.at(-1)?.createdAt.getTime() ?? 0,
		totalCount: artifacts.length,
		nextCursor,
		latestByKind: [...latestByKind.values()].slice(0, 32),
		page,
	};
}

export async function readArtifactOperatorContent(input: {
	taskId: string;
	artifactId: string;
}) {
	const [row] = await db
		.select({
			id: taskMessages.id,
			content: taskMessages.content,
			metadataJson: taskMessages.metadataJson,
			createdAt: taskMessages.createdAt,
		})
		.from(taskMessages)
		.where(
			and(
				eq(taskMessages.taskId, input.taskId),
				eq(taskMessages.id, input.artifactId),
				isNull(taskMessages.runId),
			),
		)
		.limit(1);
	if (!row || artifactKind(row.metadataJson) === null) return null;
	return { ...toRef(row), content: row.content };
}

function toRef(row: {
	id: string;
	content: string;
	metadataJson: unknown;
	createdAt: Date;
}): OperatorArtifactRef {
	const metadata = record(row.metadataJson);
	return {
		id: row.id,
		kind: artifactKind(metadata) ?? "unknown",
		revision: row.createdAt.getTime(),
		digest: digest(row.content),
		status: text(metadata.status) ?? "ready",
	};
}

function artifactKind(value: unknown) {
	const metadata = record(value);
	const intent = text(metadata.intent) ?? text(metadata.artifactKind);
	if (
		![
			"feature_plan",
			"app_blueprint",
			"mock_blueprint",
			"plan_mode_dedicated_view",
			"plan_mode_api_contract",
			"plan_mode_zod_schema",
		].includes(intent ?? "")
	)
		return null;
	if (intent === "app_blueprint" || intent === "mock_blueprint")
		return "blueprint";
	return text(metadata.view) ?? intent;
}

function record(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}
function text(value: unknown) {
	return typeof value === "string" && value ? value : null;
}
function digest(value: string) {
	return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
