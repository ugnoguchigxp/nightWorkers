import { and, eq, isNull, lte, or } from "drizzle-orm";
import type { SecurityAssessmentSubjectBindingV1 } from "../../../shared/schemas/security-intelligence-runtime.schema";
import { canonicalStringifySecurityIntelligenceValue } from "../../../shared/security-intelligence-assessment-contract";
import { type DbTransaction, db } from "../../db/client";
import {
	securityAssessmentAttempts,
	securityAssessmentSubjectBindings,
} from "../../db/security-intelligence-schema";
import { SecurityIntelligenceIntegrityError } from "./security-intelligence-integrity";
import type { SecurityAssessmentAttemptRecord } from "./security-intelligence-records";

const POST_ASSESSMENT_STARTING = "SECURITY_POST_ASSESSMENT_STARTING";
const POST_ASSESSMENT_START_LEASE_MS = 2 * 60 * 1_000;
const POST_ASSESSMENT_CHECKPOINT_RANK = {
	grant_created: 1,
	previewed: 2,
	started: 3,
} as const;
const ASSESSMENT_ATTEMPT_CONFLICT_RETRIES = 3;

function checkpointRank(value: unknown) {
	if (
		typeof value !== "object" ||
		value === null ||
		!("stage" in value) ||
		typeof value.stage !== "string"
	) {
		return undefined;
	}
	return POST_ASSESSMENT_CHECKPOINT_RANK[
		value.stage as keyof typeof POST_ASSESSMENT_CHECKPOINT_RANK
	];
}

function resolveExecutionContextUpdate(
	existing: unknown,
	incoming: unknown | undefined,
) {
	if (incoming === undefined) return { kind: "preserve" as const };
	if (existing === null) {
		return incoming === null
			? { kind: "preserve" as const }
			: { kind: "update" as const, value: incoming };
	}
	if (incoming === null) {
		const existingRank = checkpointRank(existing);
		if (existingRank === 1 || existingRank === 2) {
			return { kind: "update" as const, value: null };
		}
		if (existingRank === 3) return { kind: "stale" as const };
		throw new SecurityIntelligenceIntegrityError(
			"assessment_attempt_checkpoint_conflict",
			"unknown_checkpoint_reset",
		);
	}
	const existingCanonical =
		canonicalStringifySecurityIntelligenceValue(existing);
	const incomingCanonical =
		canonicalStringifySecurityIntelligenceValue(incoming);
	if (existingCanonical === incomingCanonical) {
		return { kind: "preserve" as const };
	}
	const existingRank = checkpointRank(existing);
	const incomingRank = checkpointRank(incoming);
	if (existingRank === undefined || incomingRank === undefined) {
		throw new SecurityIntelligenceIntegrityError(
			"assessment_attempt_checkpoint_conflict",
			"unknown_checkpoint_transition",
		);
	}
	if (incomingRank < existingRank) return { kind: "stale" as const };
	if (incomingRank === existingRank) {
		throw new SecurityIntelligenceIntegrityError(
			"assessment_attempt_checkpoint_conflict",
			`stage_rank:${incomingRank}`,
		);
	}
	return { kind: "update" as const, value: incoming };
}

function assertAttemptIdentity(
	existing: typeof securityAssessmentAttempts.$inferSelect,
	input: Pick<
		SecurityAssessmentAttemptRecord,
		| "attemptRef"
		| "phase"
		| "repositoryId"
		| "taskId"
		| "taskRevisionSnapshotId"
		| "implementationRunId"
	>,
) {
	if (
		existing.attemptRef !== input.attemptRef ||
		existing.phase !== input.phase ||
		existing.repositoryId !== input.repositoryId ||
		existing.taskId !== input.taskId ||
		existing.taskRevisionSnapshotId !== input.taskRevisionSnapshotId ||
		existing.implementationRunId !== (input.implementationRunId ?? null)
	) {
		throw new SecurityIntelligenceIntegrityError(
			"assessment_attempt_integrity_conflict",
			existing.attemptRef,
		);
	}
}

export async function claimPostAssessmentStart(
	input: Omit<
		SecurityAssessmentAttemptRecord,
		"status" | "reasonCode" | "retryable" | "executionContextJson"
	>,
	database: typeof db = db,
) {
	return database.transaction(async (tx) => {
		const now = new Date();
		const [inserted] = await tx
			.insert(securityAssessmentAttempts)
			.values({
				...input,
				status: "unavailable",
				reasonCode: POST_ASSESSMENT_STARTING,
				retryable: true,
				createdAt: now,
				updatedAt: now,
			})
			.onConflictDoNothing()
			.returning();
		if (inserted) return { acquired: true as const, attempt: inserted };

		const [existing] = await tx
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
		assertAttemptIdentity(existing, input);
		if (existing.executionContextJson !== null) {
			return { acquired: false as const, attempt: existing };
		}
		if (
			existing.status !== "unavailable" ||
			(existing.reasonCode === POST_ASSESSMENT_STARTING &&
				existing.updatedAt.getTime() >
					now.getTime() - POST_ASSESSMENT_START_LEASE_MS)
		) {
			return { acquired: false as const, attempt: existing };
		}
		const [claimed] = await tx
			.update(securityAssessmentAttempts)
			.set({
				reasonCode: POST_ASSESSMENT_STARTING,
				retryable: true,
				updatedAt: now,
			})
			.where(
				and(
					eq(securityAssessmentAttempts.id, existing.id),
					eq(securityAssessmentAttempts.status, "unavailable"),
					isNull(securityAssessmentAttempts.executionContextJson),
					lte(securityAssessmentAttempts.updatedAt, existing.updatedAt),
				),
			)
			.returning();
		return {
			acquired: claimed !== undefined,
			attempt: claimed ?? existing,
		};
	});
}

export async function saveAssessmentAttempt(
	input: SecurityAssessmentAttemptRecord,
	database: typeof db | DbTransaction = db,
) {
	return saveAssessmentAttemptWithRetry(
		input,
		database,
		ASSESSMENT_ATTEMPT_CONFLICT_RETRIES,
	);
}

async function saveAssessmentAttemptWithRetry(
	input: SecurityAssessmentAttemptRecord,
	database: typeof db | DbTransaction,
	remainingConflictRetries: number,
): Promise<typeof securityAssessmentAttempts.$inferSelect> {
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
	assertAttemptIdentity(existing, input);
	if (existing.status === "completed") return existing;
	const executionContextUpdate = resolveExecutionContextUpdate(
		existing.executionContextJson,
		input.executionContextJson,
	);
	if (executionContextUpdate.kind === "stale") {
		if (input.status === existing.status) return existing;
		throw new SecurityIntelligenceIntegrityError(
			"assessment_attempt_checkpoint_conflict",
			existing.attemptRef,
		);
	}
	const executionContextMatches =
		existing.executionContextJson === null
			? isNull(securityAssessmentAttempts.executionContextJson)
			: eq(
					securityAssessmentAttempts.executionContextJson,
					existing.executionContextJson,
				);
	if (input.status === existing.status) {
		if (existing.status !== "unavailable") return existing;
		const [updated] = await database
			.update(securityAssessmentAttempts)
			.set({
				reasonCode: input.reasonCode,
				retryable: input.retryable,
				scanBindingId: input.scanBindingId,
				assessmentReceiptId: input.assessmentReceiptId,
				...(executionContextUpdate.kind === "update"
					? { executionContextJson: executionContextUpdate.value }
					: {}),
				updatedAt: new Date(),
			})
			.where(
				and(
					eq(securityAssessmentAttempts.id, existing.id),
					eq(securityAssessmentAttempts.status, "unavailable"),
					executionContextMatches,
				),
			)
			.returning();
		if (updated) return updated;
		return retryOrRequireConcurrentCompletedAttempt(
			input,
			database,
			existing.id,
			existing.attemptRef,
			remainingConflictRetries,
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
			...(executionContextUpdate.kind === "update"
				? { executionContextJson: executionContextUpdate.value }
				: {}),
			updatedAt: new Date(),
		})
		.where(
			and(
				eq(securityAssessmentAttempts.id, existing.id),
				eq(securityAssessmentAttempts.status, "unavailable"),
				executionContextMatches,
			),
		)
		.returning();
	if (updated) return updated;
	return retryOrRequireConcurrentCompletedAttempt(
		input,
		database,
		existing.id,
		existing.attemptRef,
		remainingConflictRetries,
	);
}

async function retryOrRequireConcurrentCompletedAttempt(
	input: SecurityAssessmentAttemptRecord,
	database: typeof db | DbTransaction,
	id: string,
	attemptRef: string,
	remainingConflictRetries: number,
): Promise<typeof securityAssessmentAttempts.$inferSelect> {
	if (remainingConflictRetries > 0) {
		return saveAssessmentAttemptWithRetry(
			input,
			database,
			remainingConflictRetries - 1,
		);
	}
	return requireConcurrentCompletedAttempt(database, id, attemptRef);
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
