import { and, desc, eq, inArray } from "drizzle-orm";
import { workspaceSourceSnapshotSchema } from "../../../../shared/schemas/verification-checklist.schema";
import { db } from "../../../db/client";
import { taskRuns } from "../../../db/schema";
import {
	codingAgentConditionConfirmations,
	codingAgentTestConditionMappings,
	codingAgentTestInventoryCases,
	codingAgentTestInventoryRuns,
	verificationChecklistItems,
	verificationDocuments,
	verificationEvidenceCases,
	verificationEvidenceRuns,
} from "../../../db/verification-schema";
import { AppError } from "../../../lib/errors";
import {
	type AcceptanceConditionAssuranceEvaluation,
	evaluateAcceptanceConditionAssuranceDataset,
} from "./acceptance-condition-assurance-evaluator";
import { captureWorkspaceSourceSnapshot } from "./workspace-source-snapshot";

export type {
	AcceptanceConditionAssuranceDataset,
	AcceptanceConditionAssuranceEvaluation,
	EvaluatedAcceptanceCondition,
} from "./acceptance-condition-assurance-evaluator";
export {
	evaluateAcceptanceConditionAssuranceDataset,
	toVerificationChecklistItem,
} from "./acceptance-condition-assurance-evaluator";

type InventoryRow = typeof codingAgentTestInventoryRuns.$inferSelect;
type MappingRow = typeof codingAgentTestConditionMappings.$inferSelect;

export async function evaluateAcceptanceConditionAssurance(input: {
	taskId: string;
	runId: string;
	verificationDocumentId: string;
	repoRoot: string;
}): Promise<AcceptanceConditionAssuranceEvaluation> {
	const [document, run] = await Promise.all([
		db
			.select({ id: verificationDocuments.id })
			.from(verificationDocuments)
			.where(
				and(
					eq(verificationDocuments.id, input.verificationDocumentId),
					eq(verificationDocuments.taskId, input.taskId),
					eq(verificationDocuments.status, "active"),
				),
			)
			.then((rows) => rows[0]),
		db
			.select({ id: taskRuns.id })
			.from(taskRuns)
			.where(
				and(eq(taskRuns.id, input.runId), eq(taskRuns.taskId, input.taskId)),
			)
			.then((rows) => rows[0]),
	]);
	if (!document || !run) {
		throw new AppError(
			409,
			"acceptance_assurance_scope_mismatch",
			"Acceptance assurance requires an active Verification Document and Run for the requested Task.",
		);
	}
	const current = await captureWorkspaceSourceSnapshot(input.repoRoot);
	const [checklist, inventories, evidenceRuns, confirmations] =
		await Promise.all([
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
			db
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
				),
			db
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
					),
				)
				.orderBy(desc(verificationEvidenceRuns.finishedAt)),
			db
				.select()
				.from(codingAgentConditionConfirmations)
				.where(
					and(
						eq(codingAgentConditionConfirmations.taskId, input.taskId),
						eq(codingAgentConditionConfirmations.runId, input.runId),
						eq(
							codingAgentConditionConfirmations.verificationDocumentId,
							input.verificationDocumentId,
						),
					),
				),
		]);
	const currentInventories = inventories.filter(
		(inventory) =>
			snapshotHash(inventory.sourceSnapshotJson) === current.sourceStateHash,
	);
	const selected = await selectInventoryWithMappings({
		verificationDocumentId: input.verificationDocumentId,
		inventories: currentInventories,
	});
	const inventoryCases = selected.inventory
		? await db
				.select()
				.from(codingAgentTestInventoryCases)
				.where(
					eq(codingAgentTestInventoryCases.inventoryId, selected.inventory.id),
				)
		: [];
	const currentEvidenceRuns = evidenceRuns.filter(
		(evidenceRun) =>
			snapshotHash(evidenceRun.sourceSnapshotJson) === current.sourceStateHash,
	);
	const evidenceCases = currentEvidenceRuns.length
		? await db
				.select()
				.from(verificationEvidenceCases)
				.where(
					inArray(
						verificationEvidenceCases.evidenceRunId,
						currentEvidenceRuns.map((evidenceRun) => evidenceRun.id),
					),
				)
		: [];

	return evaluateAcceptanceConditionAssuranceDataset({
		sourceStateHash: current.sourceStateHash,
		checklist,
		inventory: selected.inventory,
		inventoryCases,
		mappings: selected.mappings,
		evidenceRuns,
		evidenceCases,
		confirmations,
	});
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
	return {
		inventory: input.inventories[0] ?? null,
		mappings: [] as MappingRow[],
	};
}

function snapshotHash(value: unknown) {
	const parsed = workspaceSourceSnapshotSchema.safeParse(value);
	return parsed.success ? parsed.data.sourceStateHash : null;
}
