import crypto from "node:crypto";

export function sliceUtf8ContentPage(
	content: string,
	options: { cursor?: number; maxChars?: number; maxBytes?: number } = {},
) {
	const cursor = normalizedCursor(content, options.cursor);
	const maxChars = Number.isFinite(options.maxChars)
		? Math.max(1, Math.floor(options.maxChars ?? 16_000))
		: 16_000;
	const maxBytes = Number.isFinite(options.maxBytes)
		? Math.max(1, Math.floor(options.maxBytes ?? 16_000))
		: 16_000;
	const start = cursor;
	let end = start;
	let bytes = 0;
	let chars = 0;
	while (end < content.length && chars < maxChars) {
		const codePoint = content.codePointAt(end);
		if (codePoint === undefined) break;
		const character = String.fromCodePoint(codePoint);
		const nextBytes = Buffer.byteLength(character, "utf8");
		if (bytes + nextBytes > maxBytes && end > start) break;
		bytes += nextBytes;
		end += character.length;
		chars += 1;
	}
	const pageContent = content.slice(start, end);
	return {
		content: pageContent,
		page: {
			cursor: start,
			nextCursor: end < content.length ? end : null,
			bytes: Buffer.byteLength(pageContent, "utf8"),
			truncated: end < content.length,
		},
	};
}

export function sliceUtf8ContentPageToJsonBudget(
	content: string,
	options: {
		cursor?: number;
		maxChars?: number;
		maxSerializedBytes: number;
		buildSerializedValue: (pageContent: string, truncated: boolean) => unknown;
	},
) {
	const start = normalizedCursor(content, options.cursor);
	const maxChars = Number.isFinite(options.maxChars)
		? Math.max(1, Math.floor(options.maxChars ?? content.length))
		: content.length;
	const maxSerializedBytes = Math.max(
		1,
		Math.floor(options.maxSerializedBytes),
	);
	const endPositions = [start];
	let end = start;
	while (end < content.length) {
		const codePoint = content.codePointAt(end);
		if (codePoint === undefined) break;
		const nextEnd = end + String.fromCodePoint(codePoint).length;
		if (nextEnd - start > maxChars) break;
		end = nextEnd;
		endPositions.push(end);
	}

	const serializedBytesAt = (positionIndex: number) => {
		const candidateEnd = endPositions[positionIndex] ?? start;
		const value = options.buildSerializedValue(
			content.slice(start, candidateEnd),
			candidateEnd < content.length,
		);
		return Buffer.byteLength(JSON.stringify(value), "utf8");
	};
	if (serializedBytesAt(0) > maxSerializedBytes) {
		throw new RangeError(
			"Serialized page metadata exceeds the configured content budget.",
		);
	}

	let low = 0;
	let high = endPositions.length - 1;
	let best = 0;
	while (low <= high) {
		const middle = Math.floor((low + high) / 2);
		if (serializedBytesAt(middle) <= maxSerializedBytes) {
			best = middle;
			low = middle + 1;
		} else {
			high = middle - 1;
		}
	}
	if (start < content.length && best === 0) {
		throw new RangeError(
			"Serialized page budget cannot fit one content character.",
		);
	}

	const selectedEnd = endPositions[best] ?? start;
	const pageContent = content.slice(start, selectedEnd);
	return {
		content: pageContent,
		page: {
			cursor: start,
			nextCursor: selectedEnd < content.length ? selectedEnd : null,
			bytes: Buffer.byteLength(pageContent, "utf8"),
			serializedBytes: serializedBytesAt(best),
			truncated: selectedEnd < content.length,
		},
	};
}

export function contentDigest(value: string) {
	return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function normalizedCursor(content: string, requestedCursor?: number) {
	const cursor = Number.isFinite(requestedCursor)
		? Math.max(0, Math.floor(requestedCursor ?? 0))
		: 0;
	let start = Math.min(cursor, content.length);
	if (
		start > 0 &&
		start < content.length &&
		content.charCodeAt(start) >= 0xdc00 &&
		content.charCodeAt(start) <= 0xdfff
	) {
		start -= 1;
	}
	return start;
}
