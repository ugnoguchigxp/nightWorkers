import type {
	AcceptanceConditionAssurance,
	AcceptanceConditionAssuranceReasonCode,
} from "../../../../shared/modules/codingAgent";
import type {
	ExpectedEvidence,
	VerificationChecklistItem,
} from "../../../../shared/schemas/verification-checklist.schema";
import { workspaceSourceSnapshotSchema } from "../../../../shared/schemas/verification-checklist.schema";
import type {
	codingAgentConditionConfirmations,
	codingAgentTestConditionMappings,
	codingAgentTestInventoryCases,
	codingAgentTestInventoryRuns,
	verificationChecklistItems,
	verificationEvidenceCases,
	verificationEvidenceRuns,
} from "../../../db/verification-schema";
import { isCompatibleEvidenceKind } from "./evidence-kind-compatibility";

type ChecklistRow = typeof verificationChecklistItems.$inferSelect;
type InventoryRow = typeof codingAgentTestInventoryRuns.$inferSelect;
type InventoryCaseRow = typeof codingAgentTestInventoryCases.$inferSelect;
type MappingRow = typeof codingAgentTestConditionMappings.$inferSelect;
type EvidenceRunRow = typeof verificationEvidenceRuns.$inferSelect;
type EvidenceCaseRow = typeof verificationEvidenceCases.$inferSelect;
type ConfirmationRow = typeof codingAgentConditionConfirmations.$inferSelect;

export type AcceptanceConditionAssuranceTest = {
	caseKey: string;
	name: string;
	filePath: string | null;
	runner: string;
	mappingSource: string;
	execution: {
		status: "passed" | "failed" | "skipped" | "unknown" | "not_run";
		evidenceRunId: string | null;
		evidenceKind: ExpectedEvidence | null;
		durationMs: number | null;
		finishedAt: string | null;
	};
	guards: {
		currentSource: boolean;
		sourceStableDuringExecution: boolean | null;
		testExecutionObserved: boolean;
	};
};

export type EvaluatedAcceptanceCondition = AcceptanceConditionAssurance & {
	text: string;
	tests: AcceptanceConditionAssuranceTest[];
};

export type AcceptanceConditionAssuranceEvaluation = {
	passed: boolean;
	sourceStateHash: string;
	conditions: EvaluatedAcceptanceCondition[];
	qualityGate: {
		passed: boolean;
		inventory: {
			status: "passed" | "failed";
			reason?: string;
			activeCaseCount: number;
		};
		testExecution: { status: "passed" | "failed"; reason?: string };
		fullVerify: {
			required: boolean;
			status: "passed" | "failed";
			reason?: string;
		};
	};
};

export type AcceptanceConditionAssuranceDataset = {
	sourceStateHash: string;
	checklist: Array<
		Pick<
			ChecklistRow,
			| "conditionId"
			| "text"
			| "required"
			| "verificationKind"
			| "expectedEvidenceJson"
			| "status"
			| "evidenceIdsJson"
		>
	>;
	inventory: Pick<InventoryRow, "id" | "sourceSnapshotJson"> | null;
	inventoryCases: InventoryCaseRow[];
	mappings: MappingRow[];
	evidenceRuns: EvidenceRunRow[];
	evidenceCases: EvidenceCaseRow[];
	confirmations: ConfirmationRow[];
};

export function evaluateAcceptanceConditionAssuranceDataset(
	input: AcceptanceConditionAssuranceDataset,
): AcceptanceConditionAssuranceEvaluation {
	const sourceCurrentRuns = input.evidenceRuns.filter(
		(run) => snapshotHash(run.sourceSnapshotJson) === input.sourceStateHash,
	);
	const currentRuns = sourceCurrentRuns.filter(
		(run) => !run.sourceMutatedDuringCheck,
	);
	const currentRunIds = new Set(currentRuns.map((run) => run.id));
	const runsById = new Map(input.evidenceRuns.map((run) => [run.id, run]));
	const activeCases = input.inventoryCases.filter(
		(testCase) => testCase.discoveryLevel === "active",
	);
	const casesByKey = new Map(
		activeCases.map((testCase) => [testCase.caseKey, testCase]),
	);
	const mappingsByCondition = new Map<string, MappingRow[]>();
	for (const mapping of input.mappings) {
		if (
			mapping.sourceDigest !== input.sourceStateHash ||
			!casesByKey.has(mapping.caseKey)
		) {
			continue;
		}
		const list = mappingsByCondition.get(mapping.conditionId) ?? [];
		list.push(mapping);
		mappingsByCondition.set(mapping.conditionId, list);
	}

	const conditions = input.checklist.map((item) =>
		evaluateCondition({
			item,
			sourceStateHash: input.sourceStateHash,
			inventoryCurrent: Boolean(input.inventory),
			casesByKey,
			mappings: mappingsByCondition.get(item.conditionId) ?? [],
			evidenceRuns: input.evidenceRuns,
			sourceCurrentRuns,
			currentRuns,
			currentRunIds,
			runsById,
			evidenceCases: input.evidenceCases,
			confirmations: input.confirmations,
		}),
	);
	const automated = conditions.filter(
		(condition) =>
			condition.required && condition.verificationKind === "automated_test",
	);
	const repositoryGateRequired = conditions.some(
		(condition) =>
			condition.required &&
			(condition.verificationKind === "automated_test" ||
				condition.verificationKind === "command_gate"),
	);
	const latestVerify = [...currentRuns]
		.filter((run) => run.checkKind === "verify")
		.sort(
			(left, right) => right.finishedAt.getTime() - left.finishedAt.getTime(),
		)[0];
	const fullVerifyPassed =
		!repositoryGateRequired || latestVerify?.exitCode === 0;
	const automatedPassed = automated.every(
		(condition) => condition.assuranceStatus === "safe_pass",
	);
	const allConditionsPassed =
		conditions.length > 0 &&
		conditions.every(
			(condition) =>
				!condition.required || condition.assuranceStatus === "safe_pass",
		);
	const inventoryPassed = automated.length === 0 || activeCases.length > 0;

	return {
		passed: allConditionsPassed && fullVerifyPassed,
		sourceStateHash: input.sourceStateHash,
		conditions,
		qualityGate: {
			passed:
				conditions.length > 0 &&
				inventoryPassed &&
				automatedPassed &&
				fullVerifyPassed,
			inventory: {
				status: inventoryPassed ? "passed" : "failed",
				activeCaseCount: activeCases.length,
				...(inventoryPassed ? {} : { reason: "missing_active_test_discovery" }),
			},
			testExecution: {
				status: automatedPassed ? "passed" : "failed",
				...(automatedPassed
					? {}
					: { reason: "required_test_condition_evidence_incomplete" }),
			},
			fullVerify: {
				required: repositoryGateRequired,
				status: fullVerifyPassed ? "passed" : "failed",
				...(fullVerifyPassed
					? {}
					: {
							reason: latestVerify
								? "latest_full_verify_failed"
								: "missing_successful_full_verify",
						}),
			},
		},
	};
}

function evaluateCondition(input: {
	item: AcceptanceConditionAssuranceDataset["checklist"][number];
	sourceStateHash: string;
	inventoryCurrent: boolean;
	casesByKey: Map<string, InventoryCaseRow>;
	mappings: MappingRow[];
	evidenceRuns: EvidenceRunRow[];
	sourceCurrentRuns: EvidenceRunRow[];
	currentRuns: EvidenceRunRow[];
	currentRunIds: Set<string>;
	runsById: Map<string, EvidenceRunRow>;
	evidenceCases: EvidenceCaseRow[];
	confirmations: ConfirmationRow[];
}): EvaluatedAcceptanceCondition {
	const verificationKind = normalizeVerificationKind(
		input.item.verificationKind,
	);
	const expectedEvidence = normalizeExpectedEvidence(
		input.item.expectedEvidenceJson,
	);
	const base = {
		conditionId: input.item.conditionId,
		text: input.item.text,
		required: input.item.required,
		verificationKind,
		expectedEvidence,
	};
	if (!input.item.required || verificationKind === "not_applicable") {
		return result(base, "not_applicable", null);
	}
	if (expectedEvidence.length === 0) {
		return result(base, "details_missing", "CONDITION_EVIDENCE_KIND_MISMATCH");
	}
	if (verificationKind === "manual") {
		const confirmation = input.confirmations.find(
			(item) =>
				item.conditionId === input.item.conditionId &&
				item.sourceStateHash === input.sourceStateHash &&
				item.actorKind === "human_reviewer",
		);
		if (confirmation) {
			return result(base, "safe_pass", null, [
				{
					evidenceRunId: confirmation.id,
					evidenceKind: "manual_evidence",
					sourceStateHash: input.sourceStateHash,
				},
			]);
		}
		return result(base, "manual", "MANUAL_CONFIRMATION_MISSING");
	}
	if (verificationKind === "command_gate") {
		return evaluateCommandGate({ ...input, base });
	}
	if (!input.inventoryCurrent) {
		return result(base, "stale", "CONDITION_EVIDENCE_STALE");
	}
	if (input.mappings.length === 0) {
		return result(base, "unmapped", "CONDITION_MAPPING_MISSING");
	}

	const tests = input.mappings.flatMap((mapping) => {
		const definition = input.casesByKey.get(mapping.caseKey);
		if (!definition) return [];
		return [
			buildAssuranceTest({
				definition,
				mappingSource: mapping.source,
				evidenceCases: input.evidenceCases,
				currentRunIds: input.currentRunIds,
				runsById: input.runsById,
			}),
		];
	});
	if (tests.length !== input.mappings.length) {
		return result(
			base,
			"details_missing",
			"CONDITION_CASE_DETAILS_MISSING",
			[],
			tests,
		);
	}
	if (
		tests.some(
			(test) =>
				test.execution.status === "not_run" ||
				test.execution.status === "unknown",
		)
	) {
		const hasUnresolvedCase = input.evidenceCases.some(
			(testCase) => !testCase.caseKey,
		);
		const evidenceRunIdsWithCases = new Set(
			input.evidenceCases.map((testCase) => testCase.evidenceRunId),
		);
		const hasCaseLessTestExecution = input.currentRuns.some(
			(run) =>
				run.testExecutionObserved && !evidenceRunIdsWithCases.has(run.id),
		);
		const detailsMissing = hasUnresolvedCase || hasCaseLessTestExecution;
		return result(
			base,
			detailsMissing ? "details_missing" : "not_run",
			detailsMissing
				? "CONDITION_CASE_DETAILS_MISSING"
				: "CONDITION_CASE_EXECUTION_MISSING",
			[],
			tests,
		);
	}
	if (tests.some((test) => test.guards.sourceStableDuringExecution !== true)) {
		return result(base, "stale", "CONDITION_SOURCE_MUTATED", [], tests);
	}
	if (tests.some((test) => !test.guards.currentSource)) {
		return result(base, "stale", "CONDITION_EVIDENCE_STALE", [], tests);
	}
	if (tests.some((test) => !test.guards.testExecutionObserved)) {
		return result(
			base,
			"details_missing",
			"CONDITION_CASE_DETAILS_MISSING",
			[],
			tests,
		);
	}
	if (tests.some((test) => test.execution.status === "failed")) {
		return result(base, "failed", "CONDITION_CASE_FAILED", [], tests);
	}
	if (tests.some((test) => test.execution.status === "skipped")) {
		return result(base, "failed", "CONDITION_CASE_SKIPPED", [], tests);
	}
	const missingKind = expectedEvidence.find(
		(expected) =>
			!tests.some(
				(test) =>
					test.execution.status === "passed" &&
					test.execution.evidenceKind !== null &&
					isCompatibleEvidenceKind(expected, test.execution.evidenceKind),
			),
	);
	if (missingKind) {
		return result(
			base,
			"details_missing",
			"CONDITION_EVIDENCE_KIND_MISMATCH",
			[],
			tests,
		);
	}
	const evidenceRefs = tests.flatMap((test) => {
		if (!test.execution.evidenceRunId || !test.execution.evidenceKind)
			return [];
		return [
			{
				evidenceRunId: test.execution.evidenceRunId,
				caseKey: test.caseKey,
				evidenceKind: test.execution.evidenceKind,
				sourceStateHash: input.sourceStateHash,
			},
		];
	});
	return result(base, "safe_pass", null, evidenceRefs, tests);
}

function evaluateCommandGate(
	input: Parameters<typeof evaluateCondition>[0] & {
		base: Pick<
			EvaluatedAcceptanceCondition,
			| "conditionId"
			| "text"
			| "required"
			| "verificationKind"
			| "expectedEvidence"
		>;
	},
) {
	const scoped = input.sourceCurrentRuns.filter((run) =>
		run.commandLevelConditionIdsJson.includes(input.item.conditionId),
	);
	if (scoped.length === 0) {
		const staleScoped = input.evidenceRuns.some((run) =>
			run.commandLevelConditionIdsJson.includes(input.item.conditionId),
		);
		return result(
			input.base,
			staleScoped ? "stale" : "not_run",
			staleScoped
				? "CONDITION_EVIDENCE_STALE"
				: "CONDITION_COMMAND_SCOPE_MISSING",
		);
	}
	const evidenceRefs = [] as AcceptanceConditionAssurance["evidenceRefs"];
	for (const expected of input.base.expectedEvidence) {
		const latest = scoped
			.filter((run) =>
				run.evidenceKindsJson.some((actual) => {
					const normalized = normalizeExpectedEvidenceKind(actual);
					return (
						normalized !== null &&
						isCompatibleEvidenceKind(expected, normalized)
					);
				}),
			)
			.sort(
				(left, right) => right.finishedAt.getTime() - left.finishedAt.getTime(),
			)[0];
		if (!latest) {
			return result(
				input.base,
				"details_missing",
				"CONDITION_EVIDENCE_KIND_MISMATCH",
			);
		}
		if (latest.sourceMutatedDuringCheck) {
			return result(input.base, "stale", "CONDITION_SOURCE_MUTATED");
		}
		if (latest.exitCode !== 0) {
			return result(input.base, "failed", "CONDITION_CASE_FAILED");
		}
		evidenceRefs.push({
			evidenceRunId: latest.id,
			evidenceKind: expected,
			sourceStateHash: input.sourceStateHash,
		});
	}
	return result(input.base, "safe_pass", null, evidenceRefs);
}

function buildAssuranceTest(input: {
	definition: InventoryCaseRow;
	mappingSource: string;
	evidenceCases: EvidenceCaseRow[];
	currentRunIds: Set<string>;
	runsById: Map<string, EvidenceRunRow>;
}): AcceptanceConditionAssuranceTest {
	const execution = input.evidenceCases
		.filter((testCase) => testCase.caseKey === input.definition.caseKey)
		.sort((left, right) => {
			const leftRun = input.runsById.get(left.evidenceRunId);
			const rightRun = input.runsById.get(right.evidenceRunId);
			return (
				(rightRun?.finishedAt.getTime() ?? 0) -
				(leftRun?.finishedAt.getTime() ?? 0)
			);
		})[0];
	const run = execution ? input.runsById.get(execution.evidenceRunId) : null;
	const currentSource = Boolean(
		execution && input.currentRunIds.has(execution.evidenceRunId),
	);
	return {
		caseKey: input.definition.caseKey,
		name: input.definition.name,
		filePath: input.definition.filePath,
		runner: input.definition.runner,
		mappingSource: input.mappingSource,
		execution: {
			status: execution
				? normalizeExecutionStatus(execution.status)
				: "not_run",
			evidenceRunId: execution?.evidenceRunId ?? null,
			evidenceKind: normalizeExpectedEvidenceKind(execution?.evidenceKind),
			durationMs: execution?.durationMs ?? null,
			finishedAt: run?.finishedAt.toISOString() ?? null,
		},
		guards: {
			currentSource,
			sourceStableDuringExecution: run ? !run.sourceMutatedDuringCheck : null,
			testExecutionObserved: Boolean(run?.testExecutionObserved),
		},
	};
}

function result(
	base: Pick<
		EvaluatedAcceptanceCondition,
		| "conditionId"
		| "text"
		| "required"
		| "verificationKind"
		| "expectedEvidence"
	>,
	assuranceStatus: AcceptanceConditionAssurance["assuranceStatus"],
	reasonCode: AcceptanceConditionAssuranceReasonCode | null,
	evidenceRefs: AcceptanceConditionAssurance["evidenceRefs"] = [],
	tests: AcceptanceConditionAssuranceTest[] = [],
): EvaluatedAcceptanceCondition {
	return { ...base, assuranceStatus, reasonCode, evidenceRefs, tests };
}

function normalizeVerificationKind(
	value: string | null,
): EvaluatedAcceptanceCondition["verificationKind"] {
	if (
		value === "automated_test" ||
		value === "command_gate" ||
		value === "manual" ||
		value === "not_applicable"
	) {
		return value;
	}
	return "automated_test" as const;
}

function normalizeExpectedEvidence(values: string[]): ExpectedEvidence[] {
	return values.flatMap((value) => {
		const normalized = normalizeExpectedEvidenceKind(value);
		return normalized ? [normalized] : [];
	});
}

function normalizeExpectedEvidenceKind(
	value: unknown,
): ExpectedEvidence | null {
	if (
		value === "automated_test" ||
		value === "unit_test" ||
		value === "integration_test" ||
		value === "e2e_test" ||
		value === "typecheck" ||
		value === "lint" ||
		value === "format_check" ||
		value === "build" ||
		value === "coverage" ||
		value === "migration_check" ||
		value === "manual_evidence"
	) {
		return value;
	}
	return null;
}

function normalizeExecutionStatus(
	status: string,
): AcceptanceConditionAssuranceTest["execution"]["status"] {
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

function snapshotHash(value: unknown) {
	const parsed = workspaceSourceSnapshotSchema.safeParse(value);
	return parsed.success ? parsed.data.sourceStateHash : null;
}

export function toVerificationChecklistItem(
	condition: EvaluatedAcceptanceCondition,
): VerificationChecklistItem {
	return {
		id: condition.conditionId,
		conditionId: condition.conditionId,
		text: condition.text,
		required: condition.required,
		verificationKind: condition.verificationKind,
		expectedEvidence: condition.expectedEvidence,
		status:
			condition.assuranceStatus === "safe_pass"
				? "passed"
				: condition.assuranceStatus === "failed"
					? "failed"
					: condition.assuranceStatus === "not_applicable"
						? "not_applicable"
						: "unknown",
		evidenceIds: condition.evidenceRefs.map((item) => item.evidenceRunId),
		reason: condition.reasonCode ?? undefined,
	};
}
