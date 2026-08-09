import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
	selectResults: [] as Array<unknown[] | Error>,
	documentSafeParse: vi.fn(),
	snapshotSafeParse: vi.fn(),
	isAllowedByScope: vi.fn(),
	isCompatibleEvidenceKind: vi.fn(),
	isTestRunnerInScope: vi.fn(),
}));

vi.mock("../api/db/client", () => {
	function select() {
		const queued = harness.selectResults.shift() ?? [];
		const terminal = (
			queued instanceof Error ? Promise.reject(queued) : Promise.resolve(queued)
		) as Promise<unknown[]> & {
			orderBy: (...values: unknown[]) => Promise<unknown[]>;
		};
		terminal.orderBy = vi.fn(() => terminal);
		const query = {
			from: vi.fn(),
			where: vi.fn(() => terminal),
		};
		query.from.mockReturnValue(query);
		return query;
	}
	return { db: { select: vi.fn(select) } };
});

vi.mock("../shared/schemas/verification-checklist.schema", () => ({
	isExpectedEvidenceAllowedByCompletionScope: harness.isAllowedByScope,
	specificationVerificationDocumentSchema: {
		safeParse: harness.documentSafeParse,
	},
	workspaceSourceSnapshotSchema: { safeParse: harness.snapshotSafeParse },
}));

vi.mock(
	"../api/modules/codingAgent/verification/evidence-kind-compatibility",
	() => ({ isCompatibleEvidenceKind: harness.isCompatibleEvidenceKind }),
);

vi.mock("../api/modules/codingAgent/verification/test-scope", () => ({
	isTestRunnerInScope: harness.isTestRunnerInScope,
}));

import {
	resolveRunCheckEvidenceScope,
	selectCaseEvidenceKind,
	validateRunCheckEvidenceScope,
} from "../api/modules/codingAgent/verification/run-check-evidence-scope.service";

const documentRow = { id: "document-1", documentJson: { stored: true } };
const runRow = { id: "run-1" };

type Item = {
	conditionId: string;
	required: boolean;
	verificationKind: string | null;
	expectedEvidenceJson: string[];
};

const unitItem: Item = {
	conditionId: "AC-001",
	required: true,
	verificationKind: "automated_test",
	expectedEvidenceJson: ["automated_test", "unit_test"],
};

function validDocument(
	input: {
		commands?: Array<{
			command: string;
			cwd?: string;
			conditionIds: string[];
			evidenceKinds?: string[];
		}>;
		testScope?: string | null;
	} = {},
) {
	return {
		success: true,
		data: {
			commands: input.commands ?? [],
			testScope: input.testScope === undefined ? "unit" : input.testScope,
		},
	};
}

function authority(input: {
	run?: unknown;
	items?: Item[];
	inventories?: unknown[];
}) {
	harness.selectResults.push(
		[documentRow],
		[input.run === undefined ? runRow : input.run],
		input.items ?? [unitItem],
		input.inventories ?? [],
	);
}

function scopeInput(input: Record<string, unknown> = {}) {
	return {
		taskId: "task-1",
		runId: "run-1",
		verificationDocumentId: documentRow.id,
		command: "npm test",
		cwd: "packages/app",
		repoRoot: "/repo",
		checkKind: "test",
		sourceStateHash: "source-hash",
		...input,
	};
}

function inventory(id: string, cwd = "/repo/packages/app") {
	return {
		id,
		cwd,
		sourceSnapshotJson: { sourceStateHash: "source-hash" },
	};
}

function mapping(
	inventoryId: string,
	caseKey: string,
	conditionId = "AC-001",
	input: Record<string, unknown> = {},
) {
	return {
		inventoryId,
		caseKey,
		conditionId,
		sourceDigest: "source-hash",
		...input,
	};
}

function testCase(
	inventoryId: string,
	caseKey: string,
	runner = "vitest",
	input: Record<string, unknown> = {},
) {
	return {
		inventoryId,
		caseKey,
		runner,
		discoveryLevel: "active",
		...input,
	};
}

beforeEach(() => {
	vi.resetAllMocks();
	harness.selectResults.length = 0;
	harness.documentSafeParse.mockReturnValue(validDocument());
	harness.snapshotSafeParse.mockImplementation((value: unknown) => {
		if (
			value &&
			typeof value === "object" &&
			"sourceStateHash" in value &&
			typeof value.sourceStateHash === "string"
		) {
			return { success: true, data: value };
		}
		return { success: false };
	});
	harness.isAllowedByScope.mockReturnValue(true);
	harness.isCompatibleEvidenceKind.mockImplementation(
		(expected: string, actual: string) =>
			expected === actual ||
			(expected === "automated_test" && actual.endsWith("_test")),
	);
	harness.isTestRunnerInScope.mockReturnValue(true);
});

describe("run check evidence scope service extra coverage", () => {
	it("selects specific, generic, empty, duplicate, and conflicting testcase evidence", () => {
		expect(selectCaseEvidenceKind([])).toBeUndefined();
		expect(selectCaseEvidenceKind(["invalid", "lint"])).toBeUndefined();
		expect(selectCaseEvidenceKind(["automated_test"])).toBe("automated_test");
		expect(selectCaseEvidenceKind(["automated_test", "unit_test"])).toBe(
			"unit_test",
		);
		expect(selectCaseEvidenceKind(["unit_test", "unit_test"])).toBe(
			"unit_test",
		);
		for (const kind of ["integration_test", "e2e_test"]) {
			expect(selectCaseEvidenceKind([kind])).toBe(kind);
		}
		expect(() =>
			selectCaseEvidenceKind(["unit_test", "integration_test"]),
		).toThrowError(
			expect.objectContaining({
				code: "TEST_MAPPING_EVIDENCE_KIND_CONFLICT",
				details: {
					retryable: true,
					suggestedAction: "record_test_condition_mapping",
				},
			}),
		);
	});

	it("rejects missing authority, database failures, and invalid Verification Documents", async () => {
		harness.selectResults.push([], [runRow], [unitItem], []);
		await expect(
			resolveRunCheckEvidenceScope(scopeInput()),
		).rejects.toMatchObject({
			code: "verification_evidence_scope_mismatch",
		});

		harness.selectResults.push([documentRow], [], [unitItem], []);
		await expect(
			resolveRunCheckEvidenceScope(scopeInput()),
		).rejects.toMatchObject({
			code: "verification_evidence_scope_mismatch",
		});

		harness.selectResults.push(
			new Error("database unavailable"),
			[runRow],
			[],
			[],
		);
		await expect(resolveRunCheckEvidenceScope(scopeInput())).rejects.toThrow(
			"database unavailable",
		);

		authority({});
		harness.documentSafeParse.mockReturnValueOnce({ success: false });
		await expect(
			resolveRunCheckEvidenceScope(scopeInput()),
		).rejects.toMatchObject({
			code: "TEST_EVIDENCE_CAPTURE_FAILED",
			details: {
				retryable: false,
				suggestedAction: "report_test_evidence_failure",
			},
		});
	});

	it("requires a Run identity even when the active document exists", async () => {
		harness.selectResults.push([documentRow], [unitItem]);
		await expect(
			resolveRunCheckEvidenceScope(
				scopeInput({ runId: undefined, checkKind: "lint" }),
			),
		).rejects.toMatchObject({ code: "verification_evidence_scope_mismatch" });
	});

	it("maps every non-test check kind through fallback evidence", async () => {
		const cases = [
			["lint", "lint"],
			["format_check", "format_check"],
			["typecheck", "typecheck"],
			["coverage", "coverage"],
			["build", "build"],
			["unknown", undefined],
		] as const;
		for (const [checkKind, expected] of cases) {
			authority({ items: [] });
			await expect(
				resolveRunCheckEvidenceScope(scopeInput({ checkKind })),
			).resolves.toMatchObject({
				inventoryId: null,
				conditionIds: [],
				evidenceKinds: expected ? [expected] : [],
				runner: "unknown",
				caseScopes: {},
				mappedCaseKeys: [],
			});
		}
	});

	it("matches declared commands and normalized cwd with planned evidence precedence", async () => {
		harness.documentSafeParse.mockReturnValue(
			validDocument({
				commands: [
					{
						command: "pnpm lint",
						cwd: "packages/app/",
						conditionIds: ["AC-002", "AC-001", "AC-002"],
						evidenceKinds: ["lint", "lint", "invalid"],
					},
					{
						command: "npm test",
						cwd: ".",
						conditionIds: ["ignored"],
					},
				],
			}),
		);
		authority({
			items: [
				{
					...unitItem,
					conditionId: "AC-001",
					expectedEvidenceJson: ["lint", "build"],
				},
				{
					...unitItem,
					conditionId: "AC-002",
					expectedEvidenceJson: ["lint", "typecheck"],
				},
			],
		});
		await expect(
			resolveRunCheckEvidenceScope(
				scopeInput({
					command: "alias",
					declaredCommand: "pnpm lint",
					cwd: " packages/app/// ",
					checkKind: "lint",
				}),
			),
		).resolves.toMatchObject({
			conditionIds: ["AC-001", "AC-002"],
			evidenceKinds: ["lint"],
		});
	});

	it("derives planned evidence from checklist items and enforces command gates", async () => {
		harness.documentSafeParse.mockReturnValue(
			validDocument({
				commands: [
					{
						command: "npm run check",
						cwd: undefined,
						conditionIds: ["AC-001"],
					},
				],
			}),
		);
		authority({
			items: [{ ...unitItem, expectedEvidenceJson: ["typecheck", "invalid"] }],
		});
		await expect(
			resolveRunCheckEvidenceScope(
				scopeInput({
					command: "npm run check",
					cwd: ".",
					checkKind: "typecheck",
				}),
			),
		).resolves.toMatchObject({
			conditionIds: ["AC-001"],
			evidenceKinds: ["typecheck"],
		});

		harness.documentSafeParse.mockReturnValue(validDocument());
		authority({
			items: [
				{
					...unitItem,
					verificationKind: "command_gate",
					expectedEvidenceJson: ["lint"],
				},
			],
		});
		await expect(
			resolveRunCheckEvidenceScope(scopeInput({ checkKind: "lint" })),
		).rejects.toMatchObject({ code: "COMMAND_GATE_PLAN_MISSING" });
	});

	it("validates disallowed, unknown, manual, incompatible, and empty scopes", async () => {
		authority({ items: [] });
		await expect(
			validateRunCheckEvidenceScope({
				taskId: "task-1",
				runId: "run-1",
				verificationDocumentId: documentRow.id,
				conditionIds: [],
				evidenceKinds: [],
			}),
		).rejects.toMatchObject({
			code: "verification_scope_declaration_required",
		});

		authority({ items: [] });
		harness.documentSafeParse.mockReturnValueOnce({ success: false });
		await expect(
			validateRunCheckEvidenceScope({
				taskId: "task-1",
				runId: "run-1",
				verificationDocumentId: documentRow.id,
				conditionIds: [],
				evidenceKinds: [],
			}),
		).resolves.toBeUndefined();

		authority({ items: [] });
		harness.isAllowedByScope.mockReturnValueOnce(false);
		await expect(
			validateRunCheckEvidenceScope({
				taskId: "task-1",
				runId: "run-1",
				verificationDocumentId: documentRow.id,
				conditionIds: [],
				evidenceKinds: ["e2e_test"],
			}),
		).rejects.toMatchObject({ code: "VERIFICATION_SCOPE_DENIED" });

		authority({ items: [unitItem] });
		await expect(
			validateRunCheckEvidenceScope({
				taskId: "task-1",
				runId: "run-1",
				verificationDocumentId: documentRow.id,
				conditionIds: ["AC-001", "missing", "missing"],
				evidenceKinds: ["unit_test"],
			}),
		).rejects.toMatchObject({ code: "unknown_verification_condition" });

		authority({
			items: [{ ...unitItem, verificationKind: "manual" }],
		});
		await expect(
			validateRunCheckEvidenceScope({
				taskId: "task-1",
				runId: "run-1",
				verificationDocumentId: documentRow.id,
				conditionIds: ["AC-001"],
				evidenceKinds: ["manual_evidence"],
			}),
		).rejects.toMatchObject({
			code: "manual_condition_requires_human_confirmation",
		});

		authority({ items: [unitItem] });
		harness.isCompatibleEvidenceKind.mockReturnValue(false);
		await expect(
			validateRunCheckEvidenceScope({
				taskId: "task-1",
				runId: "run-1",
				verificationDocumentId: documentRow.id,
				conditionIds: ["AC-001"],
				evidenceKinds: ["coverage"],
			}),
		).rejects.toMatchObject({ code: "verification_evidence_kind_mismatch" });
	});

	it("requires a current inventory matching the exact source snapshot", async () => {
		authority({
			inventories: [
				{ ...inventory("invalid"), sourceSnapshotJson: null },
				{
					...inventory("stale"),
					sourceSnapshotJson: { sourceStateHash: "stale-hash" },
				},
			],
		});
		await expect(
			resolveRunCheckEvidenceScope(scopeInput()),
		).rejects.toMatchObject({
			code: "TEST_INVENTORY_MISSING",
			details: {
				retryable: true,
				suggestedAction: "collect_test_inventory",
			},
		});
	});

	it("rejects missing and incomplete active testcase mappings", async () => {
		authority({ inventories: [inventory("inventory-1")] });
		harness.selectResults.push([], []);
		await expect(
			resolveRunCheckEvidenceScope(scopeInput()),
		).rejects.toMatchObject({
			code: "CONDITION_MAPPING_MISSING",
		});

		authority({
			items: [unitItem, { ...unitItem, conditionId: "AC-002" }],
			inventories: [inventory("inventory-1")],
		});
		harness.selectResults.push(
			[mapping("inventory-1", "case-1")],
			[testCase("inventory-1", "case-1")],
		);
		await expect(
			resolveRunCheckEvidenceScope(scopeInput()),
		).rejects.toMatchObject({
			code: "CONDITION_MAPPING_MISSING",
			details: { suggestedAction: "record_test_condition_mapping" },
		});
	});

	it("rejects mappings whose cases are inactive or outside the declared test scope", async () => {
		authority({
			items: [],
			inventories: [inventory("inventory-1")],
		});
		harness.selectResults.push(
			[mapping("inventory-1", "inactive", "optional")],
			[
				testCase("inventory-1", "inactive", "vitest", {
					discoveryLevel: "reference",
				}),
			],
		);
		await expect(
			resolveRunCheckEvidenceScope(scopeInput()),
		).rejects.toMatchObject({
			code: "CONDITION_MAPPING_MISSING",
		});

		authority({
			items: [],
			inventories: [inventory("inventory-2")],
		});
		harness.isTestRunnerInScope.mockReturnValue(false);
		harness.selectResults.push(
			[mapping("inventory-2", "outside", "optional")],
			[testCase("inventory-2", "outside")],
		);
		await expect(
			resolveRunCheckEvidenceScope(scopeInput()),
		).rejects.toMatchObject({
			code: "CONDITION_MAPPING_MISSING",
		});
	});

	it("selects the strongest complete inventory and builds sorted case scopes", async () => {
		const items = [
			unitItem,
			{
				...unitItem,
				conditionId: "AC-002",
				expectedEvidenceJson: ["automated_test", "unit_test"],
			},
			{
				...unitItem,
				conditionId: "OPTIONAL",
				required: false,
				expectedEvidenceJson: ["invalid"],
			},
		];
		const inventories = [
			inventory("no-mappings", "/repo/packages/app"),
			inventory("partial", "/repo/packages/app"),
			inventory("unknown-runner", "/repo/packages/app"),
			inventory("complete-wrong-cwd", "/repo/other"),
			inventory("complete-exact", "/repo/packages/app"),
		];
		authority({ items, inventories });
		harness.selectResults.push(
			[
				mapping("partial", "partial-case"),
				mapping("unknown-runner", "unknown-case", "AC-001"),
				mapping("unknown-runner", "unknown-case", "AC-002"),
				mapping("complete-wrong-cwd", "wrong-case", "AC-001"),
				mapping("complete-wrong-cwd", "wrong-case", "AC-002"),
				mapping("complete-exact", "z-case", "AC-002"),
				mapping("complete-exact", "a-case", "AC-001"),
				mapping("complete-exact", "a-case", "AC-001"),
				mapping("complete-exact", "optional-case", "OPTIONAL"),
				mapping("complete-exact", "ignored-digest", "AC-001", {
					sourceDigest: "stale",
				}),
			],
			[
				testCase("partial", "partial-case"),
				testCase("unknown-runner", "unknown-case", "unknown"),
				testCase("complete-wrong-cwd", "wrong-case", "junit"),
				testCase("complete-exact", "z-case", "vitest"),
				testCase("complete-exact", "a-case", "vitest"),
				testCase("complete-exact", "optional-case", "vitest"),
			],
		);
		harness.isCompatibleEvidenceKind.mockReturnValue(true);
		await expect(resolveRunCheckEvidenceScope(scopeInput())).resolves.toEqual({
			verificationDocumentId: documentRow.id,
			inventoryId: "complete-exact",
			conditionIds: ["AC-001", "AC-002", "OPTIONAL"],
			evidenceKinds: ["unit_test"],
			runner: "vitest",
			caseScopes: {
				"a-case": { conditionIds: ["AC-001"], evidenceKind: "unit_test" },
				"optional-case": { conditionIds: ["OPTIONAL"] },
				"z-case": { conditionIds: ["AC-002"], evidenceKind: "unit_test" },
			},
			mappedCaseKeys: ["a-case", "optional-case", "z-case"],
		});
	});

	it("filters mappings to planned conditions before selecting an inventory", async () => {
		harness.documentSafeParse.mockReturnValue(
			validDocument({
				commands: [
					{
						command: "npm test",
						cwd: "packages/app",
						conditionIds: ["AC-002"],
					},
				],
			}),
		);
		authority({
			items: [unitItem, { ...unitItem, conditionId: "AC-002" }],
			inventories: [inventory("inventory-1")],
		});
		harness.selectResults.push(
			[
				mapping("inventory-1", "wrong", "AC-001"),
				mapping("inventory-1", "right", "AC-002"),
			],
			[testCase("inventory-1", "wrong"), testCase("inventory-1", "right")],
		);
		await expect(
			resolveRunCheckEvidenceScope(scopeInput()),
		).resolves.toMatchObject({
			conditionIds: ["AC-002"],
			mappedCaseKeys: ["right"],
		});
	});

	it("rejects ambiguous, unknown, and absent mapped runners", async () => {
		async function resolveWithRunners(runners: string[]) {
			authority({ inventories: [inventory("inventory-1")] });
			harness.selectResults.push(
				runners.map((_, index) =>
					mapping("inventory-1", `case-${index}`, "AC-001"),
				),
				runners.map((runner, index) =>
					testCase("inventory-1", `case-${index}`, runner),
				),
			);
			return resolveRunCheckEvidenceScope(scopeInput());
		}

		await expect(
			resolveWithRunners(["vitest", "playwright"]),
		).rejects.toMatchObject({ code: "TEST_INVENTORY_RUNNER_UNRESOLVED" });
		await expect(resolveWithRunners(["unknown"])).rejects.toMatchObject({
			code: "TEST_INVENTORY_RUNNER_UNRESOLVED",
		});
		await expect(resolveWithRunners(["junit"])).resolves.toMatchObject({
			runner: "junit",
		});
		await expect(
			resolveWithRunners(["junit", "vitest"]),
		).resolves.toMatchObject({
			runner: "vitest",
		});
	});
});
