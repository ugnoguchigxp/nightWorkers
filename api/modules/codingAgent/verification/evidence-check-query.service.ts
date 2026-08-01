import { and, desc, eq } from "drizzle-orm";
import type { EvidenceCheckSnapshot } from "../../../../shared/modules/codingAgent";
import { db } from "../../../db/client";
import { repositories, taskRuns, tasks } from "../../../db/schema";
import { verificationDocuments } from "../../../db/verification-schema";
import { evaluateEvidenceReadiness } from "./evidence-readiness.service";

function record(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function runExecutionMode(run: typeof taskRuns.$inferSelect) {
	return record(run.contextSnapshot).executionMode;
}

function runImplementationPlanSourceMessageId(
	run: typeof taskRuns.$inferSelect,
) {
	const snapshot = record(run.contextSnapshot);
	const provenance = record(snapshot.implementationPlanProvenance);
	const handoff = record(snapshot.implementationHandoff);
	return typeof provenance.sourceMessageId === "string"
		? provenance.sourceMessageId
		: typeof handoff.sourceMessageId === "string"
			? handoff.sourceMessageId
			: null;
}

async function resolveEvidenceRunId(input: {
	taskId: string;
	document: typeof verificationDocuments.$inferSelect;
}) {
	if (input.document.runId) return input.document.runId;
	const runs = await db
		.select()
		.from(taskRuns)
		.where(eq(taskRuns.taskId, input.taskId))
		.orderBy(desc(taskRuns.startedAt));
	const matchingImplementationRun = runs.find(
		(run) =>
			runExecutionMode(run) === "implementation" &&
			(!input.document.specMessageId ||
				runImplementationPlanSourceMessageId(run) ===
					input.document.specMessageId),
	);
	return (
		matchingImplementationRun?.id ??
		runs.find((run) => run.workerKind === "codex-agent")?.id ??
		null
	);
}

export async function getLatestEvidenceCheckDescriptor(taskId: string) {
	const [document] = await db
		.select()
		.from(verificationDocuments)
		.where(
			and(
				eq(verificationDocuments.taskId, taskId),
				eq(verificationDocuments.status, "active"),
			),
		)
		.orderBy(desc(verificationDocuments.generatedAt))
		.limit(1);
	if (!document) return null;
	return {
		taskId,
		verificationDocumentId: document.id,
		specMessageId: document.specMessageId,
		specArtifactId: document.specArtifactId,
		generatedAt: document.generatedAt.toISOString(),
	};
}

export async function getEvidenceCheckSnapshot(input: {
	taskId: string;
	verificationDocumentId: string;
}): Promise<EvidenceCheckSnapshot | null> {
	const document = await db
		.select()
		.from(verificationDocuments)
		.where(
			and(
				eq(verificationDocuments.id, input.verificationDocumentId),
				eq(verificationDocuments.taskId, input.taskId),
				eq(verificationDocuments.status, "active"),
			),
		)
		.then((rows) => rows[0]);
	if (!document) return null;

	const [scope, runId] = await Promise.all([
		db
			.select({
				worktreePath: tasks.worktreePath,
				repositoryPath: repositories.localPath,
			})
			.from(tasks)
			.innerJoin(repositories, eq(repositories.id, tasks.repositoryId))
			.where(eq(tasks.id, input.taskId))
			.limit(1)
			.then((entries) => entries[0]),
		resolveEvidenceRunId({ taskId: input.taskId, document }),
	]);
	const repoRoot = scope?.worktreePath || scope?.repositoryPath;
	if (!repoRoot) return null;
	const readiness = await evaluateEvidenceReadiness({
		taskId: input.taskId,
		runId,
		verificationDocumentId: document.id,
		repoRoot,
	});

	return {
		version: 2,
		taskId: input.taskId,
		verificationDocumentId: document.id,
		specMessageId: document.specMessageId,
		specArtifactId: document.specArtifactId,
		generatedAt: document.generatedAt.toISOString(),
		evaluatedAt:
			readiness.ready && readiness.verify.finishedAt
				? readiness.verify.finishedAt
				: new Date().toISOString(),
		...readiness,
	};
}
