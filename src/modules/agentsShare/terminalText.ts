const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
const CSI = String.fromCharCode(155);
const ANSI_ESCAPE_SEQUENCE_PATTERN = new RegExp(
	`(?:${ESC}\\[|${CSI})[0-?]*[ -/]*[@-~]|${ESC}[\\]PX^_][^${ESC}${BEL}]*(?:${BEL}|${ESC}\\\\)|${ESC}[@-_]`,
	"g",
);
const ESCAPED_ANSI_CSI_SEQUENCE_PATTERN =
	/\\(?:u001b|x1b)\[[0-?]*[ -/]*[@-~]/gi;

export function sanitizeTerminalText(value: string): string {
	const withoutAnsi = value
		.replace(ANSI_ESCAPE_SEQUENCE_PATTERN, "")
		.replace(ESCAPED_ANSI_CSI_SEQUENCE_PATTERN, "")
		.replace(/\r\n/g, "\n")
		.replace(/\r/g, "\n");

	let sanitized = "";
	for (const char of withoutAnsi) {
		const code = char.charCodeAt(0);
		if (
			(code < 32 && code !== 9 && code !== 10) ||
			(code >= 127 && code <= 159)
		)
			continue;
		sanitized += char;
	}
	return sanitized;
}

export function sanitizeTerminalPreviewValue(
	value: unknown,
	depth = 0,
): unknown {
	if (typeof value === "string") return sanitizeTerminalText(value);
	if (!value || typeof value !== "object" || depth > 8) return value;
	if (Array.isArray(value)) {
		return value.map((item) => sanitizeTerminalPreviewValue(item, depth + 1));
	}

	return Object.fromEntries(
		Object.entries(value as Record<string, unknown>).map(([key, item]) => [
			key,
			sanitizeTerminalPreviewValue(item, depth + 1),
		]),
	);
}
