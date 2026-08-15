import { and, desc, eq } from "drizzle-orm";
import type {
	AdoptedCompletionCondition,
	ProviderScanBindingV2,
	SecurityAssessmentReceiptV1,
	SecurityContractV1,
} from "../../../shared/schemas/security-intelligence-runtime.schema";
import { type DbTransaction, db } from "../../db/client";
import {
	securityAssessmentReceipts,
	securityContractHeads,
	securityContracts,
	securityScanBindings,
	taskCompletionConditionHeads,
	taskCompletionConditions,
} from "../../db/security-intelligence-schema";
import { SecurityIntelligenceIntegrityError } from "./security-intelligence-integrity";

export {
	saveAssessmentAttempt,
	saveSubjectBinding,
} from "./security-assessment.repository";
export { SecurityIntelligenceIntegrityError } from "./security-intelligence-integrity";

function providerBindingRow(row: typeof securityScanBindings.$inferSelect) {
	return {
		id: row.id,
		binding: {
			version: 2 as const,
			bindingRef: row.bindingRef,
			repositoryId: row.repositoryId,
			provider: "vulnworkbench" as const,
			identityMappingVersion: 1 as const,
			providerProjectRef: row.providerProjectRef,
			scanRunRef: row.scanRunRef,
			selection: row.selectionJson as ProviderScanBindingV2["selection"],
			requestedTarget:
				row.requestedTargetJson as ProviderScanBindingV2["requestedTarget"],
			resolvedTarget: {
				kind: row.resolvedTargetKind,
				sourceRevisionRole: row.sourceRevisionRole,
				sourceRevision: row.sourceRevision,
				targetDigest: row.targetDigest,
			} as ProviderScanBindingV2["resolvedTarget"],
			bindingDigest: row.bindingDigest,
			createdAt: row.createdAt.toISOString(),
		} satisfies ProviderScanBindingV2,
	};
}

export async function findProviderScanBinding(scanRunRef: string) {
	const [row] = await db
		.select()
		.from(securityScanBindings)
		.where(eq(securityScanBindings.scanRunRef, scanRunRef))
		.limit(1);
	return row ? providerBindingRow(row) : null;
}

export async function listProviderScanBindings(repositoryId: string) {
	const rows = await db
		.select()
		.from(securityScanBindings)
		.where(eq(securityScanBindings.repositoryId, repositoryId))
		.orderBy(desc(securityScanBindings.createdAt));
	return rows.map(providerBindingRow);
}

export async function saveProviderScanBinding(binding: ProviderScanBindingV2) {
	return db.transaction(async (tx) => {
		const [existing] = await tx
			.select()
			.from(securityScanBindings)
			.where(eq(securityScanBindings.scanRunRef, binding.scanRunRef))
			.limit(1);
		if (existing) {
			if (existing.bindingDigest !== binding.bindingDigest) {
				throw new SecurityIntelligenceIntegrityError(
					"scan_binding_integrity_conflict",
					existing.bindingRef,
				);
			}
			return providerBindingRow(existing);
		}
		const [row] = await tx
			.insert(securityScanBindings)
			.values({
				bindingRef: binding.bindingRef,
				repositoryId: binding.repositoryId,
				provider: binding.provider,
				identityMappingVersion: binding.identityMappingVersion,
				providerProjectRef: binding.providerProjectRef,
				scanRunRef: binding.scanRunRef,
				selectionJson: binding.selection,
				requestedTargetJson: binding.requestedTarget,
				resolvedTargetKind: binding.resolvedTarget.kind,
				sourceRevisionRole: binding.resolvedTarget.sourceRevisionRole,
				sourceRevision: binding.resolvedTarget.sourceRevision,
				targetDigest: binding.resolvedTarget.targetDigest,
				bindingDigest: binding.bindingDigest,
				createdAt: new Date(binding.createdAt),
				updatedAt: new Date(binding.createdAt),
			})
			.returning();
		return providerBindingRow(row);
	});
}

function assessmentReceiptRow(
	row: typeof securityAssessmentReceipts.$inferSelect,
	scanBindingRef: string,
) {
	return {
		id: row.id,
		receipt: {
			version: 1 as const,
			receiptRef: row.receiptRef,
			repositoryId: row.repositoryId,
			scanBindingRef,
			providerBindingProofRef: row.providerBindingProofRef,
			providerBindingProofDigest: row.providerBindingProofDigest,
			providerProjectRef: row.providerProjectRef,
			scanRunRef: row.scanRunRef,
			canonicalProjectRef: row.canonicalProjectRef,
			canonicalScanRunRef: row.canonicalScanRunRef,
			normalizedTarget:
				row.normalizedTargetJson as SecurityAssessmentReceiptV1["normalizedTarget"],
			producerContractVersion: 1 as const,
			bundleRef: row.bundleRef,
			assessmentRefs: row.assessmentRefsJson,
			payloadDigest: row.payloadDigest,
			payload: row.payloadJson as SecurityAssessmentReceiptV1["payload"],
			receivedAt: row.receivedAt.toISOString(),
		},
		scanBindingId: row.scanBindingId,
	};
}

export async function findAssessmentReceiptByScanBinding(
	scanBindingId: string,
) {
	const [row] = await db
		.select()
		.from(securityAssessmentReceipts)
		.where(eq(securityAssessmentReceipts.scanBindingId, scanBindingId))
		.orderBy(desc(securityAssessmentReceipts.receivedAt))
		.limit(1);
	if (!row) return null;
	const [binding] = await db
		.select({ bindingRef: securityScanBindings.bindingRef })
		.from(securityScanBindings)
		.where(eq(securityScanBindings.id, row.scanBindingId))
		.limit(1);
	if (!binding) {
		throw new SecurityIntelligenceIntegrityError(
			"assessment_receipt_scan_binding_missing",
			row.receiptRef,
		);
	}
	return assessmentReceiptRow(row, binding.bindingRef);
}

export async function saveAssessmentReceipt(input: {
	receipt: SecurityAssessmentReceiptV1;
	scanBindingId: string;
}) {
	return db.transaction(async (tx) => {
		const [binding] = await tx
			.select({ bindingRef: securityScanBindings.bindingRef })
			.from(securityScanBindings)
			.where(eq(securityScanBindings.id, input.scanBindingId))
			.limit(1);
		if (!binding || binding.bindingRef !== input.receipt.scanBindingRef) {
			throw new SecurityIntelligenceIntegrityError(
				"assessment_receipt_scan_binding_mismatch",
				binding?.bindingRef,
			);
		}
		const [existing] = await tx
			.select()
			.from(securityAssessmentReceipts)
			.where(eq(securityAssessmentReceipts.bundleRef, input.receipt.bundleRef))
			.limit(1);
		if (existing) {
			if (
				existing.payloadDigest !== input.receipt.payloadDigest ||
				existing.providerBindingProofDigest !==
					input.receipt.providerBindingProofDigest ||
				existing.scanBindingId !== input.scanBindingId
			) {
				throw new SecurityIntelligenceIntegrityError(
					"assessment_receipt_integrity_conflict",
					existing.receiptRef,
				);
			}
			return {
				...assessmentReceiptRow(existing, binding.bindingRef),
				replayed: true,
			};
		}
		const [row] = await tx
			.insert(securityAssessmentReceipts)
			.values({
				receiptRef: input.receipt.receiptRef,
				repositoryId: input.receipt.repositoryId,
				scanBindingId: input.scanBindingId,
				providerBindingProofRef: input.receipt.providerBindingProofRef,
				providerBindingProofDigest: input.receipt.providerBindingProofDigest,
				providerProjectRef: input.receipt.providerProjectRef,
				scanRunRef: input.receipt.scanRunRef,
				canonicalProjectRef: input.receipt.canonicalProjectRef,
				canonicalScanRunRef: input.receipt.canonicalScanRunRef,
				normalizedTargetJson: input.receipt.normalizedTarget,
				producerContractVersion: input.receipt.producerContractVersion,
				bundleRef: input.receipt.bundleRef,
				assessmentRefsJson: input.receipt.assessmentRefs,
				payloadDigest: input.receipt.payloadDigest,
				payloadJson: input.receipt.payload,
				receivedAt: new Date(input.receipt.receivedAt),
				createdAt: new Date(input.receipt.receivedAt),
				updatedAt: new Date(input.receipt.receivedAt),
			})
			.returning();
		return {
			...assessmentReceiptRow(row, binding.bindingRef),
			replayed: false,
		};
	});
}

export async function getCurrentSecurityContract(
	taskRevisionSnapshotId: string,
	database: typeof db | DbTransaction = db,
) {
	const [row] = await database
		.select({ contract: securityContracts, head: securityContractHeads })
		.from(securityContractHeads)
		.innerJoin(
			securityContracts,
			eq(
				securityContracts.contractRef,
				securityContractHeads.currentContractRef,
			),
		)
		.where(
			eq(securityContractHeads.taskRevisionSnapshotId, taskRevisionSnapshotId),
		)
		.limit(1);
	return row
		? {
				contract: row.contract.payloadJson as SecurityContractV1,
				headRevision: row.head.headRevision,
			}
		: null;
}

export async function saveSecurityContractWithCas(input: {
	contract: SecurityContractV1;
	expectedCurrentContractRef: string | null;
	expectedHeadRevision: number;
}) {
	return db.transaction(async (tx) => {
		const current = await getCurrentSecurityContract(
			input.contract.taskRevisionSnapshotId,
			tx,
		);
		if (
			(current?.contract.contractRef ?? null) !==
				input.expectedCurrentContractRef ||
			(current?.headRevision ?? 0) !== input.expectedHeadRevision
		) {
			throw new SecurityIntelligenceIntegrityError(
				"security_contract_head_conflict",
				current?.contract.contractRef,
			);
		}
		if (
			input.contract.contractRevision !== input.expectedHeadRevision + 1 ||
			(input.expectedCurrentContractRef === null
				? input.contract.supersedesContractRef !== undefined
				: input.contract.supersedesContractRef !==
					input.expectedCurrentContractRef)
		) {
			throw new SecurityIntelligenceIntegrityError(
				"security_contract_revision_mismatch",
				current?.contract.contractRef,
			);
		}
		await tx.insert(securityContracts).values({
			contractRef: input.contract.contractRef,
			contractRevision: input.contract.contractRevision,
			taskId: input.contract.taskId,
			taskRevisionSnapshotId: input.contract.taskRevisionSnapshotId,
			taskRevision: input.contract.taskRevision,
			taskDigest: input.contract.taskDigest,
			repositoryId: input.contract.repositoryId,
			payloadJson: input.contract,
			supersedesContractRef: input.contract.supersedesContractRef,
			contractDigest: input.contract.contractDigest,
			authorPrincipalRef: input.contract.authorPrincipalRef,
			createdAt: new Date(input.contract.createdAt),
			updatedAt: new Date(input.contract.createdAt),
		});
		if (!current) {
			await tx.insert(securityContractHeads).values({
				taskRevisionSnapshotId: input.contract.taskRevisionSnapshotId,
				currentContractRef: input.contract.contractRef,
				headRevision: 1,
				updatedAt: new Date(),
			});
		} else {
			const updated = await tx
				.update(securityContractHeads)
				.set({
					currentContractRef: input.contract.contractRef,
					headRevision: input.contract.contractRevision,
					updatedAt: new Date(),
				})
				.where(
					and(
						eq(
							securityContractHeads.taskRevisionSnapshotId,
							input.contract.taskRevisionSnapshotId,
						),
						eq(
							securityContractHeads.currentContractRef,
							input.expectedCurrentContractRef as string,
						),
						eq(securityContractHeads.headRevision, input.expectedHeadRevision),
					),
				)
				.returning();
			if (updated.length !== 1) {
				throw new SecurityIntelligenceIntegrityError(
					"security_contract_head_conflict",
				);
			}
		}
		return input.contract;
	});
}

export async function getCurrentCompletionConditions(
	taskRevisionSnapshotId: string,
	database: typeof db | DbTransaction = db,
) {
	const rows = await database
		.select({
			condition: taskCompletionConditions,
			head: taskCompletionConditionHeads,
		})
		.from(taskCompletionConditionHeads)
		.innerJoin(
			taskCompletionConditions,
			eq(
				taskCompletionConditions.conditionRef,
				taskCompletionConditionHeads.currentConditionRef,
			),
		)
		.where(
			eq(
				taskCompletionConditionHeads.taskRevisionSnapshotId,
				taskRevisionSnapshotId,
			),
		);
	return rows.map((row) => ({
		headId: row.head.id,
		condition: {
			conditionRef: row.condition.conditionRef,
			taskId: row.condition.taskId,
			taskRevisionSnapshotId: row.condition.taskRevisionSnapshotId,
			taskRevision: row.condition.taskRevision,
			taskDigest: row.condition.taskDigest,
			conditionRevision: row.condition.conditionRevision,
			conditionKey: row.condition.conditionKey,
			state: row.condition.state,
			source: row.condition.sourceJson,
			subjectRef: row.condition.subjectRef,
			supersedesConditionRef: row.condition.supersedesConditionRef ?? undefined,
			conditionDigest: row.condition.conditionDigest,
			recordedAt: row.condition.recordedAt.toISOString(),
			authorPrincipalRef: row.condition.authorPrincipalRef,
		} as AdoptedCompletionCondition,
		headRevision: row.head.headRevision,
	}));
}

export async function saveCompletionConditionWithCas(input: {
	condition: AdoptedCompletionCondition;
	expectedCurrentConditionRef: string | null;
	expectedHeadRevision: number;
}) {
	return db.transaction(async (tx) => {
		const currentRows = await getCurrentCompletionConditions(
			input.condition.taskRevisionSnapshotId,
			tx,
		);
		const current = currentRows.find(
			(item) => item.condition.conditionKey === input.condition.conditionKey,
		);
		if (
			(current?.condition.conditionRef ?? null) !==
				input.expectedCurrentConditionRef ||
			(current?.headRevision ?? 0) !== input.expectedHeadRevision ||
			input.condition.conditionRevision !== input.expectedHeadRevision + 1
		) {
			throw new SecurityIntelligenceIntegrityError(
				"completion_condition_head_conflict",
				current?.condition.conditionRef,
			);
		}
		await tx.insert(taskCompletionConditions).values({
			conditionRef: input.condition.conditionRef,
			taskId: input.condition.taskId,
			taskRevisionSnapshotId: input.condition.taskRevisionSnapshotId,
			taskRevision: input.condition.taskRevision,
			taskDigest: input.condition.taskDigest,
			conditionRevision: input.condition.conditionRevision,
			conditionKey: input.condition.conditionKey,
			state: input.condition.state,
			sourceJson: input.condition.source,
			subjectRef: input.condition.subjectRef,
			supersedesConditionRef: input.condition.supersedesConditionRef,
			conditionDigest: input.condition.conditionDigest,
			recordedAt: new Date(input.condition.recordedAt),
			authorPrincipalRef: input.condition.authorPrincipalRef,
			createdAt: new Date(input.condition.recordedAt),
			updatedAt: new Date(input.condition.recordedAt),
		});
		if (!current) {
			await tx.insert(taskCompletionConditionHeads).values({
				taskRevisionSnapshotId: input.condition.taskRevisionSnapshotId,
				conditionKey: input.condition.conditionKey,
				currentConditionRef: input.condition.conditionRef,
				headRevision: 1,
			});
		} else {
			const updated = await tx
				.update(taskCompletionConditionHeads)
				.set({
					currentConditionRef: input.condition.conditionRef,
					headRevision: input.condition.conditionRevision,
					updatedAt: new Date(),
				})
				.where(
					and(
						eq(taskCompletionConditionHeads.id, current.headId),
						eq(
							taskCompletionConditionHeads.currentConditionRef,
							input.expectedCurrentConditionRef as string,
						),
						eq(
							taskCompletionConditionHeads.headRevision,
							input.expectedHeadRevision,
						),
					),
				)
				.returning();
			if (updated.length !== 1) {
				throw new SecurityIntelligenceIntegrityError(
					"completion_condition_head_conflict",
				);
			}
		}
		return input.condition;
	});
}
