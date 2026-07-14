export type TestEvidenceRow = {
	id: string;
	taskId: string;
	runId: string | null;
	verificationDocumentId: string | null;
	exitCode: number;
	rawStdoutArtifactId: string | null;
	rawStderrArtifactId: string | null;
	checkKind: string;
	finishedAt: Date;
};

export type TestEvidenceHistorySummary = {
	totalCount: number;
	acceptedCount: number;
	historicalFailureCount: number;
	latestFailureCount: number;
};

export function resolvePersistedTestEvidence(input: {
	historyRows: TestEvidenceRow[];
}) {
	const acceptedEvidence = input.historyRows.filter(
		(row) =>
			row.exitCode === 0 &&
			Boolean(row.rawStdoutArtifactId) &&
			Boolean(row.rawStderrArtifactId),
	);
	const latestByCheckKind = new Map<string, TestEvidenceRow>();
	for (const row of input.historyRows) {
		const current = latestByCheckKind.get(row.checkKind);
		if (!current || compareEvidenceOrder(row, current) > 0) {
			latestByCheckKind.set(row.checkKind, row);
		}
	}

	const acceptedIds = new Set(acceptedEvidence.map((row) => row.id));
	const historySummary: TestEvidenceHistorySummary = {
		totalCount: input.historyRows.length,
		acceptedCount: acceptedEvidence.length,
		historicalFailureCount: input.historyRows.filter(
			(row) => row.exitCode !== 0 && !acceptedIds.has(row.id),
		).length,
		latestFailureCount: [...latestByCheckKind.values()].filter(
			(row) => row.exitCode !== 0,
		).length,
	};

	return {
		acceptedEvidence,
		historySummary,
	};
}

function compareEvidenceOrder(left: TestEvidenceRow, right: TestEvidenceRow) {
	const finishedAtDifference =
		left.finishedAt.getTime() - right.finishedAt.getTime();
	return finishedAtDifference || left.id.localeCompare(right.id);
}
