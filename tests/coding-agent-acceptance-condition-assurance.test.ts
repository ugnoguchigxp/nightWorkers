import { describe, expect, it } from "vitest";
import {
	type AcceptanceConditionAssuranceDataset,
	evaluateAcceptanceConditionAssuranceDataset,
} from "../api/modules/codingAgent/verification/acceptance-condition-assurance.service";
import { evidenceCheckReadinessSnapshotSchema } from "../shared/modules/codingAgent";

const SOURCE = "a".repeat(64);
const NOW = new Date("2026-08-01T00:00:00.000Z");

describe("acceptance condition assurance", () => {
	it("projects stored pre-strict snapshots as legacy without rewriting them", () => {
		const parsed = evidenceCheckReadinessSnapshotSchema.parse({
			runId: null,
			sourceStateHash: null,
			scope: {
				testScope: "none",
				e2eAllowed: false,
				authorizedVerifyCommand: null,
			},
			mapping: {
				status: "missing",
				definitionDigest: null,
				total: 0,
				matched: 0,
				items: [],
			},
			verify: {
				status: "passed",
				command: "bun run verify",
				cwd: "/repo",
				exitCode: 0,
				sourceStateHash: SOURCE,
				finishedAt: NOW.toISOString(),
				logRefs: [],
			},
			confirmation: {
				status: "settled",
				initialEvidenceRunId: "evidence-1",
				confirmedAt: NOW.toISOString(),
			},
			ready: true,
			suggestedAction: "write_final_report",
			readinessDigest: "sha256:legacy",
		});

		expect(parsed.assurance).toMatchObject({
			policyVersion: "legacy_verify_only",
			status: "legacy",
		});
	});

	it("requires an explicit current mapping", () => {
		const input = dataset();
		input.mappings = [];

		expect(evaluateAcceptanceConditionAssuranceDataset(input)).toMatchObject({
			passed: false,
			conditions: [
				{
					assuranceStatus: "unmapped",
					reasonCode: "CONDITION_MAPPING_MISSING",
				},
			],
		});
	});

	it("keeps a mapped testcase incomplete until that exact case passes", () => {
		const input = dataset();
		input.evidenceRuns.push(evidenceRun("verify-run", "verify"));

		expect(evaluateAcceptanceConditionAssuranceDataset(input)).toMatchObject({
			passed: false,
			conditions: [
				{
					assuranceStatus: "not_run",
					reasonCode: "MAPPED_TEST_NOT_RUN",
				},
			],
		});
	});

	it("does not reuse an unrelated successful testcase", () => {
		const input = dataset();
		input.evidenceRuns.push(
			evidenceRun("test-run", "test"),
			evidenceRun("verify-run", "verify"),
		);
		input.evidenceCases.push(evidenceCase("test-run", "different-case"));

		expect(evaluateAcceptanceConditionAssuranceDataset(input).passed).toBe(
			false,
		);
	});

	it("distinguishes empty execution, capture failure, and identity ambiguity", () => {
		const empty = dataset();
		empty.evidenceRuns.push(
			evidenceRun("empty-test-run", "test", {
				parsedArtifactId: "parsed-empty",
				conditionIds: ["AC-001"],
				testExecutionObserved: false,
			}),
		);
		expect(
			evaluateAcceptanceConditionAssuranceDataset(empty).conditions[0],
		).toMatchObject({ reasonCode: "MAPPED_TEST_NOT_RUN" });

		const captureFailed = dataset();
		captureFailed.evidenceRuns.push(
			evidenceRun("capture-failed-run", "test", {
				conditionIds: ["AC-001"],
				testExecutionObserved: false,
			}),
		);
		expect(
			evaluateAcceptanceConditionAssuranceDataset(captureFailed).conditions[0],
		).toMatchObject({ reasonCode: "TEST_EVIDENCE_CAPTURE_FAILED" });

		const ambiguous = dataset();
		ambiguous.evidenceRuns.push(
			evidenceRun("ambiguous-run", "test", {
				parsedArtifactId: "parsed-ambiguous",
				conditionIds: ["AC-001"],
			}),
		);
		ambiguous.evidenceCases.push({
			...evidenceCase("ambiguous-run", "unresolved"),
			caseKey: null,
			conditionIdsJson: ["AC-001"],
			failureMessage: "TEST_IDENTITY_AMBIGUOUS",
		});
		expect(
			evaluateAcceptanceConditionAssuranceDataset(ambiguous).conditions[0],
		).toMatchObject({ reasonCode: "TEST_IDENTITY_AMBIGUOUS" });
	});

	it("classifies missing execution from the latest scoped run only", () => {
		const input = dataset();
		input.evidenceRuns.push(
			evidenceRun("older-failed-run", "test", {
				conditionIds: ["AC-001"],
				exitCode: 1,
				finishedAt: new Date("2026-08-01T00:00:01.000Z"),
			}),
			evidenceRun("latest-empty-run", "test", {
				conditionIds: ["AC-001"],
				parsedArtifactId: "parsed-empty",
				testExecutionObserved: false,
				finishedAt: new Date("2026-08-01T00:00:02.000Z"),
			}),
		);
		input.evidenceCases.push({
			...evidenceCase("older-failed-run", "unresolved"),
			caseKey: null,
			conditionIdsJson: ["AC-001"],
			failureMessage: "TEST_IDENTITY_AMBIGUOUS",
		});

		expect(
			evaluateAcceptanceConditionAssuranceDataset(input).conditions[0],
		).toMatchObject({
			assuranceStatus: "not_run",
			reasonCode: "MAPPED_TEST_NOT_RUN",
		});
	});

	it("ignores unresolved cases unrelated to the required mapping", () => {
		const input = dataset();
		input.evidenceRuns.push(
			evidenceRun("test-run", "test", { parsedArtifactId: "parsed" }),
			evidenceRun("verify-run", "verify"),
		);
		input.evidenceCases.push(evidenceCase("test-run", "case-1"), {
			...evidenceCase("test-run", "unresolved"),
			id: "unrelated-unresolved",
			caseKey: null,
			conditionIdsJson: [],
		});

		expect(evaluateAcceptanceConditionAssuranceDataset(input).passed).toBe(
			true,
		);
	});

	it("passes only with the mapped structured testcase and current full verify", () => {
		const input = dataset();
		input.evidenceRuns.push(
			evidenceRun("test-run", "test"),
			evidenceRun("verify-run", "verify"),
		);
		input.evidenceCases.push(evidenceCase("test-run", "case-1"));

		const result = evaluateAcceptanceConditionAssuranceDataset(input);

		expect(result.passed).toBe(true);
		expect(result.conditions[0]).toMatchObject({
			assuranceStatus: "safe_pass",
			reasonCode: null,
			evidenceRefs: [{ evidenceRunId: "test-run", caseKey: "case-1" }],
		});
	});

	it("rejects source mutation and skipped execution", () => {
		const mutated = dataset();
		mutated.evidenceRuns.push(
			evidenceRun("test-run", "test", { sourceMutatedDuringCheck: true }),
			evidenceRun("verify-run", "verify"),
		);
		mutated.evidenceCases.push(evidenceCase("test-run", "case-1"));
		expect(
			evaluateAcceptanceConditionAssuranceDataset(mutated).conditions[0],
		).toMatchObject({ reasonCode: "CONDITION_SOURCE_MUTATED" });

		const skipped = dataset();
		skipped.evidenceRuns.push(
			evidenceRun("test-run", "test"),
			evidenceRun("verify-run", "verify"),
		);
		skipped.evidenceCases.push(
			evidenceCase("test-run", "case-1", { status: "skipped" }),
		);
		expect(
			evaluateAcceptanceConditionAssuranceDataset(skipped).conditions[0],
		).toMatchObject({
			assuranceStatus: "failed",
			reasonCode: "MAPPED_TEST_FAILED",
		});
	});

	it("fails duplicate evidence for one case closed within the latest run", () => {
		const input = dataset();
		input.evidenceRuns.push(
			evidenceRun("test-run", "test"),
			evidenceRun("verify-run", "verify"),
		);
		input.evidenceCases.push(evidenceCase("test-run", "case-1"), {
			...evidenceCase("test-run", "case-1", { status: "failed" }),
			id: "test-run-case-1-failed",
		});

		expect(
			evaluateAcceptanceConditionAssuranceDataset(input).conditions[0],
		).toMatchObject({
			assuranceStatus: "failed",
			reasonCode: "MAPPED_TEST_FAILED",
		});
	});

	it("does not safe-pass a mapped case from a failed test command", () => {
		const input = dataset();
		input.evidenceRuns.push(
			evidenceRun("failed-test-run", "test", { exitCode: 1 }),
			evidenceRun("verify-run", "verify"),
		);
		input.evidenceCases.push(evidenceCase("failed-test-run", "case-1"));

		expect(
			evaluateAcceptanceConditionAssuranceDataset(input).conditions[0],
		).toMatchObject({
			assuranceStatus: "failed",
			reasonCode: "MAPPED_TEST_FAILED",
		});
	});
});

function dataset(): AcceptanceConditionAssuranceDataset {
	return {
		sourceStateHash: SOURCE,
		checklist: [
			{
				conditionId: "AC-001",
				text: "mapped behavior passes",
				required: true,
				verificationKind: "automated_test",
				expectedEvidenceJson: ["unit_test"],
				status: "pending",
				evidenceIdsJson: [],
			},
		],
		inventory: { id: "inventory-1", sourceSnapshotJson: snapshot(SOURCE) },
		inventoryCases: [
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
		],
		mappings: [
			{
				id: "mapping-1",
				createdAt: NOW,
				updatedAt: NOW,
				taskId: "task-1",
				verificationDocumentId: "document-1",
				inventoryId: "inventory-1",
				caseKey: "case-1",
				conditionId: "AC-001",
				source: "schema_evidence_set",
				rationale: null,
				sourceDigest: SOURCE,
			},
		],
		evidenceRuns: [],
		evidenceCases: [],
		confirmations: [],
	};
}

function evidenceRun(
	id: string,
	checkKind: string,
	input: {
		sourceMutatedDuringCheck?: boolean;
		parsedArtifactId?: string;
		conditionIds?: string[];
		testExecutionObserved?: boolean;
		exitCode?: number;
		finishedAt?: Date;
	} = {},
): AcceptanceConditionAssuranceDataset["evidenceRuns"][number] {
	return {
		id,
		createdAt: NOW,
		updatedAt: NOW,
		taskId: "task-1",
		runId: "run-1",
		verificationDocumentId: "document-1",
		subjectId: null,
		checkKind,
		command: checkKind,
		cwd: "/repo",
		exitCode: input.exitCode ?? 0,
		runner: checkKind === "test" ? "vitest" : "unknown",
		rawStdoutArtifactId: `${id}-stdout`,
		rawStderrArtifactId: `${id}-stderr`,
		parsedArtifactId: input.parsedArtifactId ?? null,
		summaryJson: {},
		evidenceKindsJson: checkKind === "test" ? ["unit_test"] : [],
		commandLevelConditionIdsJson: input.conditionIds ?? [],
		sourceSnapshotJson: snapshot(SOURCE),
		testExecutionObserved: input.testExecutionObserved ?? checkKind === "test",
		sourceMutatedDuringCheck: input.sourceMutatedDuringCheck ?? false,
		startedAt: NOW,
		finishedAt: input.finishedAt ?? NOW,
	};
}

function evidenceCase(
	evidenceRunId: string,
	caseKey: string,
	input: { status?: string } = {},
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
		evidenceKind: "unit_test",
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
