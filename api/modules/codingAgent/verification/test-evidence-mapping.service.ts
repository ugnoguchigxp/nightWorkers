import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import type {
	TestConditionMapping,
	TestEvidenceSetMappingWrite,
} from "../../../../shared/schemas/verification-checklist.schema";
import { db } from "../../../db/client";
import {
	codingAgentTestConditionMappings,
	verificationChecklistItems,
	verificationDocuments,
} from "../../../db/verification-schema";
import { digestTestDefinitionInventory } from "./test-definition-digest";
import {
	matchTestEvidenceReferences,
	TEST_EVIDENCE_MATCH_THRESHOLD,
} from "./test-evidence-matcher";
import { collectTestInventory } from "./test-inventory.service";
import { TestConditionMappingFailure } from "./test-inventory-errors";
import {
	chunks,
	insertTestInventory,
	TEST_EVIDENCE_PERSISTENCE_BATCH_SIZE,
} from "./test-inventory-persistence";
import { captureWorkspaceSourceSnapshot } from "./workspace-source-snapshot";

export async function recordTestEvidenceSetMappings(
	input: TestEvidenceSetMappingWrite,
) {
	const checklist = await assertEvidenceSetAuthority(input);
	assertKnownConditions(input, checklist);
	const inventory = await collectTestInventory(
		{
			taskId: input.taskId,
			runId: input.runId,
			repoRoot: input.repoRoot,
			cwd: input.cwd,
			blockedCommands: input.blockedCommands,
			allowedPaths: input.allowedPaths,
			externalAllowedPaths: input.externalAllowedPaths,
			deniedPaths: input.deniedPaths,
			maxCommandSeconds: input.maxCommandSeconds,
		},
		{
			activeDiscovery: false,
			persist: false,
		},
	);
	const matched = matchTestEvidenceReferences({
		references: input.evidenceSet.references,
		testCases: inventory.cases,
	});
	assertAllEvidenceMatched(matched);
	const sourceAfter = await captureWorkspaceSourceSnapshot(input.repoRoot);
	if (
		sourceAfter.sourceStateHash !== inventory.sourceSnapshot.sourceStateHash
	) {
		throw new TestConditionMappingFailure(
			"TEST_MAPPING_SOURCE_STALE",
			"Repository source changed while resolving the schema test evidence set.",
			"retry_record_test_condition_mapping",
		);
	}
	const sourceDigest = inventory.sourceSnapshot.sourceStateHash;
	const definitionDigest = digestTestDefinitionInventory(inventory.cases);
	const mappings = buildMappings({
		input,
		inventoryId: inventory.id,
		sourceDigest,
		matches: matched.matches,
	});
	await persistInventoryAndMappings(inventory, mappings);
	return {
		inventoryId: inventory.id,
		sourceDigest,
		definitionDigest,
		matchThreshold: TEST_EVIDENCE_MATCH_THRESHOLD,
		referenceCount: input.evidenceSet.references.length,
		mappingCount: mappings.length,
		matches: matched.matches.map((match) => ({
			referenceIndex: match.referenceIndex,
			caseKey: match.testCase.caseKey,
			score: roundScore(match.score),
		})),
	};
}

async function assertEvidenceSetAuthority(input: TestEvidenceSetMappingWrite) {
	const [document, checklist] = await Promise.all([
		db
			.select({
				id: verificationDocuments.id,
				taskId: verificationDocuments.taskId,
			})
			.from(verificationDocuments)
			.where(eq(verificationDocuments.id, input.verificationDocumentId))
			.then((rows) => rows[0]),
		db
			.select({ conditionId: verificationChecklistItems.conditionId })
			.from(verificationChecklistItems)
			.where(
				eq(
					verificationChecklistItems.verificationDocumentId,
					input.verificationDocumentId,
				),
			),
	]);
	if (!document || document.taskId !== input.taskId) {
		throw new TestConditionMappingFailure(
			"TEST_MAPPING_AUTHORITY_MISMATCH",
			"Verification document does not belong to the request-scoped task.",
		);
	}
	return checklist;
}

function assertKnownConditions(
	input: TestEvidenceSetMappingWrite,
	checklist: Array<{ conditionId: string }>,
) {
	const knownConditionIds = new Set(checklist.map((item) => item.conditionId));
	const issues = input.evidenceSet.references.flatMap(
		(reference, referenceIndex) =>
			reference.conditionIds
				.filter((conditionId) => !knownConditionIds.has(conditionId))
				.map((conditionId) => ({
					path: ["evidenceSet", "references", referenceIndex, "conditionIds"],
					message: `Verification condition is unavailable: ${conditionId}`,
				})),
	);
	if (!issues.length) return;
	throw new TestConditionMappingFailure(
		"TEST_MAPPING_PRECONDITION_MISSING",
		"One or more verification conditions referenced by the evidence set are unavailable.",
		undefined,
		issues,
	);
}

function assertAllEvidenceMatched(
	matched: ReturnType<typeof matchTestEvidenceReferences>,
) {
	if (matched.missing.length) {
		throw new TestConditionMappingFailure(
			"TEST_EVIDENCE_NOT_FOUND",
			"One or more schema test evidence references were not found at the required similarity.",
			"review_test_evidence_set",
			matched.missing.map((missing) => ({
				path: ["evidenceSet", "references", missing.referenceIndex],
				message: `No active test reached ${formatScore(TEST_EVIDENCE_MATCH_THRESHOLD)} similarity for this evidence reference.`,
			})),
		);
	}
	if (!matched.ambiguous.length) return;
	throw new TestConditionMappingFailure(
		"TEST_EVIDENCE_AMBIGUOUS",
		"One or more schema test evidence references matched multiple tests above the threshold.",
		"add_test_evidence_file_path",
		matched.ambiguous.map((ambiguity) => ({
			path: ["evidenceSet", "references", ambiguity.referenceIndex],
			message: formatAmbiguousCandidates(ambiguity.candidates),
		})),
	);
}

function buildMappings(input: {
	input: TestEvidenceSetMappingWrite;
	inventoryId: string;
	sourceDigest: string;
	matches: ReturnType<typeof matchTestEvidenceReferences>["matches"];
}) {
	const uniqueRelations = new Map<
		string,
		{ caseKey: string; conditionId: string; rationale: string }
	>();
	for (const match of input.matches) {
		for (const conditionId of match.reference.conditionIds) {
			const key = `${match.testCase.caseKey}\u0000${conditionId}`;
			uniqueRelations.set(key, {
				caseKey: match.testCase.caseKey,
				conditionId,
				rationale: `Schema evidence set matched "${match.reference.testName}" to "${match.testCase.name}" at ${formatScore(match.score)} similarity.`,
			});
		}
	}
	return [...uniqueRelations.values()].map(
		(relation): TestConditionMapping => ({
			id: crypto.randomUUID(),
			taskId: input.input.taskId,
			verificationDocumentId: input.input.verificationDocumentId,
			inventoryId: input.inventoryId,
			caseKey: relation.caseKey,
			conditionId: relation.conditionId,
			source: "schema_evidence_set",
			rationale: relation.rationale,
			sourceDigest: input.sourceDigest,
			createdAt: new Date().toISOString(),
		}),
	);
}

async function persistInventoryAndMappings(
	inventory: Awaited<ReturnType<typeof collectTestInventory>>,
	mappings: TestConditionMapping[],
) {
	try {
		await db.transaction(async (tx) => {
			await insertTestInventory(tx, inventory);
			for (const mappingChunk of chunks(
				mappings,
				TEST_EVIDENCE_PERSISTENCE_BATCH_SIZE,
			)) {
				await tx.insert(codingAgentTestConditionMappings).values(
					mappingChunk.map((mapping) => ({
						id: mapping.id,
						taskId: mapping.taskId,
						verificationDocumentId: mapping.verificationDocumentId,
						inventoryId: mapping.inventoryId,
						caseKey: mapping.caseKey,
						conditionId: mapping.conditionId,
						source: mapping.source,
						rationale: mapping.rationale ?? null,
						sourceDigest: mapping.sourceDigest,
					})),
				);
			}
		});
	} catch (error) {
		throw new TestConditionMappingFailure(
			"TEST_MAPPING_PERSISTENCE_FAILED",
			"Schema test evidence mappings could not be persisted.",
			undefined,
			undefined,
			{ cause: error },
		);
	}
}

function formatScore(score: number) {
	return `${Math.round(score * 10_000) / 100}%`;
}

function roundScore(score: number) {
	return Math.round(score * 10_000) / 10_000;
}

function formatAmbiguousCandidates(
	candidates: ReturnType<
		typeof matchTestEvidenceReferences
	>["ambiguous"][number]["candidates"],
) {
	const preview = candidates
		.slice(0, 10)
		.map(
			(candidate) =>
				`${truncate(candidate.caseKey, 240)} (${formatScore(candidate.score)})`,
		)
		.join(", ");
	const omitted =
		candidates.length > 10 ? `, +${candidates.length - 10} more` : "";
	return `Multiple tests reached ${formatScore(TEST_EVIDENCE_MATCH_THRESHOLD)} similarity: ${preview}${omitted}`;
}

function truncate(value: string, maximumLength: number) {
	return value.length <= maximumLength
		? value
		: `${value.slice(0, maximumLength - 1)}…`;
}
