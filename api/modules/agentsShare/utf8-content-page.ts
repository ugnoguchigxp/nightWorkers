import crypto from "node:crypto";

export function sliceUtf8ContentPage(
	content: string,
	options: { cursor?: number; maxChars?: number; maxBytes?: number } = {},
) {
	const cursor = Number.isFinite(options.cursor)
		? Math.max(0, Math.floor(options.cursor ?? 0))
		: 0;
	const maxChars = Number.isFinite(options.maxChars)
		? Math.max(1, Math.floor(options.maxChars ?? 16_000))
		: 16_000;
	const maxBytes = Number.isFinite(options.maxBytes)
		? Math.max(1, Math.floor(options.maxBytes ?? 16_000))
		: 16_000;
	let start = Math.min(cursor, content.length);
	if (
		start > 0 &&
		start < content.length &&
		content.charCodeAt(start) >= 0xdc00 &&
		content.charCodeAt(start) <= 0xdfff
	) {
		start -= 1;
	}
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

export function contentDigest(value: string) {
	return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}
