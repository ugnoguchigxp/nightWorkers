import { and, eq } from "drizzle-orm";
import type { EvidenceCheckSnapshot } from "../../../../shared/modules/codingAgent";
import { workspaceSourceSnapshotSchema } from "../../../../shared/schemas/verification-checklist.schema";
import { db } from "../../../db/client";
import {
	codingAgentTestConditionMappings,
	codingAgentTestInventoryCases,
	type codingAgentTestInventoryRuns,
	type verificationChecklistItems,
} from "../../../db/verification-schema";
import { digestTestDefinitionInventory } from "./test-definition-digest";
import { collectTestInventory } from "./test-inventory.service";

type TestScope = EvidenceCheckSnapshot["scope"]["testScope"];
type InventoryRow = typeof codingAgentTestInventoryRuns.$inferSelect;

const definitionCache = new Map<
	string,
	{
		digest: string;
		cases: Awaited<ReturnType<typeof collectTestInventory>>["cases"];
	}
>();

export async function evaluateEvidenceMappingReadiness(input: {
	taskId: string;
	runId?: string | null;
	verificationDocumentId: string;
	repoRoot: string;
	checklist: Array<typeof verificationChecklistItems.$inferSelect>;
	inventories: InventoryRow[];
	sourceStateHash: string;
	testScope: TestScope;
	settledEvidence: boolean;
}): Promise<EvidenceCheckSnapshot["mapping"]> {
	const requiredItems = input.checklist.filter((item) =>
		mappingRequired(item, input.testScope),
	);
	if (requiredItems.length === 0) {
		return {
			status: "not_required",
			definitionDigest: null,
			total: 0,
			matched: 0,
			items: [],
		};
	}

	try {
		const selected = await selectInventoryWithMappings({
			verificationDocumentId: input.verificationDocumentId,
			inventories: input.settledEvidence
				? input.inventories.filter(
						(inventory) =>
							snapshotHash(inventory.sourceSnapshotJson) ===
							input.sourceStateHash,
					)
				: input.inventories,
		});
		const persistedCases = selected.inventory
			? await db
					.select()
					.from(codingAgentTestInventoryCases)
					.where(
						eq(
							codingAgentTestInventoryCases.inventoryId,
							selected.inventory.id,
						),
					)
			: [];
		const scopedPersistedCases = persistedCases.filter((testCase) =>
			caseIsInScope(testCase.runner, input.testScope),
		);
		const persistedDefinitionDigest = selected.inventory
			? digestTestDefinitionInventory(scopedPersistedCases)
			: null;
		const items = requiredItems.map((item) => {
			const matches = selected.mappings
				.filter((mapping) => mapping.conditionId === item.conditionId)
				.flatMap((mapping) => {
					const testCase = scopedPersistedCases.find(
						(candidate) => candidate.caseKey === mapping.caseKey,
					);
					return testCase
						? [
								{
									caseKey: testCase.caseKey,
									name: testCase.name,
									filePath: testCase.filePath,
									runner: testCase.runner,
								},
							]
						: [];
				});
			return {
				id: item.conditionId,
				text: item.text,
				required: item.required,
				status:
					matches.length > 0 ? ("matched" as const) : ("missing" as const),
				matches,
			};
		});
		const matched = items.filter((item) => item.status === "matched").length;
		if (input.settledEvidence) {
			return {
				status: matched === items.length ? "matched" : "missing",
				definitionDigest: persistedDefinitionDigest,
				total: items.length,
				matched,
				items,
			};
		}
		const currentDefinitions = await currentTestDefinitions(input);
		return {
			status:
				selected.inventory &&
				persistedDefinitionDigest !== currentDefinitions.digest
					? "stale"
					: matched === items.length
						? "matched"
						: "missing",
			definitionDigest: currentDefinitions.digest,
			total: items.length,
			matched,
			items,
		};
	} catch {
		return unresolvedEvidenceMapping(input.checklist, input.testScope);
	}
}

export function unresolvedEvidenceMapping(
	checklist: Array<typeof verificationChecklistItems.$inferSelect>,
	testScope: TestScope,
): EvidenceCheckSnapshot["mapping"] {
	const items = checklist
		.filter((item) => mappingRequired(item, testScope))
		.map((item) => ({
			id: item.conditionId,
			text: item.text,
			required: item.required,
			status: "missing" as const,
			matches: [],
		}));
	return {
		status: items.length === 0 ? "not_required" : "missing",
		definitionDigest: null,
		total: items.length,
		matched: 0,
		items,
	};
}

export function resolveEvidenceTestScope(
	explicit: "none" | "unit" | "e2e_if_ui" | "unit_and_e2e_if_ui" | undefined,
	checklist: Array<typeof verificationChecklistItems.$inferSelect>,
): TestScope {
	if (explicit) return explicit;
	const expected = new Set(
		checklist.flatMap((item) => item.expectedEvidenceJson),
	);
	const unit = expected.has("unit_test") || expected.has("integration_test");
	const e2e = expected.has("e2e_test");
	if (unit && e2e) return "unit_and_e2e_if_ui";
	if (unit) return "unit";
	if (e2e) return "e2e_if_ui";
	if (
		checklist.every(
			(item) =>
				!item.required ||
				item.verificationKind === "manual" ||
				item.verificationKind === "not_applicable",
		)
	) {
		return "none";
	}
	return "unspecified";
}

async function currentTestDefinitions(input: {
	taskId: string;
	runId?: string | null;
	repoRoot: string;
	sourceStateHash: string;
	testScope: TestScope;
}) {
	const cacheKey = `${input.repoRoot}\u0000${input.sourceStateHash}\u0000${input.testScope}`;
	const cached = definitionCache.get(cacheKey);
	if (cached) return cached;
	const inventory = await collectTestInventory(
		{
			taskId: input.taskId,
			runId: input.runId ?? undefined,
			repoRoot: input.repoRoot,
		},
		{ activeDiscovery: false, persist: false },
	);
	const cases = inventory.cases.filter((testCase) =>
		caseIsInScope(testCase.runner, input.testScope),
	);
	const result = { digest: digestTestDefinitionInventory(cases), cases };
	definitionCache.set(cacheKey, result);
	if (definitionCache.size > 32) {
		const oldest = definitionCache.keys().next().value;
		if (oldest) definitionCache.delete(oldest);
	}
	return result;
}

async function selectInventoryWithMappings(input: {
	verificationDocumentId: string;
	inventories: InventoryRow[];
}) {
	for (const inventory of input.inventories) {
		const mappings = await db
			.select()
			.from(codingAgentTestConditionMappings)
			.where(
				and(
					eq(
						codingAgentTestConditionMappings.verificationDocumentId,
						input.verificationDocumentId,
					),
					eq(codingAgentTestConditionMappings.inventoryId, inventory.id),
				),
			);
		if (mappings.length > 0) return { inventory, mappings };
	}
	return { inventory: null, mappings: [] };
}

function mappingRequired(
	item: typeof verificationChecklistItems.$inferSelect,
	testScope: TestScope,
) {
	if (!item.required || testScope === "none") return false;
	return (item.verificationKind ?? "automated_test") === "automated_test";
}

function caseIsInScope(runner: string, testScope: TestScope) {
	if (testScope === "none") return false;
	const e2e = runner === "playwright";
	if (testScope === "unit") return !e2e;
	if (testScope === "e2e_if_ui") return e2e;
	return true;
}

function snapshotHash(value: unknown) {
	const parsed = workspaceSourceSnapshotSchema.safeParse(value);
	return parsed.success ? parsed.data.sourceStateHash : null;
}
