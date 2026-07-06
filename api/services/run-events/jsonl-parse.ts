import { runEventJsonlLineSchema } from "../../../shared/schemas/nightworkers.schema";
import type {
	JsonlDiagnostic,
	ParsedRunJsonl,
	RunEventJsonlHeader,
	RunEventJsonlLine,
	RunSummaryJsonlLine,
} from "./types";

type ParsedLine = RunEventJsonlHeader | RunEventJsonlLine | RunSummaryJsonlLine;

function diagnostic(
	level: JsonlDiagnostic["level"],
	line: number,
	code: JsonlDiagnostic["code"],
	message: string,
): JsonlDiagnostic {
	return { level, line, code, message };
}

export function validateRunJsonlLine(
	value: unknown,
	lineNumber: number,
): { line?: ParsedLine; diagnostic?: JsonlDiagnostic } {
	const parsed = runEventJsonlLineSchema.safeParse(value);
	if (!parsed.success) {
		const unsupportedVersion =
			typeof value === "object" &&
			value !== null &&
			"version" in value &&
			(value as { version?: unknown }).version !== 1;
		return {
			diagnostic: diagnostic(
				"error",
				lineNumber,
				unsupportedVersion ? "unsupported_version" : "invalid_schema",
				parsed.error.issues.map((issue) => issue.message).join("; "),
			),
		};
	}
	return { line: parsed.data as ParsedLine };
}

export function parseRunJsonl(text: string): ParsedRunJsonl {
	return parseRunJsonlLines(text.split(/\r?\n/));
}

export function parseRunJsonlLines(lines: string[]): ParsedRunJsonl {
	const result: ParsedRunJsonl = {
		events: [],
		diagnostics: [],
	};
	const seenSeq = new Set<number>();
	let previousSeq: number | undefined;

	lines.forEach((rawLine, index) => {
		const lineNumber = index + 1;
		const trimmed = rawLine.trim();
		if (!trimmed) return;

		let value: unknown;
		try {
			value = JSON.parse(trimmed);
		} catch (error) {
			result.diagnostics.push(
				diagnostic(
					"error",
					lineNumber,
					"invalid_json",
					error instanceof Error ? error.message : "Invalid JSON line",
				),
			);
			return;
		}

		const validated = validateRunJsonlLine(value, lineNumber);
		if (!validated.line) {
			result.diagnostics.push(
				validated.diagnostic ??
					diagnostic(
						"error",
						lineNumber,
						"invalid_schema",
						"Line did not match JSONL schema",
					),
			);
			return;
		}

		if (validated.line.type === "nightworkers_run") {
			if (lineNumber !== 1) {
				result.diagnostics.push(
					diagnostic(
						"error",
						lineNumber,
						"missing_header",
						"Header must be the first JSONL line",
					),
				);
			}
			if (result.header) {
				result.diagnostics.push(
					diagnostic(
						"error",
						lineNumber,
						"duplicate_header",
						"Duplicate run header",
					),
				);
				return;
			}
			result.header = validated.line;
			if (validated.line.version !== 1) {
				result.diagnostics.push(
					diagnostic(
						"error",
						lineNumber,
						"unsupported_version",
						"Only JSONL version 1 is supported",
					),
				);
			}
			return;
		}

		if (!result.header) {
			result.diagnostics.push(
				diagnostic(
					"error",
					lineNumber,
					"event_before_header",
					"Event appeared before run header",
				),
			);
		}

		if (validated.line.type === "run_summary") {
			if (result.summary) {
				result.diagnostics.push(
					diagnostic(
						"error",
						lineNumber,
						"duplicate_summary",
						"Duplicate run summary",
					),
				);
				return;
			}
			if (result.header && validated.line.runId !== result.header.runId) {
				result.diagnostics.push(
					diagnostic(
						"error",
						lineNumber,
						"run_id_mismatch",
						"Summary runId differs from header",
					),
				);
			}
			result.summary = validated.line;
			return;
		}

		if (validated.line.type === "run_event") {
			if (result.header) {
				if (
					validated.line.runId !== result.header.runId ||
					validated.line.event.runId !== result.header.runId
				) {
					result.diagnostics.push(
						diagnostic(
							"error",
							lineNumber,
							"run_id_mismatch",
							"Event runId differs from header",
						),
					);
				}
			}
			if (seenSeq.has(validated.line.seq)) {
				result.diagnostics.push(
					diagnostic(
						"error",
						lineNumber,
						"duplicate_seq",
						`Duplicate event seq ${validated.line.seq}`,
					),
				);
			}
			if (
				typeof validated.line.event.seq === "number" &&
				validated.line.event.seq !== validated.line.seq
			) {
				result.diagnostics.push(
					diagnostic(
						"error",
						lineNumber,
						"invalid_schema",
						`Event seq ${validated.line.event.seq} differs from line seq ${validated.line.seq}`,
					),
				);
			}
			if (previousSeq !== undefined && validated.line.seq < previousSeq) {
				result.diagnostics.push(
					diagnostic(
						"warning",
						lineNumber,
						"seq_out_of_order",
						`Event seq ${validated.line.seq} appeared after ${previousSeq}`,
					),
				);
			}
			seenSeq.add(validated.line.seq);
			previousSeq = validated.line.seq;
			result.events.push(validated.line);
		}
	});

	if (!result.header) {
		result.diagnostics.push(
			diagnostic(
				"error",
				1,
				"missing_header",
				"Missing nightworkers_run header",
			),
		);
	}

	result.events.sort((a, b) => a.seq - b.seq);
	return result;
}
