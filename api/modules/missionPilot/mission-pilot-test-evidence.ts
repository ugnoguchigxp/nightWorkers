export const testEvidenceValidationReasonCodes = [
	"selected_evidence_missing",
	"selected_evidence_duplicate",
	"selected_evidence_not_found",
	"selected_evidence_scope_mismatch",
	"selected_evidence_failed",
	"selected_evidence_raw_artifact_missing",
] as const;

export type TestEvidenceValidationReason =
	(typeof testEvidenceValidationReasonCodes)[number];

export type TestEvidenceRow = {
	id: string;
	taskId: string;
	runId: string | null;
	verificationDocumentId: string | null;
	exitCode: number;
	rawStdoutArtifactId: string | null;
	rawStderrArtifactId: string | null;
};

export type TestEvidenceHistorySummary = {
	totalCount: number;
	acceptedCount: number;
	historicalFailureCount: number;
};

export function resolveAcceptedTestEvidence(input: {
	selectedEvidenceRunIds: string[];
	taskId: string;
	runId: string;
	verificationDocumentId: string;
	selectedRows: TestEvidenceRow[];
	historyRows: TestEvidenceRow[];
}) {
	const reasons = new Set<TestEvidenceValidationReason>();
	const selectedIds = input.selectedEvidenceRunIds;
	if (selectedIds.length === 0) reasons.add("selected_evidence_missing");
	if (new Set(selectedIds).size !== selectedIds.length)
		reasons.add("selected_evidence_duplicate");

	const rowsById = new Map(input.selectedRows.map((row) => [row.id, row]));
	const acceptedEvidence: TestEvidenceRow[] = [];
	for (const id of new Set(selectedIds)) {
		const row = rowsById.get(id);
		if (!row) {
			reasons.add("selected_evidence_not_found");
			continue;
		}
		if (
			row.taskId !== input.taskId ||
			row.runId !== input.runId ||
			row.verificationDocumentId !== input.verificationDocumentId
		) {
			reasons.add("selected_evidence_scope_mismatch");
			continue;
		}
		if (row.exitCode !== 0) {
			reasons.add("selected_evidence_failed");
			continue;
		}
		if (!row.rawStdoutArtifactId || !row.rawStderrArtifactId) {
			reasons.add("selected_evidence_raw_artifact_missing");
			continue;
		}
		acceptedEvidence.push(row);
	}

	const acceptedIds = new Set(acceptedEvidence.map((row) => row.id));
	const historySummary: TestEvidenceHistorySummary = {
		totalCount: input.historyRows.length,
		acceptedCount: acceptedEvidence.length,
		historicalFailureCount: input.historyRows.filter(
			(row) => row.exitCode !== 0 && !acceptedIds.has(row.id),
		).length,
	};

	return {
		acceptedEvidence,
		reasons: [...reasons],
		historySummary,
	};
}
