import * as repo from "../../nightworkers/nightworkers.repository";

export async function getOntologyRunDebugReport(runId: string) {
	const run = await repo.getTaskRun(runId);
	if (!run) return null;
	const events = await repo.listTaskEventsForRun(runId);
	const contextSnapshot = asRecord(run.contextSnapshot);
	const snapshotOntologyContext = asRecordOrNull(
		contextSnapshot.ontologyContext,
	);
	const snapshotBoundaryAudit = asRecordOrNull(
		contextSnapshot.ontologyBoundaryAudit,
	);
	const ontologyContext =
		snapshotOntologyContext ??
		findOntologyPayload(
			events,
			"ontology.runtime_context_snapshot",
			"ontologyContext",
		);
	const ontologyBoundaryAudit =
		snapshotBoundaryAudit ??
		findOntologyPayload(
			events,
			"ontology.boundary_closeout_audit",
			"ontologyBoundaryAudit",
		);
	const runtimeContextEvent = events.some(
		(event) =>
			readRunEventAction(event) === "ontology.runtime_context_snapshot",
	);
	const boundaryAuditEvent = events.some(
		(event) => readRunEventAction(event) === "ontology.boundary_closeout_audit",
	);
	const runtimeLane = stringOrNull(ontologyContext?.runtimeLane);
	const secondaryModules = arrayOfStrings(ontologyContext?.secondaryModules);
	const boundaryCrossings = arrayOfRecords(
		ontologyBoundaryAudit?.boundaryCrossings,
	);
	const needsConfirmation = arrayOfRecords(
		ontologyBoundaryAudit?.needsConfirmation,
	);
	const forbiddenTouched = arrayOfRecords(
		ontologyBoundaryAudit?.forbiddenTouched,
	);
	const unexplainedCrossingsCount = countUnexplainedCrossingPaths({
		boundaryCrossings,
		needsConfirmation,
		forbiddenTouched,
	});
	const focusedVerification = arrayOfStrings(
		asRecord(ontologyBoundaryAudit?.verificationSelection).focused,
	);
	return {
		runId: run.id,
		taskId: run.taskId,
		repositoryId: run.repositoryId ?? null,
		status: run.status,
		runtimeLane,
		ontologyContext,
		ontologyBoundaryAudit,
		evidenceSources: {
			contextSnapshot: Boolean(
				snapshotOntologyContext || snapshotBoundaryAudit,
			),
			runtimeContextEvent,
			boundaryAuditEvent,
		},
		summary: {
			available: Boolean(ontologyContext?.available),
			primaryModule: stringOrNull(ontologyContext?.primaryModule),
			secondaryModules,
			taskGenerationEvidence: Boolean(ontologyContext?.taskGenerationEvidence),
			boundaryDecision: stringOrNull(ontologyBoundaryAudit?.decision),
			touchedFilesCount: arrayOfStrings(ontologyBoundaryAudit?.touchedFiles)
				.length,
			unexplainedCrossingsCount,
			focusedVerificationCount: focusedVerification.length,
			focusedVerificationState: readFocusedVerificationState({
				testResults: run.testResults,
				auditAvailable: Boolean(ontologyBoundaryAudit?.available),
				focusedVerificationCount: focusedVerification.length,
			}),
		},
		warnings: uniqueStrings([
			...arrayOfStrings(ontologyContext?.warnings),
			...arrayOfStrings(ontologyBoundaryAudit?.warnings),
		]),
	};
}

function findOntologyPayload(
	events: Array<{ payloadJson?: unknown }>,
	action: string,
	field: string,
) {
	for (const event of events) {
		if (readRunEventAction(event) !== action) continue;
		const value = asRecordOrNull(readRunEventData(event)[field]);
		if (value) return value;
	}
	return null;
}

function readRunEventAction(event: { payloadJson?: unknown }) {
	return stringOrNull(readRunEventData(event).action);
}

function readRunEventData(event: { payloadJson?: unknown }) {
	const payload = asRecord(event.payloadJson);
	return {
		...asRecord(payload.data),
		...asRecord(asRecord(payload.runEvent).data),
	};
}

function countUnexplainedCrossingPaths(input: {
	boundaryCrossings: Array<Record<string, unknown>>;
	needsConfirmation: Array<Record<string, unknown>>;
	forbiddenTouched: Array<Record<string, unknown>>;
}) {
	const paths = new Set<string>();
	for (const crossing of input.boundaryCrossings) {
		if (crossing.declaredSecondary) continue;
		for (const path of arrayOfStrings(crossing.paths)) paths.add(path);
	}
	for (const item of [...input.needsConfirmation, ...input.forbiddenTouched]) {
		const path = stringOrNull(item.path);
		if (path) paths.add(path);
	}
	return paths.size;
}

function readFocusedVerificationState(input: {
	testResults: unknown;
	auditAvailable: boolean;
	focusedVerificationCount: number;
}): "passed" | "failed" | "selected" | "not_selected" | "unavailable" {
	const testResults = asRecord(input.testResults);
	if (testResults.passed === true) return "passed";
	if (testResults.passed === false) return "failed";
	if (input.focusedVerificationCount > 0) return "selected";
	return input.auditAvailable ? "not_selected" : "unavailable";
}

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function asRecordOrNull(value: unknown): Record<string, unknown> | null {
	const record = asRecord(value);
	return Object.keys(record).length > 0 ? record : null;
}

function arrayOfRecords(value: unknown): Array<Record<string, unknown>> {
	return Array.isArray(value) ? value.map(asRecord) : [];
}

function arrayOfStrings(value: unknown): string[] {
	return Array.isArray(value)
		? value
				.map((item) => stringOrNull(item))
				.filter((item): item is string => Boolean(item))
		: [];
}

function uniqueStrings(values: string[]) {
	return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function stringOrNull(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}
