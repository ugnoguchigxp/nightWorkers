type TaskEventWithPayload = {
	id: string;
	payloadJson?: unknown;
	seq?: number;
};

export type CompletionCheckResult = {
	eventId: string;
	ok: boolean;
	verificationDocumentIds: string[];
};

function record(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function firstRecord(...values: unknown[]) {
	for (const value of values) {
		const candidate = record(value);
		if (Object.keys(candidate).length > 0) return candidate;
	}
	return {};
}

function parseTextResult(result: Record<string, unknown>) {
	if (!Array.isArray(result.content)) return {};
	for (const item of result.content) {
		const content = record(item);
		if (content.type !== "text" || typeof content.text !== "string") continue;
		try {
			return record(JSON.parse(content.text));
		} catch {}
	}
	return {};
}

function normalizeToolName(value: unknown) {
	if (typeof value !== "string") return null;
	return value.startsWith("nightworkers.")
		? value.slice("nightworkers.".length)
		: value;
}

export function readCompletionCheckResult(
	event: TaskEventWithPayload,
): CompletionCheckResult | null {
	const runEvent = record(record(event.payloadJson).runEvent);
	if (runEvent.type !== "tool.call_finished") return null;

	const data = record(runEvent.data);
	const result = firstRecord(data.result, data.toolResult);
	const parsedTextResult = parseTextResult(result);
	const toolNames = [
		data.mcpTool,
		data.toolName,
		result.toolName,
		parsedTextResult.toolName,
	].map(normalizeToolName);
	if (!toolNames.includes("completion_check")) return null;

	const argumentsPayload = record(data.arguments);
	const directPayload = record(result.payload);
	const directResult = record(directPayload.result);
	const parsedPayload = record(parsedTextResult.payload);
	const parsedResult = record(parsedPayload.result);
	const structuredContent = firstRecord(
		result.structuredContent,
		result.structured_content,
		record(result.result).structuredContent,
		record(result.result).structured_content,
	);
	const structuredPayload = record(structuredContent.payload);
	const structuredResult = record(structuredPayload.result);
	const explicitOkValues = [
		data.ok,
		result.ok,
		parsedTextResult.ok,
		directPayload.ok,
		directResult.ok,
		parsedPayload.ok,
		parsedResult.ok,
		parsedResult.ready,
		structuredPayload.ok,
		structuredResult.ok,
		structuredResult.ready,
	].filter((value): value is boolean => typeof value === "boolean");
	const verificationDocumentIds = [
		argumentsPayload.verificationDocumentId,
		result.verificationDocumentId,
		parsedTextResult.verificationDocumentId,
		directPayload.verificationDocumentId,
		directResult.verificationDocumentId,
		parsedPayload.verificationDocumentId,
		parsedResult.verificationDocumentId,
		structuredPayload.verificationDocumentId,
		structuredResult.verificationDocumentId,
	].filter((value): value is string => typeof value === "string");

	return {
		eventId: event.id,
		ok:
			data.status !== "failed" &&
			explicitOkValues.includes(true) &&
			!explicitOkValues.includes(false),
		verificationDocumentIds: [...new Set(verificationDocumentIds)],
	};
}

export function readLatestCompletionCheckResult(
	events: readonly TaskEventWithPayload[],
): CompletionCheckResult | null {
	const orderedEvents = events
		.map((event, index) => {
			const runEvent = record(record(event.payloadJson).runEvent);
			return {
				event,
				index,
				seq:
					typeof event.seq === "number"
						? event.seq
						: typeof runEvent.seq === "number"
							? runEvent.seq
							: index,
			};
		})
		.sort((left, right) => right.seq - left.seq || right.index - left.index);
	for (const { event } of orderedEvents) {
		const result = readCompletionCheckResult(event);
		if (result) return result;
	}
	return null;
}

export function completionCheckMatchesVerificationDocument(
	result: CompletionCheckResult | null,
	expectedVerificationDocumentId: string,
) {
	return Boolean(
		result &&
			result.verificationDocumentIds.length === 1 &&
			result.verificationDocumentIds[0] === expectedVerificationDocumentId,
	);
}
