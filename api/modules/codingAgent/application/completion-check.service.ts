import { and, desc, eq } from "drizzle-orm";
import type { EvidenceCheckSnapshot } from "../../../../shared/modules/codingAgent";
import { db } from "../../../db/client";
import { verificationDocuments } from "../../../db/verification-schema";
import { evaluateEvidenceReadiness } from "../verification/evidence-readiness.service";

export type CompletionCheckResult = {
	ok: boolean;
	verificationDocumentId: string | null;
	runId: string | null;
	sourceStateHash: string | null;
	mapping: EvidenceCheckSnapshot["mapping"];
	verify: EvidenceCheckSnapshot["verify"];
	confirmation: EvidenceCheckSnapshot["confirmation"];
	suggestedAction: EvidenceCheckSnapshot["suggestedAction"];
	readinessDigest: string;
	reason?: string;
};

export async function runCompletionCheck(input: {
	taskId: string;
	runId: string;
	verificationDocumentId?: string | null;
	repoRoot?: string;
	confirmEvidenceCheck?: boolean;
}): Promise<CompletionCheckResult> {
	const document = input.verificationDocumentId
		? await db
				.select()
				.from(verificationDocuments)
				.where(
					and(
						eq(verificationDocuments.id, input.verificationDocumentId),
						eq(verificationDocuments.taskId, input.taskId),
						eq(verificationDocuments.status, "active"),
					),
				)
				.then((rows) => rows[0])
		: await db
				.select()
				.from(verificationDocuments)
				.where(
					and(
						eq(verificationDocuments.taskId, input.taskId),
						eq(verificationDocuments.status, "active"),
					),
				)
				.orderBy(desc(verificationDocuments.generatedAt))
				.limit(1)
				.then((rows) => rows[0]);
	if (!document) return unavailable("missing_verification_document");
	if (!input.repoRoot) {
		return {
			...unavailable("missing_repository_context"),
			verificationDocumentId: document.id,
			runId: input.runId,
		};
	}

	const readiness = await evaluateEvidenceReadiness(
		{
			taskId: input.taskId,
			runId: input.runId,
			verificationDocumentId: document.id,
			repoRoot: input.repoRoot,
		},
		{ confirmEvidenceCheck: input.confirmEvidenceCheck },
	);
	return {
		ok: readiness.ready,
		verificationDocumentId: document.id,
		runId: input.runId,
		sourceStateHash: readiness.sourceStateHash,
		mapping: readiness.mapping,
		verify: readiness.verify,
		confirmation: readiness.confirmation,
		suggestedAction: readiness.suggestedAction,
		readinessDigest: readiness.readinessDigest,
		...(readiness.ready ? {} : { reason: readinessReason(readiness) }),
	};
}

function readinessReason(
	readiness: Awaited<ReturnType<typeof evaluateEvidenceReadiness>>,
) {
	if (readiness.confirmation.status === "awaiting_confirmation") {
		return "evidence_check_confirmation_required";
	}
	if (readiness.confirmation.status === "confirmed") {
		return readiness.verify.status === "failed"
			? "evidence_check_followup_verify_failed"
			: "evidence_check_followup_verify_required";
	}
	return `project_verify_${readiness.verify.status}`;
}

function unavailable(reason: string): CompletionCheckResult {
	return {
		ok: false,
		verificationDocumentId: null,
		runId: null,
		sourceStateHash: null,
		mapping: {
			status: "missing",
			definitionDigest: null,
			total: 0,
			matched: 0,
			items: [],
		},
		verify: {
			status: "not_run",
			command: null,
			cwd: null,
			exitCode: null,
			sourceStateHash: null,
			finishedAt: null,
			logRefs: [],
		},
		confirmation: {
			status: "awaiting_initial_verify",
			initialEvidenceRunId: null,
			confirmedAt: null,
		},
		suggestedAction: "run_verify",
		readinessDigest: `unavailable:${reason}`,
		reason,
	};
}
