import { and, eq, or } from "drizzle-orm";
import type { SecurityAssessmentSubjectBindingV1 } from "../../../shared/schemas/security-intelligence-runtime.schema";
import { type DbTransaction, db } from "../../db/client";
import {
	securityAssessmentAttempts,
	securityAssessmentSubjectBindings,
} from "../../db/security-intelligence-schema";
import { SecurityIntelligenceIntegrityError } from "./security-intelligence-integrity";
import type { SecurityAssessmentAttemptRecord } from "./security-intelligence-records";

export async function saveAssessmentAttempt(
	input: SecurityAssessmentAttemptRecord,
	database: typeof db | DbTransaction = db,
) {
	let [existing] = await database
		.select()
		.from(securityAssessmentAttempts)
		.where(eq(securityAssessmentAttempts.requestDigest, input.requestDigest))
		.limit(1);
	if (!existing) {
		const [inserted] = await database
			.insert(securityAssessmentAttempts)
			.values(input)
			.onConflictDoNothing()
			.returning();
		if (inserted) return inserted;
		[existing] = await database
			.select()
			.from(securityAssessmentAttempts)
			.where(eq(securityAssessmentAttempts.requestDigest, input.requestDigest))
			.limit(1);
		if (!existing) {
			throw new SecurityIntelligenceIntegrityError(
				"assessment_attempt_reference_conflict",
				input.attemptRef,
			);
		}
	}
	if (
		existing.phase !== input.phase ||
		existing.taskId !== input.taskId ||
		existing.taskRevisionSnapshotId !== input.taskRevisionSnapshotId ||
		existing.implementationRunId !== (input.implementationRunId ?? null)
	) {
		throw new SecurityIntelligenceIntegrityError(
			"assessment_attempt_integrity_conflict",
			existing.attemptRef,
		);
	}
	if (existing.status === "completed") return existing;
	if (input.status === existing.status) {
		if (existing.status !== "unavailable") return existing;
		const [updated] = await database
			.update(securityAssessmentAttempts)
			.set({
				reasonCode: input.reasonCode,
				retryable: input.retryable,
				scanBindingId: input.scanBindingId,
				assessmentReceiptId: input.assessmentReceiptId,
				updatedAt: new Date(),
			})
			.where(
				and(
					eq(securityAssessmentAttempts.id, existing.id),
					eq(securityAssessmentAttempts.status, "unavailable"),
				),
			)
			.returning();
		if (updated) return updated;
		return requireConcurrentCompletedAttempt(
			database,
			existing.id,
			existing.attemptRef,
		);
	}
	if (existing.status !== "unavailable" || input.status !== "completed") {
		throw new SecurityIntelligenceIntegrityError(
			"assessment_attempt_invalid_transition",
			existing.attemptRef,
		);
	}
	const [updated] = await database
		.update(securityAssessmentAttempts)
		.set({
			status: input.status,
			reasonCode: input.reasonCode,
			retryable: input.retryable,
			scanBindingId: input.scanBindingId,
			assessmentReceiptId: input.assessmentReceiptId,
			updatedAt: new Date(),
		})
		.where(
			and(
				eq(securityAssessmentAttempts.id, existing.id),
				eq(securityAssessmentAttempts.status, "unavailable"),
			),
		)
		.returning();
	if (updated) return updated;
	return requireConcurrentCompletedAttempt(
		database,
		existing.id,
		existing.attemptRef,
	);
}

async function requireConcurrentCompletedAttempt(
	database: typeof db | DbTransaction,
	id: string,
	attemptRef: string,
) {
	const [current] = await database
		.select()
		.from(securityAssessmentAttempts)
		.where(eq(securityAssessmentAttempts.id, id))
		.limit(1);
	if (current?.status === "completed") return current;
	throw new SecurityIntelligenceIntegrityError(
		"assessment_attempt_concurrent_transition",
		attemptRef,
	);
}

export async function saveSubjectBinding(input: {
	binding: SecurityAssessmentSubjectBindingV1;
	assessmentReceiptId: string;
}) {
	const binding = input.binding;
	const values = {
		bindingRef: binding.bindingRef,
		bindingDigest: binding.bindingDigest,
		phase: binding.phase,
		assessmentReceiptId: input.assessmentReceiptId,
		taskId: binding.taskId,
		taskRevisionSnapshotId: binding.taskRevisionSnapshotId,
		taskRevision: binding.taskRevision,
		taskDigest: binding.taskDigest,
		createdAt: new Date(binding.createdAt),
		updatedAt: new Date(binding.createdAt),
		...(binding.phase === "pre_implementation"
			? {
					repositoryIdentityRevision: binding.repositoryIdentityRevision,
					repositoryBaseWorktreeId: binding.repositoryBaseWorktreeId,
					expectedBaseHeadSha: binding.expectedBaseHeadSha,
				}
			: {
					implementationRunId: binding.implementationRunId,
					evidenceSubjectSnapshotId: binding.evidenceSubjectSnapshotId,
					providerWorkspaceTargetGrantRef:
						binding.providerWorkspaceTargetGrantRef,
					providerWorkspaceTargetGrantDigest:
						binding.providerWorkspaceTargetGrantDigest,
					providerWorkspaceStateDigest: binding.providerWorkspaceStateDigest,
					workspaceId: binding.workspaceId,
					workspaceAllocationVersion: binding.workspaceAllocationVersion,
					admittedHeadSha: binding.admittedHeadSha,
					sourceStateHash: binding.sourceStateHash,
					diffDigest: binding.diffDigest,
				}),
	};
	return db.transaction(async (tx) => {
		const [inserted] = await tx
			.insert(securityAssessmentSubjectBindings)
			.values(values)
			.onConflictDoNothing()
			.returning();
		if (inserted) return inserted;
		const rows = await tx
			.select()
			.from(securityAssessmentSubjectBindings)
			.where(
				or(
					eq(
						securityAssessmentSubjectBindings.bindingDigest,
						binding.bindingDigest,
					),
					eq(securityAssessmentSubjectBindings.bindingRef, binding.bindingRef),
				),
			);
		const [existing] = rows;
		if (
			rows.length !== 1 ||
			!existing ||
			existing.bindingRef !== binding.bindingRef ||
			existing.bindingDigest !== binding.bindingDigest ||
			existing.phase !== binding.phase ||
			existing.assessmentReceiptId !== input.assessmentReceiptId ||
			existing.taskId !== binding.taskId ||
			existing.taskRevisionSnapshotId !== binding.taskRevisionSnapshotId ||
			existing.implementationRunId !==
				(binding.phase === "post_implementation"
					? binding.implementationRunId
					: null)
		) {
			throw new SecurityIntelligenceIntegrityError(
				"assessment_subject_binding_integrity_conflict",
				existing?.bindingRef,
			);
		}
		return existing;
	});
}
