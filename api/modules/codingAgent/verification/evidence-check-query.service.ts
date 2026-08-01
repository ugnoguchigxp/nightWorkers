import { and, asc, desc, eq } from "drizzle-orm";
import { isVerificationChecklistItemComplete } from "../../../../shared/schemas/verification-checklist.schema";
import { db } from "../../../db/client";
import { taskMessages, taskRuns, taskRunTodos } from "../../../db/schema";
import {
	verificationChecklistItems,
	verificationDocuments,
} from "../../../db/verification-schema";
import {
	digestImplementationPlan,
	readFeaturePlanImplementationPlan,
} from "../../agentsShare";

function record(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function stringArray(value: unknown) {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: [];
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

async function buildImplementationPlanTraceability(input: {
	taskId: string;
	document: typeof verificationDocuments.$inferSelect;
}) {
	const sourceMessageId = input.document.specMessageId;
	if (!sourceMessageId) return null;
	const [sourceMessage] = await db
		.select({
			id: taskMessages.id,
			metadataJson: taskMessages.metadataJson,
		})
		.from(taskMessages)
		.where(
			and(
				eq(taskMessages.id, sourceMessageId),
				eq(taskMessages.taskId, input.taskId),
			),
		)
		.limit(1);
	const plan = sourceMessage
		? readFeaturePlanImplementationPlan(sourceMessage.metadataJson)
		: null;
	if (!plan) return null;

	const runs = await db
		.select()
		.from(taskRuns)
		.where(eq(taskRuns.taskId, input.taskId))
		.orderBy(desc(taskRuns.startedAt));
	const run = runs.find(
		(candidate) =>
			runExecutionMode(candidate) === "implementation" &&
			(input.document.runId === candidate.id ||
				runImplementationPlanSourceMessageId(candidate) === sourceMessageId),
	);
	const todos = run
		? await db
				.select()
				.from(taskRunTodos)
				.where(eq(taskRunTodos.runId, run.id))
				.orderBy(asc(taskRunTodos.seq))
		: [];
	const steps = plan.steps.map((step, index) => {
		const todo = todos.find((candidate) => candidate.seq === index + 1);
		return {
			seq: index + 1,
			title: step.title,
			systemContext: step.systemContext,
			todoId: todo?.id ?? null,
			todoStatus: todo?.status ?? null,
			aligned: Boolean(
				todo &&
					todo.title === step.title &&
					todo.context === step.systemContext,
			),
			evidenceIds: stringArray(todo?.evidenceRefsJson),
			completionGateRecorded: todo?.completionGateResult != null,
		};
	});
	const exactTodoMatch =
		todos.length === plan.steps.length && steps.every((step) => step.aligned);
	const digest = digestImplementationPlan(plan);
	const snapshot = record(run?.contextSnapshot);
	const provenance = record(snapshot.implementationPlanProvenance);
	const hasPersistedProvenance = Object.keys(provenance).length > 0;
	const persistedProvenanceMatches =
		provenance.version === 1 &&
		provenance.sourceMessageId === sourceMessageId &&
		provenance.digest === digest;
	const handoffSourceMatches =
		record(snapshot.implementationHandoff).sourceMessageId === sourceMessageId;
	const provenanceStatus = !run
		? ("missing" as const)
		: hasPersistedProvenance && !persistedProvenanceMatches
			? ("provenance_mismatch" as const)
			: !exactTodoMatch
				? ("todo_mismatch" as const)
				: persistedProvenanceMatches
					? ("matched" as const)
					: handoffSourceMatches
						? ("legacy_inferred" as const)
						: ("missing" as const);
	const passed = steps.filter((step) =>
		["passed", "skipped"].includes(step.todoStatus ?? ""),
	).length;

	return {
		sourceMessageId,
		digest,
		runId: run?.id ?? null,
		runStatus: run?.status ?? null,
		provenanceStatus,
		exactTodoMatch,
		steps,
		summary: {
			total: steps.length,
			passed,
			incomplete: Math.max(0, steps.length - passed),
			unaligned: steps.filter((step) => !step.aligned).length,
			extraTodos: Math.max(0, todos.length - steps.length),
			evidenceLinked: steps.filter((step) => step.evidenceIds.length > 0)
				.length,
		},
	};
}

export async function getEvidenceCheckSnapshot(input: {
	taskId: string;
	verificationDocumentId: string;
}) {
	const [document] = await db
		.select()
		.from(verificationDocuments)
		.where(
			and(
				eq(verificationDocuments.id, input.verificationDocumentId),
				eq(verificationDocuments.taskId, input.taskId),
				eq(verificationDocuments.status, "active"),
			),
		)
		.limit(1);
	if (!document) return null;
	const rows = await db
		.select()
		.from(verificationChecklistItems)
		.where(eq(verificationChecklistItems.verificationDocumentId, document.id))
		.orderBy(verificationChecklistItems.conditionId);
	const conditions = rows.map((row) => ({
		id: row.conditionId,
		text: row.text,
		status: row.status,
		required: row.required,
		evidenceIds: row.evidenceIdsJson,
		reason: row.reason,
		lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
	}));
	const confirmed = rows.filter((row) =>
		isVerificationChecklistItemComplete({
			required: row.required,
			status: row.status,
		}),
	).length;
	const failed = rows.filter((row) => row.status === "failed").length;
	const implementationPlanTraceability =
		await buildImplementationPlanTraceability({
			taskId: input.taskId,
			document,
		});
	return {
		taskId: input.taskId,
		verificationDocumentId: document.id,
		specMessageId: document.specMessageId,
		specArtifactId: document.specArtifactId,
		generatedAt: document.generatedAt.toISOString(),
		conditions,
		implementationPlanTraceability,
		summary: {
			total: rows.length,
			confirmed,
			failed,
			pending: Math.max(0, rows.length - confirmed - failed),
		},
	};
}
