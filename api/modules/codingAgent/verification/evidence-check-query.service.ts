import { and, asc, desc, eq, inArray } from "drizzle-orm";
import {
	isVerificationChecklistItemComplete,
	workspaceSourceSnapshotSchema,
} from "../../../../shared/schemas/verification-checklist.schema";
import { db } from "../../../db/client";
import { evidenceSubjectSnapshots } from "../../../db/evidence-ledger-schema";
import {
	repositories,
	taskMessages,
	taskRuns,
	taskRunTodos,
	tasks,
} from "../../../db/schema";
import {
	codingAgentTestConditionMappings,
	codingAgentTestInventoryCases,
	codingAgentTestInventoryRuns,
	verificationChecklistItems,
	verificationDocuments,
	verificationEvidenceCases,
	verificationEvidenceRuns,
} from "../../../db/verification-schema";
import {
	digestImplementationPlan,
	readFeaturePlanImplementationPlan,
} from "../../agentsShare";
import { captureWorkspaceSourceSnapshot } from "./workspace-source-snapshot";

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

type ChecklistRow = typeof verificationChecklistItems.$inferSelect;
type EvidenceRunRow = typeof verificationEvidenceRuns.$inferSelect;
type EvidenceCaseRow = typeof verificationEvidenceCases.$inferSelect;
type InventoryCaseRow = typeof codingAgentTestInventoryCases.$inferSelect;

type AssuranceTest = {
	caseKey: string;
	name: string;
	filePath: string | null;
	runner: string;
	mappingSource: string;
	execution: {
		status: "passed" | "failed" | "skipped" | "unknown" | "not_run";
		evidenceRunId: string | null;
		durationMs: number | null;
		finishedAt: string | null;
	};
	guards: {
		currentSource: boolean;
		sourceStableDuringExecution: boolean | null;
		testExecutionObserved: boolean;
		fullVerifyPassed: boolean;
	};
};

type AssuranceCondition = {
	assuranceStatus:
		| "safe_pass"
		| "failed"
		| "stale"
		| "not_run"
		| "unmapped"
		| "details_missing"
		| "manual"
		| "not_applicable"
		| "pending";
	assuranceReason: string | null;
	tests: AssuranceTest[];
};

async function buildEvidenceAssurance(input: {
	taskId: string;
	runId: string | null;
	verificationDocumentId: string;
	checklist: ChecklistRow[];
}) {
	const evaluatedAt = new Date().toISOString();
	const base = new Map<string, AssuranceCondition>(
		input.checklist.map((item) => [
			item.conditionId,
			defaultAssuranceForChecklistItem(item),
		]),
	);
	if (!input.runId) {
		return summarizeAssurance(base, input.checklist, {
			evaluatedAt,
			sourceStateHash: null,
			fullVerifyStatus: "unknown",
		});
	}

	const [scope] = await db
		.select({
			worktreePath: tasks.worktreePath,
			repositoryPath: repositories.localPath,
		})
		.from(tasks)
		.innerJoin(repositories, eq(repositories.id, tasks.repositoryId))
		.where(eq(tasks.id, input.taskId))
		.limit(1);
	const repoRoot = scope?.worktreePath || scope?.repositoryPath || null;
	const currentSnapshot = repoRoot
		? await captureWorkspaceSourceSnapshot(repoRoot).catch(() => null)
		: null;
	if (!currentSnapshot) {
		return summarizeAssurance(base, input.checklist, {
			evaluatedAt,
			sourceStateHash: null,
			fullVerifyStatus: "unknown",
		});
	}

	const [inventories, evidence, subjects] = await Promise.all([
		db
			.select()
			.from(codingAgentTestInventoryRuns)
			.where(
				and(
					eq(codingAgentTestInventoryRuns.taskId, input.taskId),
					eq(codingAgentTestInventoryRuns.runId, input.runId),
				),
			)
			.orderBy(desc(codingAgentTestInventoryRuns.createdAt)),
		db
			.select()
			.from(verificationEvidenceRuns)
			.where(
				and(
					eq(verificationEvidenceRuns.taskId, input.taskId),
					eq(verificationEvidenceRuns.runId, input.runId),
					eq(
					verificationEvidenceRuns.verificationDocumentId,
					input.verificationDocumentId,
				),
				),
			)
			.orderBy(desc(verificationEvidenceRuns.finishedAt)),
		db
			.select()
			.from(evidenceSubjectSnapshots)
			.where(
				and(
					eq(evidenceSubjectSnapshots.taskId, input.taskId),
					eq(evidenceSubjectSnapshots.implementationRunId, input.runId),
					eq(
					evidenceSubjectSnapshots.verificationDocumentId,
					input.verificationDocumentId,
				),
				),
			),
	]);
	const currentSubjectIds = new Set(
		subjects
			.filter(
				(subject) =>
					subject.sourceStateHash === currentSnapshot.sourceStateHash,
			)
			.map((subject) => subject.id),
	);
	const currentEvidence = evidence.filter(
		(item) =>
			Boolean(item.subjectId && currentSubjectIds.has(item.subjectId)) &&
			snapshotHash(item.sourceSnapshotJson) === currentSnapshot.sourceStateHash &&
			!item.sourceMutatedDuringCheck,
	);
	const currentFullVerify = currentEvidence.filter(
		(item) => item.checkKind === "verify",
	);
	const fullVerifyStatus = currentFullVerify.some((item) => item.exitCode === 0)
		? ("passed" as const)
		: currentFullVerify.some((item) => item.exitCode !== 0)
			? ("failed" as const)
			: ("unknown" as const);
	const currentTestExecutionPassed = currentEvidence.some(
		(item) => item.testExecutionObserved && item.exitCode === 0,
	);
	const currentTestExecutionFailed = currentEvidence.some(
		(item) => item.testExecutionObserved && item.exitCode !== 0,
	);
	const currentInventory = inventories.find(
		(inventory) =>
			snapshotHash(inventory.sourceSnapshotJson) === currentSnapshot.sourceStateHash,
	);
	const selectedInventory = currentInventory ?? inventories[0] ?? null;
	const inventoryCases = selectedInventory
		? await db
				.select()
				.from(codingAgentTestInventoryCases)
				.where(
					eq(codingAgentTestInventoryCases.inventoryId, selectedInventory.id),
				)
		: [];
	const mappings = selectedInventory
		? await db
				.select()
				.from(codingAgentTestConditionMappings)
				.where(
					and(
						eq(
							codingAgentTestConditionMappings.verificationDocumentId,
							input.verificationDocumentId,
						),
						eq(
							codingAgentTestConditionMappings.inventoryId,
							selectedInventory.id,
						),
					),
				)
		: [];
	const evidenceCases = evidence.length
		? await db
				.select()
				.from(verificationEvidenceCases)
				.where(
					inArray(
						verificationEvidenceCases.evidenceRunId,
						evidence.map((item) => item.id),
					),
				)
		: [];
	const evidenceById = new Map(evidence.map((item) => [item.id, item]));
	const inventoryIsCurrent = Boolean(currentInventory);
	const fullVerifyPassed = fullVerifyStatus === "passed";

	for (const item of input.checklist) {
		if (!item.required || item.verificationKind === "not_applicable") {
			base.set(item.conditionId, {
				assuranceStatus: "not_applicable",
				assuranceReason: null,
				tests: [],
			});
			continue;
		}
		if (item.verificationKind === "manual") {
			base.set(item.conditionId, {
				assuranceStatus: "manual",
				assuranceReason: item.reason,
				tests: [],
			});
			continue;
		}
		if (item.verificationKind !== "automated_test") continue;

		const definitions = activeDefinitionsForCondition({
			conditionId: item.conditionId,
			inventoryCases,
			mappings,
		});
		if (definitions.length === 0) {
			base.set(item.conditionId, {
				assuranceStatus: "unmapped",
				assuranceReason: "missing_test_definition_mapping",
				tests: [],
			});
			continue;
		}
		const tests = definitions.map((definition) =>
			buildAssuranceTest({
				conditionId: item.conditionId,
				definition,
				evidenceCases,
				evidenceById,
				currentEvidenceIds: new Set(currentEvidence.map((entry) => entry.id)),
				inventoryIsCurrent,
				fullVerifyPassed,
			}),
		);
		const hasCurrentFailure =
			item.status === "failed" ||
			currentTestExecutionFailed ||
			tests.some(
				(test) =>
					test.guards.currentSource && test.execution.status === "failed",
			);
		const everyExactTestPassed = tests.every(
			(test) =>
				test.guards.currentSource &&
				test.guards.sourceStableDuringExecution === true &&
				test.guards.testExecutionObserved &&
				test.execution.status === "passed",
		);
		const condition = hasCurrentFailure
			? ({
					assuranceStatus: "failed",
					assuranceReason: "test_execution_failed",
					tests,
				} satisfies AssuranceCondition)
			: !inventoryIsCurrent
				? ({
						assuranceStatus: "stale",
						assuranceReason: "source_snapshot_changed",
						tests,
					} satisfies AssuranceCondition)
				: !currentTestExecutionPassed
					? ({
							assuranceStatus: "not_run",
							assuranceReason: "missing_successful_test_execution",
							tests,
						} satisfies AssuranceCondition)
					: !everyExactTestPassed
						? ({
								assuranceStatus: "details_missing",
								assuranceReason: "missing_exact_test_case_result",
								tests,
							} satisfies AssuranceCondition)
						: fullVerifyStatus === "failed"
							? ({
									assuranceStatus: "failed",
									assuranceReason: "full_verify_failed",
									tests,
								} satisfies AssuranceCondition)
							: !fullVerifyPassed
								? ({
										assuranceStatus: "pending",
										assuranceReason: "missing_successful_full_verify",
										tests,
									} satisfies AssuranceCondition)
								: ({
										assuranceStatus: "safe_pass",
										assuranceReason: null,
										tests,
									} satisfies AssuranceCondition);
		base.set(item.conditionId, condition);
	}

	return summarizeAssurance(base, input.checklist, {
		evaluatedAt,
		sourceStateHash: currentSnapshot.sourceStateHash,
		fullVerifyStatus,
	});
}

function defaultAssuranceForChecklistItem(
	item: ChecklistRow,
): AssuranceCondition {
	if (!item.required || item.verificationKind === "not_applicable") {
		return {
			assuranceStatus: "not_applicable",
			assuranceReason: null,
			tests: [],
		};
	}
	if (item.verificationKind === "manual") {
		return {
			assuranceStatus: "manual",
			assuranceReason: item.reason,
			tests: [],
		};
	}
	return {
		assuranceStatus: item.status === "failed" ? "failed" : "pending",
		assuranceReason:
			item.status === "failed" ? item.reason : "assurance_not_evaluated",
		tests: [],
	};
}

function activeDefinitionsForCondition(input: {
	conditionId: string;
	inventoryCases: InventoryCaseRow[];
	mappings: Array<typeof codingAgentTestConditionMappings.$inferSelect>;
}) {
	const mappingByCaseKey = new Map(
		input.mappings
			.filter((mapping) => mapping.conditionId === input.conditionId)
			.map((mapping) => [mapping.caseKey, mapping.source]),
	);
	return input.inventoryCases
		.filter((testCase) => testCase.discoveryLevel === "active")
		.flatMap((testCase) => {
			const mappingSource = mappingByCaseKey.get(testCase.caseKey);
			const declared = testCase.declaredConditionIdsJson.includes(
				input.conditionId,
			);
			if (!mappingSource && !declared) return [];
			return [
				{
					...testCase,
					mappingSource: mappingSource || "declared_in_test",
				},
			];
		});
}

function buildAssuranceTest(input: {
	conditionId: string;
	definition: InventoryCaseRow & { mappingSource: string };
	evidenceCases: EvidenceCaseRow[];
	evidenceById: Map<string, EvidenceRunRow>;
	currentEvidenceIds: Set<string>;
	inventoryIsCurrent: boolean;
	fullVerifyPassed: boolean;
}): AssuranceTest {
	const execution = input.evidenceCases
		.filter((testCase) =>
			matchesInventoryDefinition(
				testCase,
				input.definition,
				input.conditionId,
			),
		)
		.sort((left, right) => {
			const leftRun = input.evidenceById.get(left.evidenceRunId);
			const rightRun = input.evidenceById.get(right.evidenceRunId);
			return (
				(rightRun?.finishedAt.getTime() ?? 0) -
				(leftRun?.finishedAt.getTime() ?? 0)
			);
		})[0];
	const evidenceRun = execution
		? input.evidenceById.get(execution.evidenceRunId)
		: undefined;
	const currentSource = Boolean(
		input.inventoryIsCurrent &&
			execution &&
			input.currentEvidenceIds.has(execution.evidenceRunId),
	);
	return {
		caseKey: input.definition.caseKey,
		name: input.definition.name,
		filePath: input.definition.filePath,
		runner: input.definition.runner,
		mappingSource: input.definition.mappingSource,
		execution: {
			status: execution
				? normalizeExecutionStatus(execution.status)
				: "not_run",
			evidenceRunId: execution?.evidenceRunId ?? null,
			durationMs: execution?.durationMs ?? null,
			finishedAt: evidenceRun?.finishedAt.toISOString() ?? null,
		},
		guards: {
			currentSource,
			sourceStableDuringExecution: evidenceRun
				? !evidenceRun.sourceMutatedDuringCheck
				: null,
			testExecutionObserved: Boolean(evidenceRun?.testExecutionObserved),
			fullVerifyPassed: input.fullVerifyPassed,
		},
	};
}

function matchesInventoryDefinition(
	testCase: EvidenceCaseRow,
	definition: InventoryCaseRow,
	conditionId: string,
) {
	const expectedName = normalizeTestIdentity(definition.name);
	const actualName = normalizeTestIdentity(testCase.name);
	const nameMatches =
		actualName === expectedName || actualName.endsWith(` ${expectedName}`);
	const fileMatches =
		!testCase.filePath ||
		normalizeTestIdentity(testCase.filePath) ===
			normalizeTestIdentity(definition.filePath);
	return (
		nameMatches &&
		fileMatches &&
		(testCase.conditionIdsJson.length === 0 ||
			testCase.conditionIdsJson.includes(conditionId))
	);
}

function normalizeTestIdentity(value: string) {
	return value
		.normalize("NFKC")
		.toLocaleLowerCase("en-US")
		.replaceAll("\\", "/")
		.replace(/\s+/g, " ")
		.trim();
}

function normalizeExecutionStatus(
	status: string,
): AssuranceTest["execution"]["status"] {
	if (
		status === "passed" ||
		status === "failed" ||
		status === "skipped" ||
		status === "unknown"
	) {
		return status;
	}
	return "unknown";
}

function summarizeAssurance(
	conditions: Map<string, AssuranceCondition>,
	checklist: ChecklistRow[],
	context: {
		evaluatedAt: string;
		sourceStateHash: string | null;
		fullVerifyStatus: "passed" | "failed" | "unknown";
	},
) {
	const automated = checklist.filter(
		(item) => item.required && item.verificationKind === "automated_test",
	);
	const automatedResults = automated.map(
		(item) =>
			conditions.get(item.conditionId) ??
			defaultAssuranceForChecklistItem(item),
	);
	const safePass = automatedResults.filter(
		(item) => item.assuranceStatus === "safe_pass",
	).length;
	const failed = automatedResults.filter(
		(item) => item.assuranceStatus === "failed",
	).length;
	return {
		conditions,
		evaluatedAt: context.evaluatedAt,
		sourceStateHash: context.sourceStateHash,
		assuranceSummary: {
			automated: automated.length,
			safePass,
			failed,
			attention: Math.max(0, automated.length - safePass - failed),
			fullVerifyStatus: context.fullVerifyStatus,
		},
	};
}

function snapshotHash(value: unknown): string | undefined {
	const parsed = workspaceSourceSnapshotSchema.safeParse(value);
	return parsed.success ? parsed.data.sourceStateHash : undefined;
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
	const assurance = await buildEvidenceAssurance({
		taskId: input.taskId,
		runId: implementationPlanTraceability?.runId ?? document.runId,
		verificationDocumentId: document.id,
		checklist: rows,
	});
	const conditions = rows.map((row) => {
		const conditionAssurance = assurance.conditions.get(row.conditionId) ??
			defaultAssuranceForChecklistItem(row);
		return {
			id: row.conditionId,
			text: row.text,
			status: row.status,
			required: row.required,
			verificationKind: row.verificationKind,
			expectedEvidence: row.expectedEvidenceJson,
			evidenceIds: row.evidenceIdsJson,
			reason: row.reason,
			lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
			...conditionAssurance,
		};
	});
	return {
		taskId: input.taskId,
		verificationDocumentId: document.id,
		specMessageId: document.specMessageId,
		specArtifactId: document.specArtifactId,
		generatedAt: document.generatedAt.toISOString(),
		evaluatedAt: assurance.evaluatedAt,
		sourceStateHash: assurance.sourceStateHash,
		conditions,
		implementationPlanTraceability,
		summary: {
			total: rows.length,
			confirmed,
			failed,
			pending: Math.max(0, rows.length - confirmed - failed),
		},
		assuranceSummary: assurance.assuranceSummary,
	};
}
