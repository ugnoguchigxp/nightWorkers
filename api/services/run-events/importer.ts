import crypto from "node:crypto";
import * as repo from "../../modules/nightworkers/nightworkers.repository";
import { parseRunJsonl } from "./jsonl-parse";
import { replayRunJsonl } from "./replay";
import type {
	JsonlDiagnostic,
	JsonlImportMode,
	JsonlImportResult,
	ParsedRunJsonl,
	RunEventBase,
	RunEventJsonlLine,
} from "./types";

function hasBlockingDiagnostics(diagnostics: JsonlDiagnostic[]) {
	return diagnostics.some((diagnostic) => diagnostic.level === "error");
}

export function buildRunJsonlImportSourceKey(
	sourceRunId: string,
	line: RunEventJsonlLine,
): string {
	const raw = [
		sourceRunId,
		line.type,
		line.seq,
		line.event.id ?? "",
		line.event.type,
	].join(":");
	return crypto.createHash("sha256").update(raw).digest("hex");
}

function buildImportResult(
	mode: JsonlImportMode,
	parsed: ParsedRunJsonl,
	insertedEventCount = 0,
	skippedDuplicateCount = 0,
	targetRunId?: string,
): JsonlImportResult {
	const replay = replayRunJsonl(parsed);
	return {
		mode,
		sourceRunId: parsed.header?.runId ?? replay.sourceRunId,
		targetRunId,
		parsedEventCount: parsed.events.length,
		insertedEventCount,
		skippedDuplicateCount,
		replay,
		diagnostics: parsed.diagnostics,
	};
}

export function prepareRunJsonlImport(input: {
	text: string;
	mode?: Extract<JsonlImportMode, "validate_only" | "replay_only">;
}): JsonlImportResult {
	const mode = input.mode ?? "validate_only";
	const parsed = parseRunJsonl(input.text);
	return buildImportResult(mode, parsed);
}

function importedRunEvent(
	line: RunEventJsonlLine,
	target: { runId: string; taskId: string },
): RunEventBase {
	return {
		...line.event,
		id: undefined,
		runId: target.runId,
		taskId: target.taskId,
		seq: undefined,
		data: line.event.data ? { ...line.event.data } : undefined,
	};
}

export async function importRunJsonlToRun(
	targetRunId: string,
	text: string,
): Promise<JsonlImportResult> {
	const parsed = parseRunJsonl(text);
	if (hasBlockingDiagnostics(parsed.diagnostics) || !parsed.header) {
		return buildImportResult("import_snapshot", parsed, 0, 0, targetRunId);
	}

	const targetRun = await repo.getTaskRun(targetRunId);
	if (!targetRun) {
		parsed.diagnostics.push({
			level: "error",
			line: 1,
			code: "invalid_schema",
			message: `Target run ${targetRunId} does not exist`,
		});
		return buildImportResult("import_snapshot", parsed, 0, 0, targetRunId);
	}

	const existingEvents = await repo.listTaskEventsForRun(targetRunId);
	const existingSourceKeys = new Set(
		existingEvents
			.map((event) => {
				const payload = event.payloadJson as {
					importMeta?: { sourceKey?: string };
				} | null;
				return payload?.importMeta?.sourceKey;
			})
			.filter((sourceKey): sourceKey is string => Boolean(sourceKey)),
	);

	let insertedEventCount = 0;
	let skippedDuplicateCount = 0;
	for (const line of parsed.events) {
		const sourceKey = buildRunJsonlImportSourceKey(parsed.header.runId, line);
		if (existingSourceKeys.has(sourceKey)) {
			skippedDuplicateCount += 1;
			continue;
		}

		await repo.createRunEvent(
			importedRunEvent(line, { runId: targetRun.id, taskId: targetRun.taskId }),
			{
				payloadJson: {
					...(line.reviewResult === undefined
						? {}
						: { reviewResult: line.reviewResult }),
					importMeta: {
						sourceKey,
						sourceRunId: parsed.header.runId,
						sourceTaskId: parsed.header.taskId,
						sourceSeq: line.seq,
						sourceEventId: line.event.id ?? null,
						sourceEventType: line.event.type,
						importedAt: new Date().toISOString(),
					},
				},
			},
		);
		existingSourceKeys.add(sourceKey);
		insertedEventCount += 1;
	}

	return buildImportResult(
		"import_snapshot",
		parsed,
		insertedEventCount,
		skippedDuplicateCount,
		targetRunId,
	);
}
