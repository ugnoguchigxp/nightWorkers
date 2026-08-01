import { describe, expect, it } from "vitest";
import {
	type AcceptanceConditionAssuranceDataset,
	evaluateAcceptanceConditionAssuranceDataset,
} from "../api/modules/codingAgent/verification/acceptance-condition-assurance.service";

const SOURCE = "a".repeat(64);
const NOW = new Date("2026-08-01T00:00:00.000Z");

describe("acceptance condition assurance", () => {
	it("does not pass an empty acceptance checklist", () => {
		const input = dataset();
		input.checklist = [];
		input.inventoryCases = [];
		input.mappings = [];

		const result = evaluateAcceptanceConditionAssuranceDataset(input);

		expect(result.passed).toBe(false);
		expect(result.qualityGate.passed).toBe(false);
	});

	it("treats an optional not-applicable condition as complete", () => {
		const input = dataset({
			verificationKind: "not_applicable",
			required: false,
			withInventory: false,
		});

		const result = evaluateAcceptanceConditionAssuranceDataset(input);

		expect(result.conditions[0]?.assuranceStatus).toBe("not_applicable");
		expect(result.passed).toBe(true);
	});

	it("[AC-003] keeps a mapped test incomplete until that exact case passes", () => {
		const result = evaluateAcceptanceConditionAssuranceDataset(dataset());

		expect(result.conditions[0]).toMatchObject({
			conditionId: "AC-003",
			assuranceStatus: "not_run",
			reasonCode: "CONDITION_CASE_EXECUTION_MISSING",
		});
		expect(result.passed).toBe(false);
	});

	it("[AC-002] ignores checklist projections and unmanaged success claims", () => {
		const input = dataset();
		input.checklist[0] = {
			...input.checklist[0],
			status: "passed",
			evidenceIdsJson: ["raw-shell-exit-zero", "assistant-complete-claim"],
		};

		const result = evaluateAcceptanceConditionAssuranceDataset(input);

		expect(result.conditions[0]).toMatchObject({
			assuranceStatus: "not_run",
			reasonCode: "CONDITION_CASE_EXECUTION_MISSING",
		});
		expect(result.passed).toBe(false);
	});

	it("[AC-004] does not use an unrelated successful test execution", () => {
		const input = dataset();
		input.evidenceRuns.push(evidenceRun("test-run", "test"));
		input.evidenceCases.push(evidenceCase("test-run", "different-case"));

		const result = evaluateAcceptanceConditionAssuranceDataset(input);

		expect(result.conditions[0]?.assuranceStatus).toBe("not_run");
		expect(result.passed).toBe(false);
	});

	it("[AC-005] rejects a successful test command without structured cases", () => {
		const input = dataset();
		input.evidenceRuns.push(evidenceRun("empty-test-run", "test"));

		const result = evaluateAcceptanceConditionAssuranceDataset(input);

		expect(result.conditions[0]).toMatchObject({
			assuranceStatus: "details_missing",
			reasonCode: "CONDITION_CASE_DETAILS_MISSING",
		});
		expect(result.passed).toBe(false);
	});

	it("[AC-001][AC-010] accepts current exact execution independently from full verify", () => {
		const input = dataset();
		input.evidenceRuns.push(evidenceRun("test-run", "test"));
		input.evidenceCases.push(evidenceCase("test-run", "case-1"));

		const beforeVerify = evaluateAcceptanceConditionAssuranceDataset(input);
		expect(beforeVerify.conditions[0]?.assuranceStatus).toBe("safe_pass");
		expect(beforeVerify.qualityGate.fullVerify.status).toBe("failed");
		expect(beforeVerify.passed).toBe(false);

		input.evidenceRuns.push(evidenceRun("verify-run", "verify"));
		const afterVerify = evaluateAcceptanceConditionAssuranceDataset(input);
		expect(afterVerify.passed).toBe(true);
	});

	it("[AC-005][AC-007] rejects skipped and evidence-kind mismatched cases", () => {
		const skippedInput = dataset();
		skippedInput.evidenceRuns.push(evidenceRun("test-run", "test"));
		skippedInput.evidenceCases.push(
			evidenceCase("test-run", "case-1", {
				status: "skipped",
			}),
		);
		expect(
			evaluateAcceptanceConditionAssuranceDataset(skippedInput).conditions[0],
		).toMatchObject({
			assuranceStatus: "failed",
			reasonCode: "CONDITION_CASE_SKIPPED",
		});

		const mismatchInput = dataset();
		mismatchInput.evidenceRuns.push(evidenceRun("test-run", "test"));
		mismatchInput.evidenceCases.push(
			evidenceCase("test-run", "case-1", {
				evidenceKind: "e2e_test",
			}),
		);
		expect(
			evaluateAcceptanceConditionAssuranceDataset(mismatchInput).conditions[0],
		).toMatchObject({
			assuranceStatus: "details_missing",
			reasonCode: "CONDITION_EVIDENCE_KIND_MISMATCH",
		});
	});

	it("[AC-007] requires every declared evidence kind", () => {
		const input = dataset({
			expectedEvidence: ["unit_test", "e2e_test"],
		});
		input.evidenceRuns.push(evidenceRun("unit-run", "test"));
		input.evidenceCases.push(evidenceCase("unit-run", "case-1"));

		const result = evaluateAcceptanceConditionAssuranceDataset(input);

		expect(result.conditions[0]).toMatchObject({
			assuranceStatus: "details_missing",
			reasonCode: "CONDITION_EVIDENCE_KIND_MISMATCH",
		});
		expect(result.passed).toBe(false);
	});

	it("[AC-006] rejects current-hash evidence when source mutated during execution", () => {
		const input = dataset();
		input.evidenceRuns.push(
			evidenceRun("test-run", "test", { sourceMutatedDuringCheck: true }),
		);
		input.evidenceCases.push(evidenceCase("test-run", "case-1"));

		expect(
			evaluateAcceptanceConditionAssuranceDataset(input).conditions[0],
		).toMatchObject({
			assuranceStatus: "stale",
			reasonCode: "CONDITION_SOURCE_MUTATED",
		});
	});

	it("[AC-008] requires explicit scope and compatible kind for a command gate", () => {
		const input = dataset({
			verificationKind: "command_gate",
			expectedEvidence: ["typecheck"],
			withInventory: false,
		});
		input.evidenceRuns.push(
			evidenceRun("typecheck-run", "typecheck", {
				evidenceKinds: ["typecheck"],
				conditionIds: ["AC-003"],
			}),
			evidenceRun("verify-run", "verify"),
		);

		const result = evaluateAcceptanceConditionAssuranceDataset(input);
		expect(result.conditions[0]?.assuranceStatus).toBe("safe_pass");
		expect(result.passed).toBe(true);

		const mutated = dataset({
			verificationKind: "command_gate",
			expectedEvidence: ["typecheck"],
			withInventory: false,
		});
		mutated.evidenceRuns.push(
			evidenceRun("mutated-typecheck", "typecheck", {
				evidenceKinds: ["typecheck"],
				conditionIds: ["AC-003"],
				sourceMutatedDuringCheck: true,
			}),
		);
		expect(
			evaluateAcceptanceConditionAssuranceDataset(mutated).conditions[0],
		).toMatchObject({
			assuranceStatus: "stale",
			reasonCode: "CONDITION_SOURCE_MUTATED",
		});
	});

	it("[AC-009] keeps manual conditions pending without explicit evidence", () => {
		const pending = dataset({
			verificationKind: "manual",
			expectedEvidence: ["manual_evidence"],
			withInventory: false,
		});
		expect(
			evaluateAcceptanceConditionAssuranceDataset(pending).conditions[0],
		).toMatchObject({
			assuranceStatus: "manual",
			reasonCode: "MANUAL_CONFIRMATION_MISSING",
		});

		pending.confirmations.push({
			id: "confirmation-1",
			createdAt: NOW,
			updatedAt: NOW,
			taskId: "task-1",
			runId: "run-1",
			verificationDocumentId: "document-1",
			conditionId: "AC-003",
			actorKind: "human_reviewer",
			actorId: "review-result-1",
			sourceStateHash: SOURCE,
			evidenceRef: "review-result:review-result-1",
		});
		expect(evaluateAcceptanceConditionAssuranceDataset(pending).passed).toBe(
			true,
		);
	});
});

function dataset(
	input: {
		verificationKind?:
			| "automated_test"
			| "command_gate"
			| "manual"
			| "not_applicable";
		expectedEvidence?: AcceptanceConditionAssuranceDataset["checklist"][number]["expectedEvidenceJson"];
		withInventory?: boolean;
		required?: boolean;
	} = {},
): AcceptanceConditionAssuranceDataset {
	const withInventory = input.withInventory ?? true;
	return {
		sourceStateHash: SOURCE,
		checklist: [
			{
				conditionId: "AC-003",
				text: "mapped behavior passes",
				required: input.required ?? true,
				verificationKind: input.verificationKind ?? "automated_test",
				expectedEvidenceJson: input.expectedEvidence ?? ["unit_test"],
				status: "pending",
				evidenceIdsJson: [],
			},
		],
		inventory: withInventory
			? { id: "inventory-1", sourceSnapshotJson: snapshot(SOURCE) }
			: null,
		inventoryCases: withInventory
			? [
					{
						id: "inventory-case-1",
						createdAt: NOW,
						updatedAt: NOW,
						inventoryId: "inventory-1",
						caseKey: "case-1",
						name: "mapped behavior passes",
						filePath: "tests/example.test.ts",
						runner: "vitest",
						discoveryLevel: "active",
						declaredConditionIdsJson: [],
					},
				]
			: [],
		mappings: withInventory
			? [
					{
						id: "mapping-1",
						createdAt: NOW,
						updatedAt: NOW,
						taskId: "task-1",
						verificationDocumentId: "document-1",
						inventoryId: "inventory-1",
						caseKey: "case-1",
						conditionId: "AC-003",
						source: "schema_evidence_set",
						rationale: null,
						sourceDigest: SOURCE,
					},
				]
			: [],
		evidenceRuns: [],
		evidenceCases: [],
		confirmations: [],
	};
}

function evidenceRun(
	id: string,
	checkKind: string,
	input: {
		sourceStateHash?: string;
		sourceMutatedDuringCheck?: boolean;
		evidenceKinds?: string[];
		conditionIds?: string[];
		exitCode?: number;
	} = {},
): AcceptanceConditionAssuranceDataset["evidenceRuns"][number] {
	return {
		id,
		createdAt: NOW,
		updatedAt: NOW,
		taskId: "task-1",
		runId: "run-1",
		verificationDocumentId: "document-1",
		subjectId: "subject-1",
		checkKind,
		command: checkKind,
		cwd: "/repo",
		exitCode: input.exitCode ?? 0,
		runner: checkKind === "test" ? "vitest" : "unknown",
		rawStdoutArtifactId: `${id}-stdout`,
		rawStderrArtifactId: `${id}-stderr`,
		parsedArtifactId: null,
		summaryJson: {},
		evidenceKindsJson: input.evidenceKinds ?? [],
		commandLevelConditionIdsJson: input.conditionIds ?? [],
		sourceSnapshotJson: snapshot(input.sourceStateHash ?? SOURCE),
		testExecutionObserved: checkKind === "test",
		sourceMutatedDuringCheck: input.sourceMutatedDuringCheck ?? false,
		startedAt: NOW,
		finishedAt: NOW,
	};
}

function evidenceCase(
	evidenceRunId: string,
	caseKey: string,
	input: {
		status?: string;
		evidenceKind?: string;
	} = {},
): AcceptanceConditionAssuranceDataset["evidenceCases"][number] {
	return {
		id: `${evidenceRunId}-${caseKey}`,
		createdAt: NOW,
		updatedAt: NOW,
		evidenceRunId,
		verificationDocumentId: "document-1",
		conditionIdsJson: [],
		caseKey,
		name: "mapped behavior passes",
		filePath: "tests/example.test.ts",
		runner: "vitest",
		evidenceKind: input.evidenceKind ?? "unit_test",
		status: input.status ?? "passed",
		durationMs: 10,
		failureMessage: null,
	};
}

function snapshot(sourceStateHash: string) {
	return {
		sourceStateHash,
		gitHead: null,
		fileCount: 1,
		capturedAt: "2026-08-01T00:00:00.000Z",
	};
}
