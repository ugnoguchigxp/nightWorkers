import path from "node:path";
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

export async function resolveExecutionCaseIdentities(input: {
	taskId: string;
	runId: string;
	sourceStateHash: string;
	evidenceCwd: string;
	runner: VerificationRunner;
	evidenceKinds: ExpectedEvidence[];
	cases: NormalizedTestCaseEvidence[];
}): Promise<NormalizedTestCaseEvidence[]> {
	if (input.cases.length === 0) return [];
	const inventories = await db
		.select()
		.from(codingAgentTestInventoryRuns)
		.where(
			and(
				eq(codingAgentTestInventoryRuns.taskId, input.taskId),
				eq(codingAgentTestInventoryRuns.runId, input.runId),
			),
		)
		.orderBy(desc(codingAgentTestInventoryRuns.createdAt));
	const inventory = inventories.find((candidate) => {
		const parsed = workspaceSourceSnapshotSchema.safeParse(
			candidate.sourceSnapshotJson,
		);
		return (
			parsed.success && parsed.data.sourceStateHash === input.sourceStateHash
		);
	});
	if (!inventory) return input.cases;
	const definitions = await db
		.select()
		.from(codingAgentTestInventoryCases)
		.where(eq(codingAgentTestInventoryCases.inventoryId, inventory.id));
	const evidenceKind = selectAutomatedEvidenceKind(input.evidenceKinds);
	return input.cases.map((testCase) => {
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
			return {
				...testCase,
				runner: testCase.runner ?? input.runner,
				...(testCase.evidenceKind || !evidenceKind ? {} : { evidenceKind }),
			};
		}
		return {
			...testCase,
			caseKey: matches[0]?.caseKey,
			runner: testCase.runner ?? input.runner,
			...(testCase.evidenceKind || !evidenceKind ? {} : { evidenceKind }),
		};
	});
}

function matchesDefinition(input: {
	definition: typeof codingAgentTestInventoryCases.$inferSelect;
	testCase: NormalizedTestCaseEvidence;
	inventoryCwd: string;
	evidenceCwd: string;
	runner: VerificationRunner;
}) {
	const observedRunner = input.testCase.runner ?? input.runner;
	if (
		observedRunner === "unknown" ||
		input.definition.runner !== observedRunner
	) {
		return false;
	}
	const expectedName = normalizeIdentity(input.definition.name);
	const actualName = normalizeIdentity(input.testCase.name);
	if (actualName !== expectedName && !actualName.endsWith(` ${expectedName}`)) {
		return false;
	}
	if (!input.testCase.filePath) return true;
	const expectedFile = path.resolve(
		input.inventoryCwd,
		input.definition.filePath,
	);
	const actualFile = path.isAbsolute(input.testCase.filePath)
		? path.resolve(input.testCase.filePath)
		: path.resolve(input.evidenceCwd, input.testCase.filePath);
	return normalizePath(expectedFile) === normalizePath(actualFile);
}

function normalizeIdentity(value: string) {
	return value
		.normalize("NFKC")
		.toLocaleLowerCase("en-US")
		.replace(/\s+/g, " ")
		.trim();
}

function normalizePath(value: string) {
	return value
		.normalize("NFKC")
		.replaceAll("\\", "/")
		.toLocaleLowerCase("en-US");
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
