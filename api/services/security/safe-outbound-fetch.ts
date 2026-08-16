import { lookup as lookupDns } from "node:dns/promises";
import http, { type IncomingMessage } from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import type { Readable } from "node:stream";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_REDIRECTS = 5;
const DEFAULT_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

export type SafeOutboundFetchErrorCode =
	| "OUTBOUND_ABORTED"
	| "OUTBOUND_ADDRESS_DENIED"
	| "OUTBOUND_DNS_DENIED"
	| "OUTBOUND_DNS_FAILED"
	| "OUTBOUND_REDIRECT_INVALID"
	| "OUTBOUND_REDIRECT_LIMIT"
	| "OUTBOUND_REDIRECT_LOOP"
	| "OUTBOUND_RESPONSE_TOO_LARGE"
	| "OUTBOUND_TIMEOUT"
	| "OUTBOUND_TRANSPORT_FAILED"
	| "OUTBOUND_URL_INVALID";

export class SafeOutboundFetchError extends Error {
	constructor(
		public readonly code: SafeOutboundFetchErrorCode,
		message: string,
		options?: { cause?: unknown },
	) {
		super(message, options);
		this.name = "SafeOutboundFetchError";
	}
}

export type SafeOutboundFetchInput = {
	url: URL | string;
	headers?: Record<string, string>;
	signal?: AbortSignal;
	timeoutMs?: number;
	maxRedirects?: number;
	maxResponseBytes?: number;
};

export type SafeOutboundFetchResult = {
	response: Response;
	finalUrl: string;
};

export type SafeOutboundResolvedAddress = { address: string; family: 4 | 6 };

export type SafeOutboundPinnedRequest = {
	url: URL;
	address: SafeOutboundResolvedAddress;
	headers?: Record<string, string>;
	signal?: AbortSignal;
	timeoutMs: number;
};

export type SafeOutboundPinnedResponse = {
	response: IncomingMessage;
	dispose: () => void;
};

/** Test seam for resolver/transport boundary tests. Production callers use both defaults. */
export type SafeOutboundFetchDependencies = {
	resolveAddresses?: (
		hostname: string,
	) => Promise<SafeOutboundResolvedAddress[]>;
	requestPinnedUrl?: (
		input: SafeOutboundPinnedRequest,
	) => Promise<SafeOutboundPinnedResponse>;
};

function error(
	code: SafeOutboundFetchErrorCode,
	message: string,
	options?: { cause?: unknown },
): SafeOutboundFetchError {
	return new SafeOutboundFetchError(code, message, options);
}

function normalizeUrl(input: URL | string): URL {
	let url: URL;
	try {
		url = input instanceof URL ? new URL(input.href) : new URL(input);
	} catch (cause) {
		throw error("OUTBOUND_URL_INVALID", "Outbound URL is invalid.", { cause });
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw error("OUTBOUND_URL_INVALID", "Outbound URL must use HTTP or HTTPS.");
	}
	if (url.username || url.password) {
		throw error(
			"OUTBOUND_URL_INVALID",
			"Outbound URL credentials are not allowed.",
		);
	}
	if (!url.hostname) {
		throw error("OUTBOUND_URL_INVALID", "Outbound URL host is required.");
	}
	return url;
}

function ipv4Octets(address: string): number[] | null {
	const parts = address.split(".");
	if (parts.length !== 4) return null;
	const values = parts.map((part) => Number.parseInt(part, 10));
	return values.every(
		(value) => Number.isInteger(value) && value >= 0 && value <= 255,
	)
		? values
		: null;
}

function isPublicIpv4(address: string): boolean {
	const parts = ipv4Octets(address);
	if (!parts) return false;
	const [first, second, third] = parts;
	if (
		first === 0 ||
		first === 10 ||
		first === 127 ||
		first >= 224 ||
		(first === 100 && second >= 64 && second <= 127) ||
		(first === 169 && second === 254) ||
		(first === 172 && second >= 16 && second <= 31) ||
		(first === 192 && second === 0 && (third === 0 || third === 2)) ||
		(first === 192 && second === 88 && third === 99) ||
		(first === 192 && second === 168) ||
		(first === 198 && (second === 18 || second === 19)) ||
		(first === 198 && second === 51 && third === 100) ||
		(first === 203 && second === 0 && third === 113)
	) {
		return false;
	}
	return true;
}

function expandIpv6(address: string): string[] | null {
	const lower = address.toLowerCase();
	const embeddedIpv4 = lower.lastIndexOf(":") >= 0 && lower.includes(".");
	let normalized = lower;
	if (embeddedIpv4) {
		const separator = lower.lastIndexOf(":");
		const ipv4 = ipv4Octets(lower.slice(separator + 1));
		if (!ipv4) return null;
		normalized = `${lower.slice(0, separator)}:${((ipv4[0] << 8) | ipv4[1]).toString(16)}:${((ipv4[2] << 8) | ipv4[3]).toString(16)}`;
	}
	const sections = normalized.split("::");
	if (sections.length > 2) return null;
	const head = sections[0] ? sections[0].split(":") : [];
	const tail =
		sections.length === 2 && sections[1] ? sections[1].split(":") : [];
	const missing = 8 - head.length - tail.length;
	if (missing < 0 || (sections.length === 1 && missing !== 0)) return null;
	const groups = [...head, ...Array(missing).fill("0"), ...tail];
	return groups.length === 8 &&
		groups.every((group) => /^[0-9a-f]{1,4}$/i.test(group))
		? groups
		: null;
}

function ipv6Value(address: string): bigint | null {
	const groups = expandIpv6(address);
	if (!groups) return null;
	return groups.reduce(
		(value, group) => (value << 16n) | BigInt(`0x${group}`),
		0n,
	);
}

function isIpv6InRange(
	address: bigint,
	base: bigint,
	prefixLength: number,
): boolean {
	const width = 128n;
	const prefix = BigInt(prefixLength);
	const mask = ((1n << prefix) - 1n) << (width - prefix);
	return (address & mask) === (base & mask);
}

function isPublicIpv6(address: string): boolean {
	const value = ipv6Value(address);
	if (value === null) return false;
	const ipv4MappedBase = 0xffffn << 32n;
	if (isIpv6InRange(value, ipv4MappedBase, 96)) {
		const mapped = Number(value & 0xffff_ffffn);
		return isPublicIpv4(
			`${(mapped >>> 24) & 255}.${(mapped >>> 16) & 255}.${(mapped >>> 8) & 255}.${mapped & 255}`,
		);
	}
	return !(
		value === 0n ||
		value === 1n ||
		isIpv6InRange(value, 0n, 96) ||
		isIpv6InRange(value, 0xfc00n << 112n, 7) ||
		isIpv6InRange(value, 0xfe80n << 112n, 10) ||
		isIpv6InRange(value, 0xff00n << 112n, 8) ||
		isIpv6InRange(value, 0x20010db8n << 96n, 32)
	);
}

export function isPublicOutboundAddress(address: string): boolean {
	const family = isIP(address);
	if (family === 4) return isPublicIpv4(address);
	if (family === 6) return isPublicIpv6(address);
	return false;
}

function assertPublicHostname(hostname: string) {
	const normalized = hostname.toLowerCase();
	if (normalized === "localhost" || normalized.endsWith(".localhost")) {
		throw error(
			"OUTBOUND_ADDRESS_DENIED",
			"Outbound localhost URLs are not allowed.",
		);
	}
}

function canonicalHostname(hostname: string): string {
	return hostname.replace(/^\[|\]$/g, "");
}

async function resolvePublicAddresses(
	hostname: string,
	resolveAddresses?: SafeOutboundFetchDependencies["resolveAddresses"],
): Promise<SafeOutboundResolvedAddress[]> {
	const canonical = canonicalHostname(hostname);
	const literalFamily = isIP(canonical);
	if (literalFamily) {
		if (!isPublicOutboundAddress(canonical)) {
			throw error("OUTBOUND_ADDRESS_DENIED", "Outbound address is not public.");
		}
		return [{ address: canonical, family: literalFamily as 4 | 6 }];
	}
	assertPublicHostname(canonical);
	let records: SafeOutboundResolvedAddress[];
	try {
		if (resolveAddresses) {
			records = await resolveAddresses(canonical);
		} else {
			records = (await lookupDns(canonical, { all: true, verbatim: true })).map(
				({ address, family }) => ({
					address,
					family: family === 6 ? 6 : 4,
				}),
			);
		}
	} catch (cause) {
		throw error("OUTBOUND_DNS_FAILED", "Outbound host resolution failed.", {
			cause,
		});
	}
	if (
		!records.length ||
		records.some((record) => !isPublicOutboundAddress(record.address))
	) {
		throw error(
			"OUTBOUND_DNS_DENIED",
			"Outbound host did not resolve exclusively to public addresses.",
		);
	}
	return records;
}

function isRedirectStatus(status: number): boolean {
	return (
		status === 301 ||
		status === 302 ||
		status === 303 ||
		status === 307 ||
		status === 308
	);
}

function responseHeader(
	message: IncomingMessage,
	name: string,
): string | undefined {
	const value = message.headers[name.toLowerCase()];
	return Array.isArray(value) ? value[0] : value;
}

function decodedStream(message: IncomingMessage): Readable {
	const encoding = responseHeader(message, "content-encoding")
		?.toLowerCase()
		.trim();
	if (encoding === "gzip" || encoding === "x-gzip")
		return message.pipe(createGunzip());
	if (encoding === "deflate") return message.pipe(createInflate());
	if (encoding === "br") return message.pipe(createBrotliDecompress());
	return message;
}

async function readResponseBody(
	message: IncomingMessage,
	maxResponseBytes: number,
): Promise<Uint8Array> {
	const contentLength = Number.parseInt(
		responseHeader(message, "content-length") ?? "",
		10,
	);
	if (Number.isFinite(contentLength) && contentLength > maxResponseBytes) {
		message.resume();
		throw error(
			"OUTBOUND_RESPONSE_TOO_LARGE",
			"Outbound response exceeds the configured size limit.",
		);
	}

	const body = decodedStream(message);
	const chunks: Uint8Array[] = [];
	let totalBytes = 0;
	try {
		for await (const value of body) {
			const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
			totalBytes += chunk.byteLength;
			if (totalBytes > maxResponseBytes) {
				body.destroy();
				throw error(
					"OUTBOUND_RESPONSE_TOO_LARGE",
					"Outbound response exceeds the configured size limit.",
				);
			}
			chunks.push(chunk);
		}
	} catch (cause) {
		if (cause instanceof SafeOutboundFetchError) throw cause;
		throw error(
			"OUTBOUND_TRANSPORT_FAILED",
			"Outbound response could not be read.",
			{
				cause,
			},
		);
	}
	return Buffer.concat(chunks, totalBytes);
}

async function requestPinnedUrl(
	input: SafeOutboundPinnedRequest,
): Promise<SafeOutboundPinnedResponse> {
	const requestFunction =
		input.url.protocol === "https:" ? https.request : http.request;
	return new Promise<SafeOutboundPinnedResponse>((resolve, reject) => {
		let settled = false;
		let response: IncomingMessage | undefined;
		let disposed = false;
		const dispose = () => {
			if (disposed) return;
			disposed = true;
			clearTimeout(timeout);
			input.signal?.removeEventListener("abort", abort);
		};
		const abort = () => {
			const abortError = error(
				"OUTBOUND_ABORTED",
				"Outbound request was aborted.",
			);
			response?.destroy(abortError);
			request.destroy(abortError);
		};
		const request = requestFunction(
			input.url,
			{
				agent: false,
				family: input.address.family,
				headers: input.headers,
				lookup: (_hostname, _options, callback) =>
					callback(null, input.address.address, input.address.family),
				servername: input.url.hostname,
			},
			(message) => {
				if (settled) {
					message.resume();
					return;
				}
				settled = true;
				response = message;
				resolve({ response: message, dispose });
			},
		);
		const timeout = setTimeout(() => {
			const timeoutError = error(
				"OUTBOUND_TIMEOUT",
				"Outbound request timed out.",
			);
			response?.destroy(timeoutError);
			request.destroy(timeoutError);
		}, input.timeoutMs);
		request.once("error", (cause) => {
			if (settled) return;
			settled = true;
			dispose();
			if (cause instanceof SafeOutboundFetchError) {
				reject(cause);
				return;
			}
			reject(
				error("OUTBOUND_TRANSPORT_FAILED", "Outbound request failed.", {
					cause,
				}),
			);
		});
		if (input.signal?.aborted) {
			abort();
			return;
		}
		input.signal?.addEventListener("abort", abort, { once: true });
		request.end();
	});
}

function responseHeaders(message: IncomingMessage): Headers {
	const headers = new Headers();
	for (const [name, value] of Object.entries(message.headers)) {
		if (
			value === undefined ||
			name === "content-encoding" ||
			name === "content-length"
		)
			continue;
		headers.set(name, Array.isArray(value) ? value.join(", ") : value);
	}
	return headers;
}

export async function safeOutboundFetch(
	input: SafeOutboundFetchInput,
	dependencies: SafeOutboundFetchDependencies = {},
): Promise<SafeOutboundFetchResult> {
	if (input.signal?.aborted) {
		throw error("OUTBOUND_ABORTED", "Outbound request was aborted.");
	}
	const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const maxRedirects = input.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
	const maxResponseBytes = input.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
	if (timeoutMs <= 0 || maxRedirects < 0 || maxResponseBytes <= 0) {
		throw error(
			"OUTBOUND_URL_INVALID",
			"Outbound fetch limits must be positive.",
		);
	}

	let currentUrl = normalizeUrl(input.url);
	const seenUrls = new Set<string>();
	for (let redirectCount = 0; ; redirectCount += 1) {
		if (seenUrls.has(currentUrl.href)) {
			throw error("OUTBOUND_REDIRECT_LOOP", "Outbound redirect loop detected.");
		}
		seenUrls.add(currentUrl.href);
		const addresses = await resolvePublicAddresses(
			currentUrl.hostname,
			dependencies.resolveAddresses,
		);
		const pending = await (dependencies.requestPinnedUrl ?? requestPinnedUrl)({
			url: currentUrl,
			address: addresses[0],
			headers: input.headers,
			signal: input.signal,
			timeoutMs,
		});

		const response = pending.response;
		if (isRedirectStatus(response.statusCode ?? 0)) {
			const location = responseHeader(response, "location");
			response.resume();
			pending.dispose();
			if (!location) {
				throw error(
					"OUTBOUND_REDIRECT_INVALID",
					"Outbound redirect did not provide a location.",
				);
			}
			if (redirectCount >= maxRedirects) {
				throw error(
					"OUTBOUND_REDIRECT_LIMIT",
					"Outbound redirect limit exceeded.",
				);
			}
			try {
				currentUrl = normalizeUrl(new URL(location, currentUrl));
			} catch (cause) {
				if (cause instanceof SafeOutboundFetchError) throw cause;
				throw error(
					"OUTBOUND_REDIRECT_INVALID",
					"Outbound redirect URL is invalid.",
					{
						cause,
					},
				);
			}
			continue;
		}

		let body: Uint8Array;
		try {
			body = await readResponseBody(response, maxResponseBytes);
		} finally {
			pending.dispose();
		}
		return {
			response: new Response(new Blob([new Uint8Array(body)]), {
				status: response.statusCode ?? 0,
				headers: responseHeaders(response),
			}),
			finalUrl: currentUrl.href,
		};
	}
}
