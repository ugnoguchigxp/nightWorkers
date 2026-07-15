export function sliceMissionPilotUtf8Page(
	content: string,
	options: { cursor?: number; maxChars?: number; maxBytes?: number } = {},
) {
	let cursor = Math.min(
		content.length,
		normalizeNonNegativeInteger(options.cursor, 0),
	);
	if (cursor > 0 && isLowSurrogate(content.charCodeAt(cursor))) cursor--;
	const maxChars = normalizePositiveInteger(options.maxChars, 16_000);
	// A Unicode scalar value occupies at most four bytes in UTF-8. Keeping this
	// floor guarantees that a non-empty remainder can always make progress.
	const maxBytes = Math.max(
		4,
		normalizePositiveInteger(options.maxBytes, 16_000),
	);
	let low = cursor;
	let high = Math.min(content.length, cursor + maxChars);
	if (high < content.length && isLowSurrogate(content.charCodeAt(high))) high++;
	while (low < high) {
		const candidate = Math.ceil((low + high) / 2);
		if (Buffer.byteLength(content.slice(cursor, candidate), "utf8") <= maxBytes)
			low = candidate;
		else high = candidate - 1;
	}
	let end = low;
	if (end < content.length && isLowSurrogate(content.charCodeAt(end))) end--;
	if (end === cursor && cursor < content.length) {
		end =
			isHighSurrogate(content.charCodeAt(cursor)) &&
			isLowSurrogate(content.charCodeAt(cursor + 1))
				? cursor + 2
				: cursor + 1;
	}
	const page = content.slice(cursor, end);
	return {
		content: page,
		page: {
			cursor,
			chars: page.length,
			bytes: Buffer.byteLength(page, "utf8"),
			totalChars: content.length,
			totalBytes: Buffer.byteLength(content, "utf8"),
			nextCursor: end < content.length ? end : null,
			truncated: end < content.length,
		},
	};
}

function normalizeNonNegativeInteger(
	value: number | undefined,
	fallback: number,
) {
	return Number.isFinite(value)
		? Math.max(0, Math.floor(value as number))
		: fallback;
}

function normalizePositiveInteger(value: number | undefined, fallback: number) {
	return Number.isFinite(value)
		? Math.max(1, Math.floor(value as number))
		: fallback;
}

function isHighSurrogate(code: number) {
	return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number) {
	return code >= 0xdc00 && code <= 0xdfff;
}
