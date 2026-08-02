import { and, desc, eq } from "drizzle-orm";
import {
	type ExpectedEvidence,
	isExpectedEvidenceAllowedByCompletionScope,
	type NormalizedTestCaseEvidence,
	specificationVerificationDocumentSchema,
	type VerificationRunner,
	workspaceSourceSnapshotSchema,
} from "../../../../shared/schemas/verification-checklist.schema";
import { db } from "../../../db/client";
import { taskRuns } from "../../../db/schema";
import {
	codingAgentTestConditionMappings,
	codingAgentTestInventoryCases,
	codingAgentTestInventoryRuns,
	verificationChecklistItems,
	verificationDocuments,
} from "../../../db/verification-schema";
import { AppError } from "../../../lib/errors";
import { isCompatibleEvidenceKind } from "./evidence-kind-compatibility";

type CaseEvidenceScope = {
	conditionIds: string[];
	evidenceKind?: NormalizedTestCaseEvidence["evidenceKind"];
};

export type ResolvedRunCheckEvidenceScope = {
	verificationDocumentId: string;
	inventoryId: string | null;
	conditionIds: string[];
	evidenceKinds: ExpectedEvidence[];
	runner: VerificationRunner;
	caseScopes: Record<string, CaseEvidenceScope>;
	mappedCaseKeys: string[];
};

export async function resolveRunCheckEvidenceScope(input: {
	taskId: string;
	runId?: string;
	verificationDocumentId: string;
	command: string;
	declaredCommand?: string;
	cwd?: string;
	checkKind?: string;
	sourceStateHash: string;
}): Promise<ResolvedRunCheckEvidenceScope> {
	const authority = await loadEvidenceAuthority(input);
	const document = specificationVerificationDocumentSchema.safeParse(
		authority.document.documentJson,
	);
	if (!document.success) {
		throw evidenceScopeError(
			"TEST_EVIDENCE_CAPTURE_FAILED",
			"Active Verification Document is invalid and cannot authorize managed evidence.",
		);
	}
	const plannedCommands = document.data.commands.filter(
		(command) =>
			(command.command === input.command ||
				command.command === input.declaredCommand) &&
			normalizeCwd(command.cwd) === normalizeCwd(input.cwd),
	);
	if (input.checkKind !== "test") {
		const fallbackKinds = evidenceKindsForCheckKind(input.checkKind);
		const commandGateItems = authority.items.filter(
			(item) => item.verificationKind === "command_gate",
		);
		if (commandGateItems.length > 0 && plannedCommands.length === 0) {
			throw evidenceScopeError(
				"COMMAND_GATE_PLAN_MISSING",
				"The command is not present in the active Verification Document with the same command and cwd.",
			);
		}
		const conditionIds = [
			...new Set(plannedCommands.flatMap((command) => command.conditionIds)),
		].sort();
		const plannedEvidenceKinds = normalizeEvidenceKinds(
			plannedCommands.flatMap((command) => command.evidenceKinds ?? []),
		);
		const evidenceKinds = normalizeEvidenceKinds(
			plannedEvidenceKinds.length > 0
				? plannedEvidenceKinds
				: conditionIds.length > 0
					? authority.items
							.filter((item) => conditionIds.includes(item.conditionId))
							.flatMap((item) => item.expectedEvidenceJson)
					: fallbackKinds,
		);
		validateEvidenceScope({
			testScope: document.data.testScope,
			items: authority.items,
			conditionIds,
			evidenceKinds,
		});
		return {
			verificationDocumentId: authority.document.id,
			inventoryId: null,
			conditionIds,
			evidenceKinds,
			runner: "unknown",
			caseScopes: {},
			mappedCaseKeys: [],
		};
	}

	const currentInventories = authority.inventories.filter(
		(candidate) =>
			snapshotHash(candidate.sourceSnapshotJson) === input.sourceStateHash,
	);
	if (currentInventories.length === 0) {
		throw evidenceScopeError(
			"TEST_INVENTORY_MISSING",
			"No current active test inventory exists for this Run and source revision.",
			"collect_test_inventory",
		);
	}
	const plannedConditionIds = new Set(
		plannedCommands.flatMap((command) => command.conditionIds),
	);
	let inventory: (typeof currentInventories)[number] | undefined;
	let mappings: Array<typeof codingAgentTestConditionMappings.$inferSelect> =
		[];
	for (const candidate of currentInventories) {
		const candidateMappings = (
			await db
				.select()
				.from(codingAgentTestConditionMappings)
				.where(
					and(
						eq(
							codingAgentTestConditionMappings.verificationDocumentId,
							authority.document.id,
						),
						eq(codingAgentTestConditionMappings.inventoryId, candidate.id),
					),
				)
		).filter(
			(mapping) =>
				mapping.sourceDigest === input.sourceStateHash &&
				(plannedConditionIds.size === 0 ||
					plannedConditionIds.has(mapping.conditionId)),
		);
		if (candidateMappings.length === 0) continue;
		inventory = candidate;
		mappings = candidateMappings;
		break;
	}
	if (!inventory) {
		throw evidenceScopeError(
			"CONDITION_MAPPING_MISSING",
			"No current active testcase mapping authorizes this test execution.",
			"record_test_condition_mapping",
		);
	}
	const cases = await db
		.select()
		.from(codingAgentTestInventoryCases)
		.where(eq(codingAgentTestInventoryCases.inventoryId, inventory.id));
	const activeCases = new Map(
		cases
			.filter((testCase) => testCase.discoveryLevel === "active")
			.map((testCase) => [testCase.caseKey, testCase]),
	);
	const applicableMappings = mappings.filter((mapping) =>
		activeCases.has(mapping.caseKey),
	);
	if (applicableMappings.length === 0) {
		throw evidenceScopeError(
			"CONDITION_MAPPING_MISSING",
			"No current active testcase mapping authorizes this test execution.",
			"record_test_condition_mapping",
		);
	}

	const itemsById = new Map(
		authority.items.map((item) => [item.conditionId, item]),
	);
	const grouped = new Map<string, string[]>();
	for (const mapping of applicableMappings) {
		const conditionIds = grouped.get(mapping.caseKey) ?? [];
		conditionIds.push(mapping.conditionId);
		grouped.set(mapping.caseKey, conditionIds);
	}
	const caseScopes: Record<string, CaseEvidenceScope> = {};
	for (const [caseKey, conditionIds] of grouped) {
		const evidenceKind = selectCaseEvidenceKind(
			conditionIds.flatMap(
				(conditionId) => itemsById.get(conditionId)?.expectedEvidenceJson ?? [],
			),
		);
		caseScopes[caseKey] = {
			conditionIds: [...new Set(conditionIds)].sort(),
			...(evidenceKind ? { evidenceKind } : {}),
		};
	}
	const conditionIds = [
		...new Set(
			Object.values(caseScopes).flatMap((scope) => scope.conditionIds),
		),
	].sort();
	const evidenceKinds = normalizeEvidenceKinds(
		Object.values(caseScopes).flatMap((scope) =>
			scope.evidenceKind ? [scope.evidenceKind] : [],
		),
	);
	validateEvidenceScope({
		testScope: document.data.testScope,
		items: authority.items,
		conditionIds,
		evidenceKinds,
	});
	const runners = new Set(
		[...grouped.keys()].flatMap((caseKey) => {
			const runner = activeCases.get(caseKey)?.runner;
			return runner ? [runner] : [];
		}),
	);
	const concreteRunners = [...runners].filter((runner) => runner !== "junit");
	if (
		concreteRunners.length > 1 ||
		runners.has("unknown") ||
		(concreteRunners.length === 0 && !runners.has("junit"))
	) {
		throw evidenceScopeError(
			"TEST_EVIDENCE_CAPTURE_FAILED",
			"Mapped testcase runner could not be resolved uniquely from the current inventory.",
		);
	}
	return {
		verificationDocumentId: authority.document.id,
		inventoryId: inventory.id,
		conditionIds,
		evidenceKinds,
		runner: (concreteRunners[0] ?? "junit") as VerificationRunner,
		caseScopes,
		mappedCaseKeys: Object.keys(caseScopes).sort(),
	};
}

export async function validateRunCheckEvidenceScope(input: {
	taskId: string;
	runId?: string;
	verificationDocumentId: string;
	conditionIds: string[];
	evidenceKinds: ExpectedEvidence[];
	checkKind?: string;
}) {
	const authority = await loadEvidenceAuthority(input);
	const document = specificationVerificationDocumentSchema.safeParse(
		authority.document.documentJson,
	);
	if (
		document.success &&
		document.data.testScope &&
		input.evidenceKinds.length === 0
	) {
		throw new AppError(
			400,
			"verification_scope_declaration_required",
			"Managed evidence scope validation requires resolved evidence kinds.",
		);
	}
	validateEvidenceScope({
		testScope: document.success ? document.data.testScope : undefined,
		items: authority.items,
		conditionIds: input.conditionIds,
		evidenceKinds: input.evidenceKinds,
	});
}

async function loadEvidenceAuthority(input: {
	taskId: string;
	runId?: string;
	verificationDocumentId: string;
}) {
	const [document, run, items, inventories] = await Promise.all([
		db
			.select({
				id: verificationDocuments.id,
				documentJson: verificationDocuments.documentJson,
			})
			.from(verificationDocuments)
			.where(
				and(
					eq(verificationDocuments.id, input.verificationDocumentId),
					eq(verificationDocuments.taskId, input.taskId),
					eq(verificationDocuments.status, "active"),
				),
			)
			.then((rows) => rows[0]),
		input.runId
			? db
					.select({ id: taskRuns.id })
					.from(taskRuns)
					.where(
						and(
							eq(taskRuns.id, input.runId),
							eq(taskRuns.taskId, input.taskId),
						),
					)
					.then((rows) => rows[0])
			: Promise.resolve(undefined),
		db
			.select({
				conditionId: verificationChecklistItems.conditionId,
				verificationKind: verificationChecklistItems.verificationKind,
				expectedEvidenceJson: verificationChecklistItems.expectedEvidenceJson,
			})
			.from(verificationChecklistItems)
			.where(
				and(
					eq(
						verificationChecklistItems.verificationDocumentId,
						input.verificationDocumentId,
					),
					eq(verificationChecklistItems.taskId, input.taskId),
				),
			),
		input.runId
			? db
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
					)
			: Promise.resolve([]),
	]);
	if (!document || !run) {
		throw new AppError(
			409,
			"verification_evidence_scope_mismatch",
			"Managed evidence requires an active Verification Document and a Run belonging to the requested Task.",
		);
	}
	return { document, run, items, inventories };
}

function validateEvidenceScope(input: {
	testScope: Parameters<typeof isExpectedEvidenceAllowedByCompletionScope>[1];
	items: Array<{
		conditionId: string;
		verificationKind: string | null;
		expectedEvidenceJson: string[];
	}>;
	conditionIds: string[];
	evidenceKinds: ExpectedEvidence[];
}) {
	const disallowedKinds = input.evidenceKinds.filter(
		(kind) =>
			!isExpectedEvidenceAllowedByCompletionScope(kind, input.testScope),
	);
	if (disallowedKinds.length > 0) {
		throw new AppError(
			403,
			"VERIFICATION_SCOPE_DENIED",
			`Questionnaireで選択されていないtest証跡は実行できません: ${disallowedKinds.join(", ")}`,
			{ retryable: false },
		);
	}
	if (input.conditionIds.length === 0) return;
	const uniqueConditionIds = [...new Set(input.conditionIds)];
	const items = input.items.filter((item) =>
		uniqueConditionIds.includes(item.conditionId),
	);
	const found = new Set(items.map((item) => item.conditionId));
	const unknown = uniqueConditionIds.filter(
		(conditionId) => !found.has(conditionId),
	);
	if (unknown.length > 0) {
		throw new AppError(
			400,
			"unknown_verification_condition",
			`The managed evidence scope contains unknown condition IDs: ${unknown.join(", ")}`,
		);
	}
	for (const item of items) {
		if (item.verificationKind === "manual") {
			throw new AppError(
				400,
				"manual_condition_requires_human_confirmation",
				`Condition ${item.conditionId} requires an authorized human confirmation and cannot be satisfied by run_check.`,
			);
		}
		const compatible = item.expectedEvidenceJson.some((expected) =>
			input.evidenceKinds.some((actual) =>
				isCompatibleEvidenceKind(expected as ExpectedEvidence, actual),
			),
		);
		if (!compatible) {
			throw new AppError(
				400,
				"verification_evidence_kind_mismatch",
				`Condition ${item.conditionId} does not accept the resolved evidence kinds: ${input.evidenceKinds.join(", ") || "none"}`,
			);
		}
	}
}

export function selectCaseEvidenceKind(
	values: string[],
): NormalizedTestCaseEvidence["evidenceKind"] | undefined {
	const automated = values.filter(isAutomatedEvidenceKindValue);
	const specific = [
		...new Set(automated.filter((kind) => kind !== "automated_test")),
	];
	if (specific.length > 1) {
		throw evidenceScopeError(
			"TEST_EVIDENCE_CAPTURE_FAILED",
			`One testcase is mapped to incompatible evidence kinds: ${specific.join(", ")}`,
		);
	}
	return (
		specific[0] ??
		(automated.includes("automated_test") ? "automated_test" : undefined)
	);
}

function normalizeEvidenceKinds(values: string[]): ExpectedEvidence[] {
	return [...new Set(values)].filter(isExpectedEvidenceValue).sort();
}

function evidenceKindsForCheckKind(checkKind?: string): ExpectedEvidence[] {
	if (checkKind === "lint") return ["lint"];
	if (checkKind === "format_check") return ["format_check"];
	if (checkKind === "typecheck") return ["typecheck"];
	if (checkKind === "coverage") return ["coverage"];
	if (checkKind === "build") return ["build"];
	return [];
}

function isAutomatedEvidenceKindValue(
	value: string,
): value is NonNullable<NormalizedTestCaseEvidence["evidenceKind"]> {
	return (
		value === "automated_test" ||
		value === "unit_test" ||
		value === "integration_test" ||
		value === "e2e_test"
	);
}

function isExpectedEvidenceValue(value: string): value is ExpectedEvidence {
	return (
		isAutomatedEvidenceKindValue(value) ||
		value === "typecheck" ||
		value === "lint" ||
		value === "format_check" ||
		value === "build" ||
		value === "coverage" ||
		value === "migration_check" ||
		value === "manual_evidence"
	);
}

function evidenceScopeError(
	code: string,
	message: string,
	suggestedAction = "report_test_evidence_failure",
) {
	return new AppError(409, code, message, {
		retryable: false,
		suggestedAction,
	});
}

function snapshotHash(value: unknown) {
	const parsed = workspaceSourceSnapshotSchema.safeParse(value);
	return parsed.success ? parsed.data.sourceStateHash : null;
}

function normalizeCwd(value?: string) {
	const trimmed = value?.trim().replace(/\/+$/, "") ?? "";
	return trimmed === "." ? "" : trimmed;
}
