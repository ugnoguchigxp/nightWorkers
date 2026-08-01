import {
	type NormalizedVerificationEvidence,
	type SpecificationVerificationDocument,
	specificationVerificationDocumentSchema,
} from "../../../shared/schemas/verification-checklist.schema";
import { AppError } from "../../lib/errors";
import {
	applyEvidenceToChecklist,
	summarizeChecklist,
} from "../../services/verification/checklist-matcher";
import { bindEvidenceSubject } from "../evidenceLedger";
import { getTaskRun } from "./nightworkers.runs.repository";
import * as repository from "./nightworkers.verification.repository";

export async function createVerificationDocumentFromSpec(input: {
	taskId: string;
	runId?: string | null;
	specMessageId?: string | null;
	specArtifactId?: string | null;
	verificationArtifactId?: string | null;
	sourceSpecPath: string;
	document: SpecificationVerificationDocument;
}) {
	const parsed = specificationVerificationDocumentSchema.parse(input.document);
	if (parsed.source.taskId !== input.taskId) {
		throw new AppError(
			409,
			"verification_document_task_mismatch",
			"Verification Document source does not match the requested Task.",
		);
	}
	if (input.runId) {
		const run = await getTaskRun(input.runId);
		if (!run || run.taskId !== input.taskId) {
			throw new AppError(
				409,
				"verification_document_run_mismatch",
				"Verification Document Run does not belong to the requested Task.",
			);
		}
	}
	if (input.specMessageId) {
		const message = await repository.getVerificationSourceMessage(
			input.specMessageId,
		);
		if (!message || message.taskId !== input.taskId) {
			throw new AppError(
				409,
				"verification_document_message_mismatch",
				"Verification Document source message does not belong to the requested Task.",
			);
		}
	}
	return repository.createVerificationDocument({
		...input,
		document: parsed,
	});
}

export async function recordVerificationEvidence(input: {
	taskId: string;
	runId?: string | null;
	verificationDocumentId?: string | null;
	checkKind: string;
	fullGate?: boolean;
	evidence: NormalizedVerificationEvidence;
}) {
	await assertVerificationEvidenceScope(input);
	const subject =
		input.runId && input.evidence.sourceSnapshot
			? await bindEvidenceSubject({
					taskId: input.taskId,
					runId: input.runId,
					sourceStateHash: input.evidence.sourceSnapshot.sourceStateHash,
					verificationDocumentId: input.verificationDocumentId,
				})
			: null;
	const evidenceRun = await repository.createVerificationEvidenceRun({
		...input,
		subjectId: subject?.id ?? null,
	});
	if (input.verificationDocumentId) {
		const items = await repository.listVerificationChecklistItems(
			input.verificationDocumentId,
		);
		const updated = applyEvidenceToChecklist({
			items,
			evidence: input.evidence,
			fullGate: input.fullGate,
		});
		await repository.updateVerificationChecklistItems(
			input.verificationDocumentId,
			updated,
		);
		return {
			evidenceRun,
			checklist: summarizeChecklist(updated),
		};
	}
	return { evidenceRun, checklist: null };
}

async function assertVerificationEvidenceScope(input: {
	taskId: string;
	runId?: string | null;
	verificationDocumentId?: string | null;
	evidence: NormalizedVerificationEvidence;
}) {
	if (
		input.evidence.taskId !== input.taskId ||
		!input.runId ||
		input.evidence.runId !== input.runId
	) {
		throw new AppError(
			409,
			"verification_evidence_scope_mismatch",
			"Verification evidence must match the requested Task and Run.",
		);
	}
	const run = await getTaskRun(input.runId);
	if (!run || run.taskId !== input.taskId) {
		throw new AppError(
			409,
			"verification_evidence_run_mismatch",
			"Verification evidence Run does not belong to the requested Task.",
		);
	}
	if (!input.verificationDocumentId) return;
	const document = await repository.getVerificationDocument(
		input.verificationDocumentId,
	);
	if (!document || document.taskId !== input.taskId) {
		throw new AppError(
			409,
			"verification_evidence_document_mismatch",
			"Verification Document does not belong to the requested Task.",
		);
	}
	if (document.status !== "active") {
		throw new AppError(
			409,
			"verification_evidence_document_inactive",
			"Verification evidence can only be recorded against an active document.",
		);
	}
}
