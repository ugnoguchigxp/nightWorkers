import type {
	CodexContractWarningSummary,
	CodexMcpDiagnosticsSummary,
	ImplementationQueueEntry,
	ReviewResult,
	Task,
	TaskEvent,
	TaskMessage,
	TaskRun,
	TaskRunTodo,
	WorkbenchArtifactKind,
	WorkbenchArtifactRef,
	WorkbenchSessionView,
} from "./types";
import {
	getRunEventType,
	higherWarningSeverity,
	isRecord,
	readNonEmptyString,
	readPositiveInteger,
	readRecord,
	readRecordArray,
	readStringArray,
	readWarningSeverity,
	taskMessageMetadata,
	toMs,
	warningSeverityRank,
} from "./workbenchSelectorUtils";

type SessionEvidence = {
	latestRun?: TaskRun;
	queueEntry?: ImplementationQueueEntry;
	planReady?: boolean;
	todos?: TaskRunTodo[];
	events?: TaskEvent[];
	reviews?: ReviewResult[];
	messages?: TaskMessage[];
};

export function getCodexContractWarningSummary(
	latestRun?: TaskRun,
	events: TaskEvent[] = [],
): CodexContractWarningSummary | undefined {
	const snapshotWarnings = readCodexContractSnapshotWarnings(latestRun);
	const eventWarnings = readCodexContractEventWarnings(events);
	const snapshotKeys = new Set(
		snapshotWarnings.map(codexContractWarningIdentityKey),
	);
	const warnings = [
		...snapshotWarnings,
		...eventWarnings.filter(
			(warning) => !snapshotKeys.has(codexContractWarningIdentityKey(warning)),
		),
	];
	if (warnings.length === 0) return undefined;
	const byCode = new Map<
		string,
		CodexContractWarningSummary["items"][number]
	>();
	for (const warning of warnings) {
		const code = readNonEmptyString(warning.code);
		if (!code) continue;
		const severity = readWarningSeverity(warning.severity);
		const count = readPositiveInteger(warning.count) ?? 1;
		const existing = byCode.get(code);
		const changedFiles = readStringArray(warning.changedFiles);
		if (existing) {
			existing.count += count;
			existing.severity = higherWarningSeverity(existing.severity, severity);
			existing.changedFiles = [
				...new Set([...existing.changedFiles, ...changedFiles]),
			];
			existing.command ||= readNonEmptyString(warning.command);
			existing.occurredAt ||=
				readNonEmptyString(warning.occurredAt) || undefined;
		} else {
			byCode.set(code, {
				code,
				severity,
				count,
				changedFiles,
				command: readNonEmptyString(warning.command),
				occurredAt: readNonEmptyString(warning.occurredAt) || undefined,
			});
		}
	}
	const items = [...byCode.values()].sort(
		(a, b) =>
			warningSeverityRank(b.severity) - warningSeverityRank(a.severity) ||
			b.count - a.count,
	);
	const totalCount = items.reduce((sum, item) => sum + item.count, 0);
	return {
		totalCount,
		warningCount: items
			.filter((item) => item.severity === "warning")
			.reduce((sum, item) => sum + item.count, 0),
		errorCount: items
			.filter((item) => item.severity === "error")
			.reduce((sum, item) => sum + item.count, 0),
		items,
	};
}

function codexContractWarningIdentityKey(warning: Record<string, unknown>) {
	return [
		readNonEmptyString(warning.code) || "",
		readWarningSeverity(warning.severity),
		readNonEmptyString(warning.providerItemId) || "",
		readNonEmptyString(warning.toolName) || "",
		readNonEmptyString(warning.command) || "",
		readPositiveInteger(warning.todoSeq) ?? "",
		readStringArray(warning.changedFiles).sort().join(","),
	].join("|");
}

export function getCodexMcpDiagnosticsSummary(
	latestRun?: TaskRun,
): CodexMcpDiagnosticsSummary | undefined {
	const contract = readRuntimeContractSnapshot(latestRun);
	const mcp = readRecord(contract?.mcp);
	if (!mcp) return undefined;
	const configSource = readNonEmptyString(mcp.configSource);
	const degraded = mcp.degraded === true;
	const observedNightWorkersTools = readStringArray(
		mcp.observedNightWorkersTools,
	);
	const expectedTools = readStringArray(mcp.expectedTools);
	const tone: CodexMcpDiagnosticsSummary["tone"] = degraded
		? "warning"
		: configSource === "global_inherited"
			? "info"
			: "neutral";
	const label = degraded
		? "MCP degraded"
		: configSource === "global_inherited"
			? "MCP global inherited"
			: configSource
				? `MCP ${configSource}`
				: "MCP diagnostics";
	return {
		configSource,
		observedNightWorkersTools,
		expectedTools,
		degraded,
		tone,
		label,
	};
}

export function groupWorkbenchSessions(sessions: WorkbenchSessionView[]) {
	return {
		processing: sessions
			.filter((session) => session.group === "processing")
			.sort(
				(a, b) =>
					b.task.priority - a.task.priority ||
					toMs(b.task.updatedAt) - toMs(a.task.updatedAt),
			),
		queue: sessions
			.filter((session) => session.group === "queue")
			.sort(
				(a, b) =>
					b.task.priority - a.task.priority ||
					toMs(b.task.updatedAt) - toMs(a.task.updatedAt),
			),
		archive: sessions
			.filter((session) => session.group === "archive")
			.sort((a, b) => toMs(b.task.updatedAt) - toMs(a.task.updatedAt)),
	};
}

export function countArtifacts(refs: WorkbenchArtifactRef[]) {
	return refs.reduce<Partial<Record<WorkbenchArtifactKind, number>>>(
		(acc, ref) => {
			acc[ref.kind] = (acc[ref.kind] || 0) + 1;
			return acc;
		},
		{},
	);
}

function readCodexContractSnapshotWarnings(
	latestRun?: TaskRun,
): Record<string, unknown>[] {
	const contract = readRuntimeContractSnapshot(latestRun);
	return readRecordArray(contract?.warnings);
}

function readRuntimeContractSnapshot(
	latestRun?: TaskRun,
): Record<string, unknown> | null {
	const contextSnapshot = readRecord(latestRun?.contextSnapshot);
	return (
		readRecord(contextSnapshot?.runtimeContract) ??
		readRecord(contextSnapshot?.codexContract)
	);
}

function readCodexContractEventWarnings(
	events: TaskEvent[],
): Record<string, unknown>[] {
	return events.flatMap((event) => {
		if (getRunEventType(event) !== "system.warning") return [];
		const payload = isRecord(event.payloadJson) ? event.payloadJson : {};
		const runEvent = readRecord(payload.runEvent);
		const data = readRecord(runEvent?.data) || payload;
		const contractWarning = readRecord(data.contractWarning);
		if (contractWarning) return [contractWarning];
		return readNonEmptyString(data.code) ? [data] : [];
	});
}

export function hasImplementationPlanEvidence(messages: TaskMessage[]) {
	return messages.some((message) => {
		if (message.messageType !== "markdown_document") return false;
		const intent = String(taskMessageMetadata(message).intent);
		return (
			intent === "implementation_plan" ||
			intent === "feature_plan" ||
			intent === "app_blueprint" ||
			intent === "mock_blueprint"
		);
	});
}

export function isReviewNeededSession(
	task: Task,
	evidence: SessionEvidence = {},
) {
	const latestRun = evidence.latestRun;
	const queueStatus = evidence.queueEntry?.status;
	if (!latestRun)
		return (
			task.status === "needs_review" || queueStatus === "execution_completed"
		);
	const runTerminal = ["completed", "needs_review"].includes(latestRun.status);
	const hasFinalReport = Boolean(latestRun.finalReport?.trim());
	const hasEvidence = Boolean(
		latestRun.diffPatch?.trim() ||
			latestRun.testResults ||
			evidence.events?.length ||
			latestRun.finalReport?.trim(),
	);
	const accepted = (evidence.reviews || []).some(
		(review) =>
			review.verdict === "approved" || review.statusAfter === "completed",
	);
	return (
		!accepted &&
		(task.status === "needs_review" ||
			queueStatus === "execution_completed" ||
			(runTerminal && hasFinalReport && hasEvidence))
	);
}

export function hasFailedVerification(event: TaskEvent): boolean {
	const payload: Record<string, unknown> = isRecord(event.payloadJson)
		? event.payloadJson
		: {};
	const runEvent: Record<string, unknown> = isRecord(payload.runEvent)
		? payload.runEvent
		: {};
	const runEventData: Record<string, unknown> = isRecord(runEvent.data)
		? runEvent.data
		: {};
	const data = Object.keys(runEventData).length > 0 ? runEventData : payload;
	return data.passed === false || data.status === "failed";
}
