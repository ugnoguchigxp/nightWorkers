import type {
	EvidenceAssuranceCondition,
	EvidenceAssuranceReasonCode,
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
import {
	buildAssuranceTest,
	latestEvidenceRun,
	normalizeExpectedEvidenceKind,
} from "./acceptance-condition-test-evidence";
import { isCompatibleEvidenceKind } from "./evidence-kind-compatibility";

type ChecklistRow = typeof verificationChecklistItems.$inferSelect;
type InventoryRow = typeof codingAgentTestInventoryRuns.$inferSelect;
type InventoryCaseRow = typeof codingAgentTestInventoryCases.$inferSelect;
type MappingRow = typeof codingAgentTestConditionMappings.$inferSelect;
type EvidenceRunRow = typeof verificationEvidenceRuns.$inferSelect;
type EvidenceCaseRow = typeof verificationEvidenceCases.$inferSelect;
type ConfirmationRow = typeof codingAgentConditionConfirmations.$inferSelect;

export type EvaluatedAcceptanceCondition = EvidenceAssuranceCondition;

export type AcceptanceConditionAssuranceEvaluation = {
	passed: boolean;
	sourceStateHash: string;
	conditions: EvaluatedAcceptanceCondition[];
	qualityGate: {
		passed: boolean;
		inventory: {
			status: "passed" | "failed";
			reason?: EvidenceAssuranceReasonCode;
			activeCaseCount: number;
		};
		testExecution: {
			status: "passed" | "failed";
			reason?: EvidenceAssuranceReasonCode;
		};
		fullVerify: {
			required: boolean;
			status: "passed" | "failed";
			reason?: EvidenceAssuranceReasonCode;
			evidenceRunId: string | null;
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
		const mappings = mappingsByCondition.get(mapping.conditionId) ?? [];
		mappings.push(mapping);
		mappingsByCondition.set(mapping.conditionId, mappings);
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
	const requiredAutomated = conditions.filter(
		(condition) =>
			condition.required && condition.verificationKind === "automated_test",
	);
	const repositoryGateRequired = conditions.some(
		(condition) =>
			condition.required &&
			(condition.verificationKind === "automated_test" ||
				condition.verificationKind === "command_gate"),
	);
	const latestVerify = latestEvidenceRun(
		sourceCurrentRuns.filter((run) => run.checkKind === "verify"),
	);
	const fullVerifyPassed =
		!repositoryGateRequired ||
		Boolean(
			latestVerify &&
				latestVerify.exitCode === 0 &&
				!latestVerify.sourceMutatedDuringCheck,
		);
	const automatedPassed = requiredAutomated.every(
		(condition) => condition.assuranceStatus === "safe_pass",
	);
	const allConditionsPassed =
		conditions.length > 0 &&
		conditions.every(
			(condition) =>
				!condition.required || condition.assuranceStatus === "safe_pass",
		);
	const inventoryPassed =
		requiredAutomated.length === 0 || activeCases.length > 0;

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
				...(inventoryPassed
					? {}
					: { reason: "TEST_INVENTORY_MISSING" as const }),
			},
			testExecution: {
				status: automatedPassed ? "passed" : "failed",
				...(automatedPassed
					? {}
					: { reason: firstConditionReason(requiredAutomated) }),
			},
			fullVerify: {
				required: repositoryGateRequired,
				status: fullVerifyPassed ? "passed" : "failed",
				evidenceRunId: latestVerify?.id ?? null,
				...(fullVerifyPassed
					? {}
					: {
							reason: latestVerify
								? ("FULL_VERIFY_FAILED" as const)
								: ("FULL_VERIFY_MISSING" as const),
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
		return confirmation
			? result(base, "safe_pass", null, [
					{
						evidenceRunId: confirmation.id,
						evidenceKind: "manual_evidence",
						sourceStateHash: input.sourceStateHash,
					},
				])
			: result(base, "manual", "MANUAL_CONFIRMATION_MISSING");
	}
	if (verificationKind === "command_gate") {
		return evaluateCommandGate({ ...input, base });
	}
	if (!input.inventoryCurrent) {
		return result(base, "details_missing", "TEST_INVENTORY_MISSING");
	}
	if (input.mappings.length === 0) {
		return result(base, "unmapped", "CONDITION_MAPPING_MISSING");
	}

	const tests = input.mappings.flatMap((mapping) => {
		const definition = input.casesByKey.get(mapping.caseKey);
		return definition
			? [
					buildAssuranceTest({
						definition,
						mappingSource: mapping.source,
						evidenceCases: input.evidenceCases,
						currentRunIds: input.currentRunIds,
						runsById: input.runsById,
					}),
				]
			: [];
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
		const scopedTestRuns = input.currentRuns.filter(
			(run) =>
				run.checkKind === "test" &&
				run.commandLevelConditionIdsJson.includes(input.item.conditionId),
		);
		const latestScopedTestRun = latestEvidenceRun(scopedTestRuns);
		const unresolvedForCondition = input.evidenceCases.filter(
			(testCase) =>
				!testCase.caseKey &&
				testCase.conditionIdsJson.includes(input.item.conditionId) &&
				(!latestScopedTestRun ||
					testCase.evidenceRunId === latestScopedTestRun.id),
		);
		const hasAmbiguousIdentity = unresolvedForCondition.some(
			(testCase) => testCase.failureMessage === "TEST_IDENTITY_AMBIGUOUS",
		);
		const hasIdentityMismatch = unresolvedForCondition.some(
			(testCase) => testCase.failureMessage === "TEST_EVIDENCE_CAPTURE_FAILED",
		);
		const hasFailedExecution = (latestScopedTestRun?.exitCode ?? 0) !== 0;
		const hasCaptureFailure = Boolean(
			latestScopedTestRun &&
				latestScopedTestRun.exitCode === 0 &&
				!latestScopedTestRun.parsedArtifactId,
		);
		return result(
			base,
			hasFailedExecution
				? "failed"
				: hasAmbiguousIdentity || hasIdentityMismatch || hasCaptureFailure
					? "details_missing"
					: "not_run",
			hasFailedExecution
				? "MAPPED_TEST_FAILED"
				: hasAmbiguousIdentity
					? "TEST_IDENTITY_AMBIGUOUS"
					: hasIdentityMismatch || hasCaptureFailure
						? "TEST_EVIDENCE_CAPTURE_FAILED"
						: "MAPPED_TEST_NOT_RUN",
			[],
			tests,
		);
	}
	if (tests.some((test) => test.guards.sourceStableDuringExecution !== true)) {
		return result(base, "stale", "CONDITION_SOURCE_MUTATED", [], tests);
	}
	if (tests.some((test) => !test.guards.currentSource)) {
		return result(base, "stale", "TEST_EVIDENCE_STALE", [], tests);
	}
	if (tests.some((test) => !test.guards.testExecutionObserved)) {
		return result(
			base,
			"details_missing",
			"TEST_EVIDENCE_CAPTURE_FAILED",
			[],
			tests,
		);
	}
	if (tests.some((test) => test.execution.status === "failed")) {
		return result(base, "failed", "MAPPED_TEST_FAILED", [], tests);
	}
	if (tests.some((test) => test.execution.status === "skipped")) {
		return result(base, "failed", "MAPPED_TEST_FAILED", [], tests);
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
	const evidenceRefs = tests.flatMap((test) =>
		test.execution.evidenceRunId && test.execution.evidenceKind
			? [
					{
						evidenceRunId: test.execution.evidenceRunId,
						caseKey: test.caseKey,
						evidenceKind: test.execution.evidenceKind,
						sourceStateHash: input.sourceStateHash,
					},
				]
			: [],
	);
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
	const evidenceRefs: EvidenceAssuranceCondition["evidenceRefs"] = [];
	for (const expected of input.base.expectedEvidence) {
		const latest = latestEvidenceRun(
			scoped.filter((run) =>
				run.evidenceKindsJson.some((actual) => {
					const normalized = normalizeExpectedEvidenceKind(actual);
					return (
						normalized !== null &&
						isCompatibleEvidenceKind(expected, normalized)
					);
				}),
			),
		);
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

function result(
	base: Pick<
		EvaluatedAcceptanceCondition,
		| "conditionId"
		| "text"
		| "required"
		| "verificationKind"
		| "expectedEvidence"
	>,
	assuranceStatus: EvidenceAssuranceCondition["assuranceStatus"],
	reasonCode: EvidenceAssuranceReasonCode | null,
	evidenceRefs: EvidenceAssuranceCondition["evidenceRefs"] = [],
	tests: EvidenceAssuranceCondition["tests"] = [],
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
	return "automated_test";
}

function normalizeExpectedEvidence(values: string[]): ExpectedEvidence[] {
	return values.flatMap((value) => {
		const normalized = normalizeExpectedEvidenceKind(value);
		return normalized ? [normalized] : [];
	});
}

function snapshotHash(value: unknown) {
	const parsed = workspaceSourceSnapshotSchema.safeParse(value);
	return parsed.success ? parsed.data.sourceStateHash : null;
}

function firstConditionReason(conditions: EvaluatedAcceptanceCondition[]) {
	return (
		conditions.find((condition) => condition.reasonCode)?.reasonCode ??
		("MAPPED_TEST_NOT_RUN" as const)
	);
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
