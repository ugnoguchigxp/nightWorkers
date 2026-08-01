import { and, asc, desc, eq } from "drizzle-orm";
import type { EvidenceCheckSnapshot } from "../../../../shared/modules/codingAgent";
import { expectedEvidenceSchema } from "../../../../shared/schemas/verification-checklist.schema";
import { db } from "../../../db/client";
import {
	repositories,
	taskMessages,
	taskRuns,
	taskRunTodos,
	tasks,
} from "../../../db/schema";
import {
	verificationChecklistItems,
	verificationDocuments,
} from "../../../db/verification-schema";
import {
	digestImplementationPlan,
	readFeaturePlanImplementationPlan,
} from "../../agentsShare";
import {
	type EvaluatedAcceptanceCondition,
	evaluateAcceptanceConditionAssurance,
} from "./acceptance-condition-assurance.service";

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
		.select({ id: taskMessages.id, metadataJson: taskMessages.metadataJson })
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
	const [rows, implementationPlanTraceability, scope] = await Promise.all([
		db
			.select()
			.from(verificationChecklistItems)
			.where(eq(verificationChecklistItems.verificationDocumentId, document.id))
			.orderBy(verificationChecklistItems.conditionId),
		buildImplementationPlanTraceability({ taskId: input.taskId, document }),
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
	]);
	const runId = implementationPlanTraceability?.runId ?? document.runId;
	const repoRoot = scope?.worktreePath || scope?.repositoryPath || null;
	const evaluation =
		runId && repoRoot
			? await evaluateAcceptanceConditionAssurance({
					taskId: input.taskId,
					runId,
					verificationDocumentId: document.id,
					repoRoot,
				}).catch(() => null)
			: null;
	const evaluatedById = new Map(
		(evaluation?.conditions ?? []).map((condition) => [
			condition.conditionId,
			condition,
		]),
	);
	const fullVerifyPassed =
		evaluation?.qualityGate.fullVerify.status === "passed";
	const conditions = rows.map((row) => {
		const evaluated =
			evaluatedById.get(row.conditionId) ?? fallbackCondition(row);
		return {
			id: row.conditionId,
			text: row.text,
			status: row.status,
			required: row.required,
			verificationKind: evaluated.verificationKind,
			expectedEvidence: evaluated.expectedEvidence,
			evidenceIds: Array.from(
				new Set([
					...row.evidenceIdsJson,
					...evaluated.evidenceRefs.map((reference) => reference.evidenceRunId),
				]),
			),
			reason: row.reason,
			lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
			assuranceStatus: evaluated.assuranceStatus,
			assuranceReason: evaluated.reasonCode,
			tests: evaluated.tests.map((test) => ({
				caseKey: test.caseKey,
				name: test.name,
				filePath: test.filePath,
				runner: test.runner,
				mappingSource: test.mappingSource,
				execution: {
					status: test.execution.status,
					evidenceRunId: test.execution.evidenceRunId,
					evidenceKind: test.execution.evidenceKind,
					durationMs: test.execution.durationMs,
					finishedAt: test.execution.finishedAt,
				},
				guards: {
					currentSource: test.guards.currentSource,
					sourceStableDuringExecution: test.guards.sourceStableDuringExecution,
					testExecutionObserved: test.guards.testExecutionObserved,
					fullVerifyPassed,
				},
			})),
		};
	});
	const confirmed = conditions.filter(
		(condition) =>
			condition.assuranceStatus === "safe_pass" ||
			condition.assuranceStatus === "not_applicable",
	).length;
	const failed = conditions.filter(
		(condition) => condition.assuranceStatus === "failed",
	).length;
	const automated = conditions.filter(
		(condition) =>
			condition.required && condition.verificationKind === "automated_test",
	);
	const automatedSafePass = automated.filter(
		(condition) => condition.assuranceStatus === "safe_pass",
	).length;
	const automatedFailed = automated.filter(
		(condition) => condition.assuranceStatus === "failed",
	).length;

	return {
		taskId: input.taskId,
		verificationDocumentId: document.id,
		specMessageId: document.specMessageId,
		specArtifactId: document.specArtifactId,
		generatedAt: document.generatedAt.toISOString(),
		evaluatedAt: new Date().toISOString(),
		sourceStateHash: evaluation?.sourceStateHash ?? null,
		conditions,
		implementationPlanTraceability,
		summary: {
			total: rows.length,
			confirmed,
			failed,
			pending: Math.max(0, rows.length - confirmed - failed),
		},
		assuranceSummary: {
			automated: automated.length,
			safePass: automatedSafePass,
			failed: automatedFailed,
			attention: Math.max(
				0,
				automated.length - automatedSafePass - automatedFailed,
			),
			required: conditions.filter((condition) => condition.required).length,
			requiredSafePass: conditions.filter(
				(condition) =>
					condition.required && condition.assuranceStatus === "safe_pass",
			).length,
			unmapped: conditions.filter(
				(condition) => condition.assuranceStatus === "unmapped",
			).length,
			detailsMissing: conditions.filter(
				(condition) => condition.assuranceStatus === "details_missing",
			).length,
			stale: conditions.filter(
				(condition) => condition.assuranceStatus === "stale",
			).length,
			fullVerifyStatus: evaluation
				? evaluation.qualityGate.fullVerify.status
				: "unknown",
		},
	};
}

function fallbackCondition(
	row: typeof verificationChecklistItems.$inferSelect,
): EvaluatedAcceptanceCondition {
	const verificationKind =
		row.verificationKind === "command_gate" ||
		row.verificationKind === "manual" ||
		row.verificationKind === "not_applicable"
			? row.verificationKind
			: "automated_test";
	return {
		conditionId: row.conditionId,
		text: row.text,
		required: row.required,
		verificationKind,
		expectedEvidence: row.expectedEvidenceJson.flatMap((value) => {
			const parsed = expectedEvidenceSchema.safeParse(value);
			return parsed.success ? [parsed.data] : [];
		}),
		assuranceStatus:
			!row.required || verificationKind === "not_applicable"
				? "not_applicable"
				: verificationKind === "manual"
					? "manual"
					: "pending",
		reasonCode:
			verificationKind === "manual"
				? "MANUAL_CONFIRMATION_MISSING"
				: verificationKind === "command_gate"
					? "CONDITION_COMMAND_SCOPE_MISSING"
					: verificationKind === "automated_test"
						? "TEST_INVENTORY_MISSING"
						: null,
		evidenceRefs: [],
		tests: [],
	};
}
