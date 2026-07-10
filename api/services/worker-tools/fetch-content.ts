import { unknownErrorMessage } from "../../../shared/json-record";
import { sanitizePlainText } from "../../../shared/sanitize-plain-text";
import type { WorkerToolResult } from "./types";

export interface FetchContentInput {
	url: string;
	maxChars?: number;
}

export interface FetchContentOutput {
	url: string;
	finalUrl: string;
	contentType: string;
	status: number;
	title?: string;
	description?: string;
	text: string;
	truncated: boolean;
}

const DEFAULT_MAX_CHARS = 12_000;
const MAX_CHARS_CAP = 40_000;

function decodeHtmlEntities(value: string): string {
	return value
		.replace(/&amp;/g, "&")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&#(\d+);/g, (_match, code: string) => {
			const numeric = Number.parseInt(code, 10);
			return Number.isFinite(numeric) ? String.fromCodePoint(numeric) : _match;
		})
		.replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => {
			const numeric = Number.parseInt(code, 16);
			return Number.isFinite(numeric) ? String.fromCodePoint(numeric) : _match;
		});
}

function normalizeWhitespace(value: string): string {
	return value
		.replace(/\r/g, "")
		.replace(/[ \t]+\n/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

function extractMetaContent(html: string, name: string): string | undefined {
	const pattern = new RegExp(
		`<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']+)["'][^>]*>`,
		"i",
	);
	const match = html.match(pattern);
	if (!match?.[1]) return undefined;
	const content = sanitizePlainText(decodeHtmlEntities(match[1])).trim();
	return content || undefined;
}

function extractTitle(html: string): string | undefined {
	const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
	if (!match?.[1]) return undefined;
	const title = sanitizePlainText(decodeHtmlEntities(match[1])).trim();
	return title || undefined;
}

function discardRawTextElements(value: string): string {
	return value
		.replace(/<xmp[\s\S]*?<\/xmp>/gi, " ")
		.replace(/<script[\s\S]*?<\/script>/gi, " ")
		.replace(/<style[\s\S]*?<\/style>/gi, " ")
		.replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
}

function htmlToText(html: string): string {
	const withoutNoise = discardRawTextElements(html)
		.replace(/<head[\s\S]*?<\/head>/gi, " ")
		.replace(/<title[\s\S]*?<\/title>/gi, " ")
		.replace(/<meta\b[^>]*>/gi, " ")
		.replace(/<(?:br|hr)\s*\/?>/gi, "\n")
		.replace(
			/<\/(?:p|div|section|article|header|footer|li|h[1-6]|tr|table|blockquote)>/gi,
			"\n",
		)
		.replace(/<li[^>]*>/gi, "\n- ");

	const stripped = sanitizePlainText(withoutNoise);
	return normalizeWhitespace(decodeHtmlEntities(stripped));
}

function isTextualContentType(contentType: string): boolean {
	const normalized = contentType.toLowerCase();
	return (
		normalized.startsWith("text/") ||
		normalized.includes("json") ||
		normalized.includes("xml") ||
		normalized.includes("html") ||
		normalized.includes("markdown")
	);
}

function toReaderMirrorUrl(url: URL): string {
	return `https://r.jina.ai/http://${url.host}${url.pathname}${url.search}${url.hash}`;
}

function isLowSignalText(
	text: string,
	title?: string,
	description?: string,
): boolean {
	if (text.trim().length < 250) return true;
	const alphaCount = (text.match(/[\p{L}\p{N}]/gu) ?? []).length;
	const signalRatio = alphaCount / Math.max(1, text.length);
	return (!title && !description) || signalRatio < 0.2;
}

function extractReaderMirrorContent(raw: string): {
	title?: string;
	text: string;
} {
	const titleMatch = raw.match(/^Title:\s*(.+)$/im);
	const markdownIndex = raw.indexOf("Markdown Content:");
	const body =
		markdownIndex >= 0
			? raw.slice(markdownIndex + "Markdown Content:".length).trim()
			: raw.trim();
	return {
		...(titleMatch?.[1]
			? { title: sanitizePlainText(titleMatch[1]).trim() }
			: {}),
		text: normalizeWhitespace(sanitizePlainText(discardRawTextElements(body))),
	};
}

export function validateFetchContentUrl(rawUrl: string): URL {
	const url = new URL(rawUrl);
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new Error("fetch_content only supports http and https URLs.");
	}
	return url;
}

async function fetchText(url: URL): Promise<Response> {
	return fetch(url, {
		headers: {
			Accept:
				"text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5",
			"User-Agent":
				"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
		},
	});
}

async function fetchReaderMirror(url: URL): Promise<Response> {
	return fetch(toReaderMirrorUrl(url), {
		headers: {
			Accept: "text/plain,text/markdown,text/html;q=0.8,*/*;q=0.5",
			"User-Agent":
				"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
		},
	});
}

export async function fetchContentTool(
	input: FetchContentInput,
): Promise<WorkerToolResult<FetchContentOutput>> {
	const startedAt = new Date().toISOString();
	const maxChars = Math.max(
		500,
		Math.min(input.maxChars ?? DEFAULT_MAX_CHARS, MAX_CHARS_CAP),
	);

	let url: URL;
	try {
		url = validateFetchContentUrl(input.url);
	} catch (err) {
		return {
			ok: false,
			toolName: "fetch_content",
			startedAt,
			finishedAt: new Date().toISOString(),
			payload: {
				url: input.url,
				finalUrl: "",
				contentType: "",
				status: 0,
				text: "",
				truncated: false,
			},
			error: {
				code: "INVALID_TOOL_ARGS",
				message:
					err instanceof Error
						? err.message
						: "fetch_content requires a valid http/https URL.",
			},
		};
	}

	try {
		const response = await fetchText(url);
		const contentType = response.headers.get("content-type") ?? "";
		if (!response.ok) {
			const mirrorResponse = await fetchReaderMirror(url);
			if (mirrorResponse.ok) {
				const mirrorBody = await mirrorResponse.text();
				const mirror = extractReaderMirrorContent(mirrorBody);
				const text = mirror.text.slice(0, maxChars);
				return {
					ok: true,
					toolName: "fetch_content",
					startedAt,
					finishedAt: new Date().toISOString(),
					payload: {
						url: url.href,
						finalUrl: mirrorResponse.url || toReaderMirrorUrl(url),
						contentType:
							mirrorResponse.headers.get("content-type") ??
							"text/markdown; source=r.jina.ai",
						status: mirrorResponse.status,
						...(mirror.title ? { title: mirror.title } : {}),
						text,
						truncated: mirror.text.length > maxChars || text.length >= maxChars,
					},
				};
			}
			return {
				ok: false,
				toolName: "fetch_content",
				startedAt,
				finishedAt: new Date().toISOString(),
				payload: {
					url: url.href,
					finalUrl: response.url || url.href,
					contentType,
					status: response.status,
					text: "",
					truncated: false,
				},
				error: {
					code: "FETCH_CONTENT_FAILED",
					message: `Failed to fetch URL: HTTP ${response.status}`,
				},
			};
		}

		if (!isTextualContentType(contentType)) {
			return {
				ok: false,
				toolName: "fetch_content",
				startedAt,
				finishedAt: new Date().toISOString(),
				payload: {
					url: url.href,
					finalUrl: response.url || url.href,
					contentType,
					status: response.status,
					text: "",
					truncated: false,
				},
				error: {
					code: "UNSUPPORTED_CONTENT_TYPE",
					message: `fetch_content only supports textual content. Received: ${contentType || "unknown"}.`,
				},
			};
		}

		const rawBody = await response.text();
		const truncated = rawBody.length > maxChars;
		const body = truncated ? rawBody.slice(0, maxChars) : rawBody;

		const title = extractTitle(body);
		const description = extractMetaContent(body, "description");
		const extractedText = contentType.toLowerCase().includes("html")
			? htmlToText(body)
			: normalizeWhitespace(decodeHtmlEntities(body));

		if (contentType.toLowerCase().includes("html")) {
			const directText = normalizeWhitespace(
				[
					title ? `Title: ${title}` : undefined,
					description ? `Description: ${description}` : undefined,
					extractedText ? `Content:\n${extractedText}` : undefined,
				]
					.filter((value): value is string => Boolean(value))
					.join("\n\n"),
			).slice(0, maxChars);

			if (isLowSignalText(extractedText, title, description)) {
				const mirrorResponse = await fetchReaderMirror(url);
				if (mirrorResponse.ok) {
					const mirrorBody = await mirrorResponse.text();
					const mirror = extractReaderMirrorContent(mirrorBody);
					const text = mirror.text.slice(0, maxChars);
					return {
						ok: true,
						toolName: "fetch_content",
						startedAt,
						finishedAt: new Date().toISOString(),
						payload: {
							url: url.href,
							finalUrl: mirrorResponse.url || toReaderMirrorUrl(url),
							contentType:
								mirrorResponse.headers.get("content-type") ??
								"text/markdown; source=r.jina.ai",
							status: mirrorResponse.status,
							...(mirror.title
								? { title: mirror.title }
								: title
									? { title }
									: {}),
							...(description ? { description } : {}),
							text,
							truncated:
								mirror.text.length > maxChars || text.length >= maxChars,
						},
					};
				}
			}

			return {
				ok: true,
				toolName: "fetch_content",
				startedAt,
				finishedAt: new Date().toISOString(),
				payload: {
					url: url.href,
					finalUrl: response.url || url.href,
					contentType,
					status: response.status,
					...(title ? { title } : {}),
					...(description ? { description } : {}),
					text: directText,
					truncated: truncated || directText.length >= maxChars,
				},
			};
		}

		const text = normalizeWhitespace(
			[
				title ? `Title: ${title}` : undefined,
				description ? `Description: ${description}` : undefined,
				extractedText ? `Content:\n${extractedText}` : undefined,
			]
				.filter((value): value is string => Boolean(value))
				.join("\n\n"),
		).slice(0, maxChars);

		return {
			ok: true,
			toolName: "fetch_content",
			startedAt,
			finishedAt: new Date().toISOString(),
			payload: {
				url: url.href,
				finalUrl: response.url || url.href,
				contentType,
				status: response.status,
				...(title ? { title } : {}),
				...(description ? { description } : {}),
				text,
				truncated: truncated || text.length >= maxChars,
			},
		};
	} catch (err) {
		return {
			ok: false,
			toolName: "fetch_content",
			startedAt,
			finishedAt: new Date().toISOString(),
			payload: {
				url: url.href,
				finalUrl: "",
				contentType: "",
				status: 0,
				text: "",
				truncated: false,
			},
			error: {
				code: "FETCH_CONTENT_FAILED",
				message: `Failed to fetch URL: ${unknownErrorMessage(err)}`,
			},
		};
	}
}
