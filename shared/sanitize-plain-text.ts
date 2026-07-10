import sanitizeHtml from "sanitize-html";

/**
 * Converts untrusted HTML-shaped input into text that is safe to persist and
 * pass through React, Markdown, and logs without retaining executable markup.
 */
export function sanitizePlainText(input: string): string {
	if (!input) return input;

	return sanitizeHtml(input, {
		allowedTags: [],
		allowedAttributes: {},
		disallowedTagsMode: "discard",
	});
}
