import { and, eq } from "drizzle-orm";
import {
	EVIDENCE_ASSURANCE_POLICY_LEGACY,
	EVIDENCE_ASSURANCE_POLICY_STRICT_V1,
	type EvidenceCheckReadinessSnapshot,
	evidenceCheckReadinessSnapshotSchema,
} from "../../../../shared/modules/codingAgent";
import { db } from "../../../db/client";
import {
	codingAgentEvidenceCheckConfirmations,
	codingAgentEvidenceReadinessSettlements,
} from "../../../db/verification-schema";
import { AppError } from "../../../lib/errors";

type SnapshotCore = EvidenceCheckReadinessSnapshot;

export type EvidenceConfirmationRecord = {
	id: string;
	observedEvidenceRunIds: string[];
	policyVersion:
		| typeof EVIDENCE_ASSURANCE_POLICY_STRICT_V1
		| typeof EVIDENCE_ASSURANCE_POLICY_LEGACY;
	sourceStateHash: string | null;
	verificationDocumentDigest: string | null;
	authorizedVerifyDigest: string | null;
	receiptDigest: string | null;
	snapshot: SnapshotCore;
};

export async function readEvidenceConfirmation(input: {
	taskId: string;
	runId?: string | null;
	verificationDocumentId: string;
}): Promise<EvidenceConfirmationRecord | null> {
	if (!input.runId) return null;
	const row = await db
		.select({
			id: codingAgentEvidenceCheckConfirmations.id,
			observedEvidenceRunIdsJson:
				codingAgentEvidenceCheckConfirmations.observedEvidenceRunIdsJson,
			policyVersion: codingAgentEvidenceCheckConfirmations.policyVersion,
			sourceStateHash: codingAgentEvidenceCheckConfirmations.sourceStateHash,
			verificationDocumentDigest:
				codingAgentEvidenceCheckConfirmations.verificationDocumentDigest,
			authorizedVerifyDigest:
				codingAgentEvidenceCheckConfirmations.authorizedVerifyDigest,
			receiptDigest: codingAgentEvidenceCheckConfirmations.receiptDigest,
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
		id: row.id,
		observedEvidenceRunIds: row.observedEvidenceRunIdsJson,
		policyVersion:
			row.policyVersion === EVIDENCE_ASSURANCE_POLICY_STRICT_V1
				? EVIDENCE_ASSURANCE_POLICY_STRICT_V1
				: EVIDENCE_ASSURANCE_POLICY_LEGACY,
		sourceStateHash: row.sourceStateHash,
		verificationDocumentDigest: row.verificationDocumentDigest,
		authorizedVerifyDigest: row.authorizedVerifyDigest,
		receiptDigest: row.receiptDigest,
		snapshot: parsed.data,
	};
}

export async function persistEvidenceConfirmation(input: {
	taskId: string;
	runId: string;
	verificationDocumentId: string;
	initialEvidenceRunId: string;
	observedEvidenceRunIds: string[];
	policyVersion: typeof EVIDENCE_ASSURANCE_POLICY_STRICT_V1;
	sourceStateHash: string;
	verificationDocumentDigest: string;
	authorizedVerifyDigest: string;
	receiptDigest: string;
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
			policyVersion: input.policyVersion,
			sourceStateHash: input.sourceStateHash,
			verificationDocumentDigest: input.verificationDocumentDigest,
			authorizedVerifyDigest: input.authorizedVerifyDigest,
			receiptDigest: input.receiptDigest,
			snapshotJson: { ...input.result },
		})
		.onConflictDoNothing();
	const stored = await readEvidenceConfirmation(input);
	if (!stored) return input.result;
	if (
		stored.policyVersion === EVIDENCE_ASSURANCE_POLICY_STRICT_V1 &&
		stored.receiptDigest !== input.receiptDigest
	) {
		throw new AppError(
			409,
			"evidence_confirmation_conflict",
			"Evidence Check Receipt is already bound to different evidence for this Run and Verification Document.",
		);
	}
	return stored.snapshot;
}

export async function readEvidenceSettlement(input: {
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

export async function persistEvidenceSettlement(input: {
	taskId: string;
	runId: string;
	verificationDocumentId: string;
	evidenceRunId: string;
	confirmationId: string;
	receiptDigest: string | null;
	result: SnapshotCore;
}) {
	await db
		.insert(codingAgentEvidenceReadinessSettlements)
		.values({
			taskId: input.taskId,
			runId: input.runId,
			verificationDocumentId: input.verificationDocumentId,
			evidenceRunId: input.evidenceRunId,
			confirmationId: input.confirmationId,
			receiptDigest: input.receiptDigest,
			snapshotJson: { ...input.result },
		})
		.onConflictDoNothing();
	return (await readEvidenceSettlement(input)) ?? input.result;
}
