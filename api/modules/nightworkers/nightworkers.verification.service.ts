import {
	isVerificationChecklistItemComplete,
	type NormalizedVerificationEvidence,
	type SpecificationVerificationDocument,
	specificationVerificationDocumentSchema,
} from "../../../shared/schemas/verification-checklist.schema";
import {
	applyEvidenceToChecklist,
	summarizeChecklist,
} from "../../services/verification/checklist-matcher";
import * as repository from "./nightworkers.verification.repository";

export type CompletionCheckResult = {
	ok: boolean;
	verificationDocumentId: string | null;
	summary: {
		total: number;
		complete: number;
		failedRequired: number;
		unknownRequired: number;
	};
	failedRequired: Array<{ conditionId: string; text: string; reason?: string }>;
	unknownRequired: Array<{
		conditionId: string;
		text: string;
		reason?: string;
	}>;
	conditions: Array<{
		conditionId: string;
		text: string;
		required: boolean;
		status: string;
		reason?: string;
	}>;
	reason?: string;
};

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
	const evidenceRun = await repository.createVerificationEvidenceRun(input);
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

export async function runCompletionCheck(input: {
	taskId: string;
	verificationDocumentId?: string | null;
}): Promise<CompletionCheckResult> {
	const document = input.verificationDocumentId
		? await repository.getVerificationDocument(input.verificationDocumentId)
		: await repository.getLatestVerificationDocumentForTask(input.taskId);
	if (!document) {
		return {
			ok: false,
			verificationDocumentId: null,
			summary: {
				total: 0,
				complete: 0,
				failedRequired: 0,
				unknownRequired: 0,
			},
			failedRequired: [],
			unknownRequired: [],
			conditions: [],
			reason: "missing_verification_document",
		};
	}
	const items = await repository.listVerificationChecklistItems(document.id);
	const summary = summarizeChecklist(items);
	const completeCount = items.filter(
		isVerificationChecklistItemComplete,
	).length;
	return {
		ok: summary.complete,
		verificationDocumentId: document.id,
		summary: {
			total: items.length,
			complete: completeCount,
			failedRequired: summary.failedRequired.length,
			unknownRequired: summary.unknownRequired.length,
		},
		failedRequired: summary.failedRequired.map(formatCondition),
		unknownRequired: summary.unknownRequired.map(formatCondition),
		conditions: items.map((item) => ({
			conditionId: item.conditionId,
			text: item.text,
			required: item.required,
			status: item.status,
			reason: item.reason,
		})),
		reason: summary.complete ? undefined : "required_conditions_incomplete",
	};
}

function formatCondition(input: {
	conditionId: string;
	text: string;
	reason?: string;
}) {
	return {
		conditionId: input.conditionId,
		text: input.text,
		reason: input.reason,
	};
}
