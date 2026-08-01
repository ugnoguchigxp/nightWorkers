import crypto from "node:crypto";
import { and, asc, desc, eq } from "drizzle-orm";
import {
	type EvidenceCheckReadinessSnapshot,
	type EvidenceCheckSnapshot,
	evidenceCheckReadinessSnapshotSchema,
} from "../../../../shared/modules/codingAgent";
import {
	type CompletionVerificationScope,
	expectedEvidenceSchema,
	isExpectedEvidenceAllowedByCompletionScope,
	specificationVerificationDocumentSchema,
	workspaceSourceSnapshotSchema,
} from "../../../../shared/schemas/verification-checklist.schema";
import { db } from "../../../db/client";
import {
	codingAgentEvidenceCheckConfirmations,
	codingAgentEvidenceReadinessSettlements,
	codingAgentTestConditionMappings,
	codingAgentTestInventoryCases,
	codingAgentTestInventoryRuns,
	verificationChecklistItems,
	verificationDocuments,
	verificationEvidenceRuns,
} from "../../../db/verification-schema";
import { digestTestDefinitionInventory } from "./test-definition-digest";
import { collectTestInventory } from "./test-inventory.service";
import { captureWorkspaceSourceSnapshot } from "./workspace-source-snapshot";

type SnapshotCore = EvidenceCheckReadinessSnapshot;

type TestScope = EvidenceCheckSnapshot["scope"]["testScope"];
type InventoryRow = typeof codingAgentTestInventoryRuns.$inferSelect;
type VerifyRunRow = typeof verificationEvidenceRuns.$inferSelect;

const definitionCache = new Map<
	string,
	{
		digest: string;
		cases: Awaited<ReturnType<typeof collectTestInventory>>["cases"];
	}
>();

export async function evaluateEvidenceReadiness(
	input: {
		taskId: string;
		runId?: string | null;
		verificationDocumentId: string;
		repoRoot: string;
	},
	options: { confirmEvidenceCheck?: boolean } = {},
): Promise<SnapshotCore> {
	const document = await db
		.select()
		.from(verificationDocuments)
		.where(
			and(
				eq(verificationDocuments.id, input.verificationDocumentId),
				eq(verificationDocuments.taskId, input.taskId),
				eq(verificationDocuments.status, "active"),
			),
		)
		.then((rows) => rows[0]);
	if (!document) throw new Error("active_verification_document_not_found");
	const settled = await readSettlement(input);
	if (settled) return settled;

	const [current, confirmation, checklist, inventories, verifyRuns] =
		await Promise.all([
			captureWorkspaceSourceSnapshot(input.repoRoot),
			readConfirmation(input),
			db
				.select()
				.from(verificationChecklistItems)
				.where(
					and(
						eq(
							verificationChecklistItems.verificationDocumentId,
							input.verificationDocumentId,
						),
						eq(verificationChecklistItems.taskId, input.taskId),
					),
				)
				.orderBy(verificationChecklistItems.conditionId),
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
						.orderBy(desc(codingAgentTestInventoryRuns.createdAt))
				: Promise.resolve([] as InventoryRow[]),
			input.runId
				? db
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
								eq(verificationEvidenceRuns.checkKind, "verify"),
							),
						)
						.orderBy(
							asc(verificationEvidenceRuns.finishedAt),
							asc(verificationEvidenceRuns.createdAt),
							asc(verificationEvidenceRuns.id),
						)
				: Promise.resolve([]),
		]);

	const parsedDocument = specificationVerificationDocumentSchema.safeParse(
		document.documentJson,
	);
	const testScope = resolveTestScope(
		parsedDocument.success ? parsedDocument.data.testScope : undefined,
		checklist,
	);
	const explicitTestScope = parsedDocument.success
		? parsedDocument.data.testScope
		: undefined;
	const eligibleVerifyRuns = verifyRuns.filter((run) =>
		verifyEvidenceIsAllowedByScope(run.evidenceKindsJson, explicitTestScope),
	);
	const plannedCommand =
		parsedDocument.success &&
		parsedDocument.data.commands.length === 1 &&
		verifyEvidenceIsAllowedByScope(
			parsedDocument.data.commands[0]?.evidenceKinds ?? [],
			explicitTestScope,
		)
			? parsedDocument.data.commands[0]
			: null;
	const plannedVerifyCommand = plannedCommand
		? {
				id: plannedCommand.id,
				command: plannedCommand.command,
				cwd: plannedCommand.cwd ?? null,
			}
		: null;

	if (confirmation) {
		const observedIds = new Set(confirmation.observedEvidenceRunIds);
		const followupRuns = eligibleVerifyRuns.filter(
			(run) => !observedIds.has(run.id),
		);
		const passedFollowup = followupRuns.find(isStablePassedVerify);
		if (passedFollowup && input.runId) {
			const verify = verifySnapshot(passedFollowup, "passed");
			const result: SnapshotCore = {
				...confirmation.snapshot,
				sourceStateHash:
					verify.sourceStateHash ?? confirmation.snapshot.sourceStateHash,
				scope: {
					...confirmation.snapshot.scope,
					authorizedVerifyCommand: {
						id: null,
						command: passedFollowup.command,
						cwd: passedFollowup.cwd,
					},
				},
				verify,
				confirmation: {
					...confirmation.snapshot.confirmation,
					status: "settled",
				},
				ready: true,
				suggestedAction: "write_final_report",
				readinessDigest: digest({
					confirmationDigest: confirmation.snapshot.readinessDigest,
					followupEvidenceRunId: passedFollowup.id,
					sourceStateHash: verify.sourceStateHash,
				}),
			};
			return persistSettlement({
				taskId: input.taskId,
				runId: input.runId,
				verificationDocumentId: input.verificationDocumentId,
				evidenceRunId: passedFollowup.id,
				result,
			});
		}
		const latestFollowup = followupRuns[followupRuns.length - 1] ?? null;
		if (!latestFollowup) return confirmation.snapshot;
		const followupStatus = verifyAttemptStatus(
			latestFollowup,
			current.sourceStateHash,
		);
		const verify = verifySnapshot(latestFollowup, followupStatus);
		return {
			...confirmation.snapshot,
			sourceStateHash: current.sourceStateHash,
			verify,
			ready: false,
			suggestedAction:
				followupStatus === "failed" ? "fix_verify" : "run_verify",
			readinessDigest: digest({
				confirmationDigest: confirmation.snapshot.readinessDigest,
				followupEvidenceRunId: latestFollowup.id,
				followupStatus,
				sourceStateHash: current.sourceStateHash,
			}),
		};
	}

	const initialPassedVerify = eligibleVerifyRuns.find(
		(run) =>
			isStablePassedVerify(run) &&
			snapshotHash(run.sourceSnapshotJson) === current.sourceStateHash,
	);
	const latestVerify =
		initialPassedVerify ??
		eligibleVerifyRuns[eligibleVerifyRuns.length - 1] ??
		null;
	const verifyStatus = verifyAttemptStatus(
		latestVerify,
		current.sourceStateHash,
	);
	const verify = verifySnapshot(latestVerify, verifyStatus);
	const mapping = unresolvedOptionalMapping(checklist, testScope);
	const awaitingConfirmation = verifyStatus === "passed";
	const result: SnapshotCore = {
		runId: input.runId ?? null,
		sourceStateHash: current.sourceStateHash,
		scope: {
			testScope,
			e2eAllowed:
				testScope === "e2e_if_ui" || testScope === "unit_and_e2e_if_ui",
			authorizedVerifyCommand: latestVerify
				? { id: null, command: latestVerify.command, cwd: latestVerify.cwd }
				: plannedVerifyCommand,
		},
		mapping,
		verify,
		confirmation: {
			status: awaitingConfirmation
				? "awaiting_confirmation"
				: "awaiting_initial_verify",
			initialEvidenceRunId: initialPassedVerify?.id ?? null,
			confirmedAt: null,
		},
		ready: false,
		suggestedAction: awaitingConfirmation
			? "confirm_evidence_check"
			: verifyStatus === "failed"
				? "fix_verify"
				: "run_verify",
		readinessDigest: digest({
			phase: awaitingConfirmation
				? "awaiting_confirmation"
				: "awaiting_initial_verify",
			sourceStateHash: current.sourceStateHash,
			testScope,
			verifyStatus,
			verifyEvidenceId: latestVerify?.id ?? null,
		}),
	};
	if (!options.confirmEvidenceCheck || !initialPassedVerify || !input.runId) {
		return result;
	}

	const confirmedAt = new Date().toISOString();
	const confirmedMapping = await evaluateOptionalMapping({
		...input,
		checklist,
		inventories,
		sourceStateHash: current.sourceStateHash,
		testScope,
		settledEvidence: true,
	});
	const confirmedResult: SnapshotCore = {
		...result,
		mapping: confirmedMapping,
		confirmation: {
			status: "confirmed",
			initialEvidenceRunId: initialPassedVerify.id,
			confirmedAt,
		},
		suggestedAction: "run_verify",
		readinessDigest: digest({
			phase: "confirmed",
			initialEvidenceRunId: initialPassedVerify.id,
			confirmedAt,
			mappingStatus: confirmedMapping.status,
			definitionDigest: confirmedMapping.definitionDigest,
		}),
	};
	return persistConfirmation({
		taskId: input.taskId,
		runId: input.runId,
		verificationDocumentId: input.verificationDocumentId,
		initialEvidenceRunId: initialPassedVerify.id,
		observedEvidenceRunIds: eligibleVerifyRuns.map((run) => run.id),
		result: confirmedResult,
	});
}

function verifyEvidenceIsAllowedByScope(
	evidenceKinds: string[],
	testScope: CompletionVerificationScope | undefined,
): boolean {
	// Legacy aggregate verify evidence has no granular evidenceKinds. checkKind
	// already identifies it as the Project gate, so keep it completion-eligible.
	if (evidenceKinds.length === 0) return true;
	return evidenceKinds.every((kind) => {
		const parsed = expectedEvidenceSchema.safeParse(kind);
		return (
			parsed.success &&
			isExpectedEvidenceAllowedByCompletionScope(parsed.data, testScope)
		);
	});
}

async function evaluateOptionalMapping(input: {
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
		const currentDefinitions = await currentTestDefinitions({
			...input,
			sourceStateHash: input.sourceStateHash,
			testScope: input.testScope,
		});
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
		return unresolvedOptionalMapping(input.checklist, input.testScope);
	}
}

function isStablePassedVerify(run: VerifyRunRow) {
	return (
		run.exitCode === 0 &&
		!run.sourceMutatedDuringCheck &&
		Boolean(snapshotHash(run.sourceSnapshotJson))
	);
}

function verifyAttemptStatus(
	run: VerifyRunRow | null,
	currentSourceStateHash: string,
): EvidenceCheckSnapshot["verify"]["status"] {
	if (!run) return "not_run";
	const sourceStateHash = snapshotHash(run.sourceSnapshotJson);
	if (
		!sourceStateHash ||
		sourceStateHash !== currentSourceStateHash ||
		run.sourceMutatedDuringCheck
	) {
		return "stale";
	}
	return run.exitCode === 0 ? "passed" : "failed";
}

function verifySnapshot(
	run: VerifyRunRow | null,
	status: EvidenceCheckSnapshot["verify"]["status"],
): EvidenceCheckSnapshot["verify"] {
	return {
		status,
		command: run?.command ?? null,
		cwd: run?.cwd ?? null,
		exitCode: run?.exitCode ?? null,
		sourceStateHash: run ? snapshotHash(run.sourceSnapshotJson) : null,
		finishedAt: run?.finishedAt.toISOString() ?? null,
		logRefs: run ? [run.rawStdoutArtifactId, run.rawStderrArtifactId] : [],
	};
}

async function readConfirmation(input: {
	taskId: string;
	runId?: string | null;
	verificationDocumentId: string;
}) {
	if (!input.runId) return null;
	const row = await db
		.select({
			observedEvidenceRunIdsJson:
				codingAgentEvidenceCheckConfirmations.observedEvidenceRunIdsJson,
			snapshotJson: codingAgentEvidenceCheckConfirmations.snapshotJson,
		})
		.from(codingAgentEvidenceCheckConfirmations)
		.where(
			and(
				eq(codingAgentEvidenceCheckConfirmations.taskId, input.taskId),
				eq(codingAgentEvidenceCheckConfirmations.runId, input.runId),
				eq(
					codingAgentEvidenceCheckConfirmations.verificationDocumentId,
					input.verificationDocumentId,
				),
			),
		)
		.limit(1)
		.then((rows) => rows[0]);
	if (!row) return null;
	const parsed = evidenceCheckReadinessSnapshotSchema.safeParse(
		row.snapshotJson,
	);
	if (!parsed.success) throw new Error("invalid_evidence_check_confirmation");
	return {
		observedEvidenceRunIds: row.observedEvidenceRunIdsJson,
		snapshot: parsed.data,
	};
}

async function persistConfirmation(input: {
	taskId: string;
	runId: string;
	verificationDocumentId: string;
	initialEvidenceRunId: string;
	observedEvidenceRunIds: string[];
	result: SnapshotCore;
}) {
	await db
		.insert(codingAgentEvidenceCheckConfirmations)
		.values({
			taskId: input.taskId,
			runId: input.runId,
			verificationDocumentId: input.verificationDocumentId,
			initialEvidenceRunId: input.initialEvidenceRunId,
			observedEvidenceRunIdsJson: input.observedEvidenceRunIds,
			snapshotJson: { ...input.result },
		})
		.onConflictDoNothing();
	return (await readConfirmation(input))?.snapshot ?? input.result;
}

async function readSettlement(input: {
	taskId: string;
	runId?: string | null;
	verificationDocumentId: string;
}) {
	if (!input.runId) return null;
	const row = await db
		.select({
			snapshotJson: codingAgentEvidenceReadinessSettlements.snapshotJson,
		})
		.from(codingAgentEvidenceReadinessSettlements)
		.where(
			and(
				eq(codingAgentEvidenceReadinessSettlements.taskId, input.taskId),
				eq(codingAgentEvidenceReadinessSettlements.runId, input.runId),
				eq(
					codingAgentEvidenceReadinessSettlements.verificationDocumentId,
					input.verificationDocumentId,
				),
			),
		)
		.limit(1)
		.then((rows) => rows[0]);
	if (!row) return null;
	const parsed = evidenceCheckReadinessSnapshotSchema.safeParse(
		row.snapshotJson,
	);
	return parsed.success ? parsed.data : null;
}

async function persistSettlement(input: {
	taskId: string;
	runId: string;
	verificationDocumentId: string;
	evidenceRunId: string;
	result: SnapshotCore;
}) {
	await db
		.insert(codingAgentEvidenceReadinessSettlements)
		.values({
			taskId: input.taskId,
			runId: input.runId,
			verificationDocumentId: input.verificationDocumentId,
			evidenceRunId: input.evidenceRunId,
			snapshotJson: { ...input.result },
		})
		.onConflictDoNothing();
	return (await readSettlement(input)) ?? input.result;
}

function unresolvedOptionalMapping(
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

function resolveTestScope(
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

function digest(value: unknown) {
	return `sha256:${crypto
		.createHash("sha256")
		.update(JSON.stringify(value))
		.digest("hex")}`;
}
