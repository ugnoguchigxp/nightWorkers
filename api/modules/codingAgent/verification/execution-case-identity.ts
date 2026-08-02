import { and, desc, eq } from "drizzle-orm";
import type {
	ExpectedEvidence,
	NormalizedTestCaseEvidence,
	VerificationRunner,
} from "../../../../shared/schemas/verification-checklist.schema";
import { workspaceSourceSnapshotSchema } from "../../../../shared/schemas/verification-checklist.schema";
import { db } from "../../../db/client";
import {
	codingAgentTestInventoryCases,
	codingAgentTestInventoryRuns,
} from "../../../db/verification-schema";
import {
	isLegacyStaticCaseKey,
	normalizeTestCaseName,
	resolveAbsoluteTestCasePath,
} from "./test-case-identity";

type CaseEvidenceScope = {
	conditionIds: string[];
	evidenceKind?: NormalizedTestCaseEvidence["evidenceKind"];
};

export type ExecutionCaseIdentityResolution = {
	cases: NormalizedTestCaseEvidence[];
	inventoryId: string | null;
	ambiguousMappedCaseKeys: string[];
	mismatchedMappedCaseKeys: string[];
};

export async function resolveExecutionCaseIdentities(input: {
	taskId: string;
	runId: string;
	sourceStateHash: string;
	evidenceCwd: string;
	runner: VerificationRunner;
	evidenceKinds: ExpectedEvidence[];
	cases: NormalizedTestCaseEvidence[];
	caseScopes?: Record<string, CaseEvidenceScope>;
	inventoryId?: string;
}): Promise<NormalizedTestCaseEvidence[]> {
	return (await resolveExecutionCaseIdentityDetails(input)).cases;
}

export async function resolveExecutionCaseIdentityDetails(input: {
	taskId: string;
	runId: string;
	sourceStateHash: string;
	evidenceCwd: string;
	runner: VerificationRunner;
	evidenceKinds: ExpectedEvidence[];
	cases: NormalizedTestCaseEvidence[];
	caseScopes?: Record<string, CaseEvidenceScope>;
	inventoryId?: string;
}): Promise<ExecutionCaseIdentityResolution> {
	if (input.cases.length === 0) {
		return {
			cases: [],
			inventoryId: null,
			ambiguousMappedCaseKeys: [],
			mismatchedMappedCaseKeys: [],
		};
	}
	const inventories = await db
		.select()
		.from(codingAgentTestInventoryRuns)
		.where(
			and(
				eq(codingAgentTestInventoryRuns.taskId, input.taskId),
				eq(codingAgentTestInventoryRuns.runId, input.runId),
			),
		)
		.orderBy(
			desc(codingAgentTestInventoryRuns.createdAt),
			desc(codingAgentTestInventoryRuns.id),
		);
	const inventory = inventories.find((candidate) => {
		const parsed = workspaceSourceSnapshotSchema.safeParse(
			candidate.sourceSnapshotJson,
		);
		return (
			parsed.success &&
			parsed.data.sourceStateHash === input.sourceStateHash &&
			(!input.inventoryId || candidate.id === input.inventoryId)
		);
	});
	if (!inventory) {
		return {
			cases: input.cases,
			inventoryId: null,
			ambiguousMappedCaseKeys: [],
			mismatchedMappedCaseKeys: [],
		};
	}
	const definitions = await db
		.select()
		.from(codingAgentTestInventoryCases)
		.where(eq(codingAgentTestInventoryCases.inventoryId, inventory.id));
	const evidenceKind = selectAutomatedEvidenceKind(input.evidenceKinds);
	const ambiguousMappedCaseKeys = new Set<string>();
	const mismatchedMappedCaseKeys = new Set<string>();
	const resolvedMappedCaseKeys = new Set<string>();
	const diagnostics: Array<{
		ambiguousDefinitions: Array<
			typeof codingAgentTestInventoryCases.$inferSelect
		>;
		mismatchDefinitions: Array<
			typeof codingAgentTestInventoryCases.$inferSelect
		>;
	}> = [];
	const cases = input.cases.map((testCase) => {
		const matches = definitions.filter((definition) =>
			matchesDefinition({
				definition,
				testCase,
				inventoryCwd: inventory.cwd,
				evidenceCwd: input.evidenceCwd,
				runner: input.runner,
			}),
		);
		if (matches.length !== 1) {
			const mappedMatches = matches.filter(
				(definition) => input.caseScopes?.[definition.caseKey],
			);
			for (const definition of mappedMatches) {
				ambiguousMappedCaseKeys.add(definition.caseKey);
			}
			const identityMismatches = definitions.filter(
				(definition) =>
					!matches.some((match) => match.id === definition.id) &&
					input.caseScopes?.[definition.caseKey] &&
					matchesDefinitionNameAndRunner({
						definition,
						testCase,
						runner: input.runner,
					}),
			);
			diagnostics.push({
				ambiguousDefinitions: mappedMatches,
				mismatchDefinitions: identityMismatches,
			});
			return {
				...testCase,
				runner: testCase.runner ?? input.runner,
				...(testCase.evidenceKind || !evidenceKind ? {} : { evidenceKind }),
			};
		}
		diagnostics.push({ ambiguousDefinitions: [], mismatchDefinitions: [] });
		const matched = matches[0];
		const scope = matched ? input.caseScopes?.[matched.caseKey] : undefined;
		if (matched && scope) resolvedMappedCaseKeys.add(matched.caseKey);
		return {
			...testCase,
			caseKey: matched?.caseKey,
			runner: testCase.runner ?? input.runner,
			...(scope ? { conditionIds: scope.conditionIds } : {}),
			...(testCase.evidenceKind
				? {}
				: scope?.evidenceKind
					? { evidenceKind: scope.evidenceKind }
					: evidenceKind
						? { evidenceKind }
						: {}),
		};
	});
	const annotatedCases = cases.map((testCase, index) => {
		const diagnostic = diagnostics[index];
		if (!diagnostic) return testCase;
		const mismatches = diagnostic.mismatchDefinitions.filter(
			(definition) => !resolvedMappedCaseKeys.has(definition.caseKey),
		);
		for (const definition of mismatches) {
			mismatchedMappedCaseKeys.add(definition.caseKey);
		}
		const conditionIds = Array.from(
			new Set(
				[...diagnostic.ambiguousDefinitions, ...mismatches].flatMap(
					(definition) =>
						input.caseScopes?.[definition.caseKey]?.conditionIds ?? [],
				),
			),
		).sort();
		if (conditionIds.length === 0) return testCase;
		return {
			...testCase,
			conditionIds,
			failureMessage:
				diagnostic.ambiguousDefinitions.length > 0
					? "TEST_IDENTITY_AMBIGUOUS"
					: "TEST_EVIDENCE_CAPTURE_FAILED",
		};
	});
	return {
		cases: annotatedCases,
		inventoryId: inventory.id,
		ambiguousMappedCaseKeys: [...ambiguousMappedCaseKeys].sort(),
		mismatchedMappedCaseKeys: [...mismatchedMappedCaseKeys].sort(),
	};
}

function matchesDefinition(input: {
	definition: typeof codingAgentTestInventoryCases.$inferSelect;
	testCase: NormalizedTestCaseEvidence;
	inventoryCwd: string;
	evidenceCwd: string;
	runner: VerificationRunner;
}) {
	if (!matchesDefinitionNameAndRunner(input)) return false;
	if (!input.testCase.filePath) return false;
	return (
		resolveAbsoluteTestCasePath({
			filePath: input.definition.filePath,
			cwd: input.inventoryCwd,
		}) ===
		resolveAbsoluteTestCasePath({
			filePath: input.testCase.filePath,
			cwd: input.evidenceCwd,
		})
	);
}

function matchesDefinitionNameAndRunner(input: {
	definition: typeof codingAgentTestInventoryCases.$inferSelect;
	testCase: NormalizedTestCaseEvidence;
	runner: VerificationRunner;
}) {
	const observedRunner = input.testCase.runner ?? input.runner;
	if (
		observedRunner === "unknown" ||
		(input.definition.runner !== observedRunner &&
			input.definition.runner !== "junit")
	) {
		return false;
	}
	const expectedName = normalizeTestCaseName(input.definition.name);
	const actualName = normalizeTestCaseName(input.testCase.name);
	return (
		actualName === expectedName ||
		(isLegacyStaticCaseKey(input.definition.caseKey) &&
			actualName.endsWith(` ${expectedName}`))
	);
}

function selectAutomatedEvidenceKind(
	values: ExpectedEvidence[],
): NormalizedTestCaseEvidence["evidenceKind"] | undefined {
	const automated = values.filter(
		(value): value is NonNullable<NormalizedTestCaseEvidence["evidenceKind"]> =>
			value === "automated_test" ||
			value === "unit_test" ||
			value === "integration_test" ||
			value === "e2e_test",
	);
	return automated.length === 1 ? automated[0] : undefined;
}
