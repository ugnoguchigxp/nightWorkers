import { randomUUID } from "node:crypto";
import { MUSE_RUNTIME_ID } from "./muse-provider-config";
import {
	MAX_PROVIDER_RESPONSE_BYTES,
	providerHttpError,
	providerInvalidResponseError,
	providerResponseTooLargeError,
	readBoundedProviderResponseText,
} from "./provider-failure";

export {
	MUSE_DEFAULT_BASE_URL,
	MUSE_DEFAULT_MODEL,
	MUSE_RUNTIME_ID,
} from "./muse-provider-config";

export type MuseAgentModel = {
	id: string;
	runtime: string;
	displayName: string;
	contextLimit: number | null;
	outputLimit: number | null;
};

export type MuseAgentSession = {
	id: string;
	runtime: string;
	model: string;
	status: string;
	eventsUrl: string;
	cursor: string;
};

export type MuseAgentTurn = {
	id: string;
	sessionId: string;
	status: string;
};

export type MuseAgentEvent = {
	type: string;
	sessionId: string;
	turnId: string | null;
	cursor: string | null;
	data: Record<string, unknown>;
};

type MuseClientInput = {
	baseUrl: string;
	apiKey?: string;
	signal: AbortSignal;
	fetchImpl?: typeof fetch;
};

export function buildMuseAgentModelsUrl(baseUrl: string) {
	const url = buildMuseAgentUrl(baseUrl, "/v1/agents/models");
	url.searchParams.set("runtime", MUSE_RUNTIME_ID);
	return url.toString();
}

export function buildMuseAgentSessionsUrl(baseUrl: string) {
	return buildMuseAgentUrl(baseUrl, "/v1/agents/sessions").toString();
}

export function buildMuseAgentSessionUrl(
	baseUrl: string,
	sessionId: string,
	suffix = "",
) {
	return buildMuseAgentUrl(
		baseUrl,
		`/v1/agents/sessions/${encodeURIComponent(sessionId)}${suffix}`,
	).toString();
}

export async function listMuseAgentModels(input: MuseClientInput) {
	const response = await requestMuseJson({
		...input,
		url: buildMuseAgentModelsUrl(input.baseUrl),
		method: "GET",
	});
	const data = Array.isArray(response.value.data) ? response.value.data : null;
	if (!data) throw invalidMuseResponse(response.body);
	return data.map((value) => parseMuseAgentModel(value, response.body));
}

export async function createMuseAgentSession(
	input: MuseClientInput & { model: string; idempotencyKey?: string },
) {
	const response = await requestMuseJson({
		...input,
		url: buildMuseAgentSessionsUrl(input.baseUrl),
		method: "POST",
		idempotencyKey: input.idempotencyKey ?? randomUUID(),
		body: {
			runtime: MUSE_RUNTIME_ID,
			model: input.model,
			approval_policy: "strict",
			workspace: { mode: "isolated" },
		},
	});
	const session = parseMuseAgentSession(response.value, response.body);
	if (session.runtime !== MUSE_RUNTIME_ID || session.model !== input.model) {
		throw invalidMuseResponse(response.body);
	}
	return session;
}

export async function startMuseAgentTurn(
	input: MuseClientInput & {
		sessionId: string;
		textInputs: readonly string[];
		idempotencyKey?: string;
	},
) {
	const response = await requestMuseJson({
		...input,
		url: buildMuseAgentSessionUrl(input.baseUrl, input.sessionId, "/turns"),
		method: "POST",
		idempotencyKey: input.idempotencyKey ?? randomUUID(),
		body: {
			input: input.textInputs.map((text) => ({ type: "text", text })),
		},
	});
	const turn = parseMuseAgentTurn(response.value, response.body);
	if (turn.sessionId !== input.sessionId) {
		throw invalidMuseResponse(response.body);
	}
	return turn;
}

export async function cancelMuseAgentTurn(
	input: MuseClientInput & {
		sessionId: string;
		turnId: string;
		idempotencyKey?: string;
	},
) {
	await requestMuseJson({
		...input,
		url: buildMuseAgentSessionUrl(
			input.baseUrl,
			input.sessionId,
			`/turns/${encodeURIComponent(input.turnId)}/cancel`,
		),
		method: "POST",
		idempotencyKey: input.idempotencyKey ?? randomUUID(),
	});
}

export async function releaseMuseAgentSession(
	input: MuseClientInput & { sessionId: string; idempotencyKey?: string },
) {
	const response = await requestMuseJson({
		...input,
		url: buildMuseAgentSessionUrl(input.baseUrl, input.sessionId, "/release"),
		method: "POST",
		idempotencyKey: input.idempotencyKey ?? randomUUID(),
	});
	const session = parseMuseAgentSession(response.value, response.body);
	if (session.id !== input.sessionId || session.runtime !== MUSE_RUNTIME_ID) {
		throw invalidMuseResponse(response.body);
	}
	return session;
}

export async function* streamMuseAgentEvents(
	input: MuseClientInput & { sessionId: string; after: string },
): AsyncGenerator<MuseAgentEvent> {
	const url = new URL(
		buildMuseAgentSessionUrl(input.baseUrl, input.sessionId, "/events"),
	);
	url.searchParams.set("after", input.after);
	const response = await (input.fetchImpl ?? fetch)(url, {
		method: "GET",
		signal: input.signal,
		headers: buildMuseHeaders(input.apiKey, false, false),
	});
	if (!response.ok) {
		throw providerHttpError({
			provider: "Muse",
			status: response.status,
			body: await readBoundedProviderResponseText(response),
			retryAfter: response.headers.get("retry-after"),
		});
	}
	if (!response.body) throw invalidMuseResponse("");

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	let totalBytes = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			totalBytes += value.byteLength;
			if (totalBytes > MAX_PROVIDER_RESPONSE_BYTES) {
				throw providerResponseTooLargeError();
			}
			buffer += decoder.decode(value, { stream: true });
			for (;;) {
				const boundary = findSseFrameBoundary(buffer);
				if (!boundary) break;
				const frame = buffer.slice(0, boundary.index);
				buffer = buffer.slice(boundary.index + boundary.length);
				const event = parseMuseSseFrame(frame);
				if (event) yield event;
			}
		}
		buffer += decoder.decode();
		const finalEvent = parseMuseSseFrame(buffer);
		if (finalEvent) yield finalEvent;
	} finally {
		await reader.cancel().catch(() => undefined);
	}
}

function buildMuseAgentUrl(baseUrl: string, apiPath: string) {
	const url = new URL(baseUrl);
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new TypeError("Muse base URL must use http or https.");
	}
	let prefix = url.pathname.replace(/\/+$/, "");
	if (prefix === "/") prefix = "";
	if (prefix.endsWith("/v1")) prefix = prefix.slice(0, -3);
	url.pathname = `${prefix}${apiPath}`.replace(/\/{2,}/g, "/");
	url.search = "";
	url.hash = "";
	return url;
}

function buildMuseHeaders(
	apiKey: string | undefined,
	json: boolean,
	idempotencyKey: string | false,
) {
	return {
		Accept: json ? "application/json" : "text/event-stream",
		...(json ? { "Content-Type": "application/json" } : {}),
		...(apiKey?.trim() ? { Authorization: `Bearer ${apiKey.trim()}` } : {}),
		...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
	};
}

async function requestMuseJson(
	input: MuseClientInput & {
		url: string;
		method: "GET" | "POST";
		body?: Record<string, unknown>;
		idempotencyKey?: string;
	},
) {
	const response = await (input.fetchImpl ?? fetch)(input.url, {
		method: input.method,
		signal: input.signal,
		headers: buildMuseHeaders(
			input.apiKey,
			true,
			input.idempotencyKey ?? false,
		),
		...(input.body ? { body: JSON.stringify(input.body) } : {}),
	});
	const body = await readBoundedProviderResponseText(response);
	if (!response.ok) {
		throw providerHttpError({
			provider: "Muse",
			status: response.status,
			body,
			retryAfter: response.headers.get("retry-after"),
		});
	}
	let value: unknown;
	try {
		value = JSON.parse(body);
	} catch (error) {
		throw invalidMuseResponse(body, error);
	}
	if (!isRecord(value)) throw invalidMuseResponse(body);
	return { body, value };
}

function parseMuseAgentModel(value: unknown, body: string): MuseAgentModel {
	if (!isRecord(value)) throw invalidMuseResponse(body);
	const id = readRequiredString(value.id, body);
	const runtime = readRequiredString(value.runtime, body);
	return {
		id,
		runtime,
		displayName:
			typeof value.display_name === "string" && value.display_name.trim()
				? value.display_name.trim()
				: id,
		contextLimit: readOptionalNumber(value.context_limit),
		outputLimit: readOptionalNumber(value.output_limit),
	};
}

function parseMuseAgentSession(
	value: Record<string, unknown>,
	body: string,
): MuseAgentSession {
	return {
		id: readRequiredString(value.id, body),
		runtime: readRequiredString(value.runtime, body),
		model: readRequiredString(value.model, body),
		status: readRequiredString(value.status, body),
		eventsUrl: readRequiredString(value.events_url, body),
		cursor: readRequiredString(value.cursor, body),
	};
}

function parseMuseAgentTurn(
	value: Record<string, unknown>,
	body: string,
): MuseAgentTurn {
	return {
		id: readRequiredString(value.id, body),
		sessionId: readRequiredString(value.session_id, body),
		status: readRequiredString(value.status, body),
	};
}

function parseMuseSseFrame(frame: string): MuseAgentEvent | null {
	if (!frame.trim()) return null;
	const lines = frame.split(/\r?\n/);
	const eventName = lines
		.find((line) => line.startsWith("event:"))
		?.slice("event:".length)
		.trim();
	const dataText = lines
		.filter((line) => line.startsWith("data:"))
		.map((line) => line.slice("data:".length).trimStart())
		.join("\n");
	if (!dataText) return null;
	let value: unknown;
	try {
		value = JSON.parse(dataText);
	} catch (error) {
		throw invalidMuseResponse(dataText, error);
	}
	if (!isRecord(value)) throw invalidMuseResponse(dataText);
	const type = readRequiredString(value.type, dataText);
	if (eventName && eventName !== type) throw invalidMuseResponse(dataText);
	return {
		type,
		sessionId: readRequiredString(value.session_id, dataText),
		turnId: readOptionalString(value.turn_id),
		cursor: readOptionalString(value.cursor),
		data: isRecord(value.data) ? value.data : {},
	};
}

function findSseFrameBoundary(value: string) {
	const lf = value.indexOf("\n\n");
	const crlf = value.indexOf("\r\n\r\n");
	if (lf < 0 && crlf < 0) return null;
	if (lf >= 0 && (crlf < 0 || lf < crlf)) return { index: lf, length: 2 };
	return { index: crlf, length: 4 };
}

function readRequiredString(value: unknown, body: string) {
	if (typeof value === "string" && value.trim()) return value.trim();
	throw invalidMuseResponse(body);
}

function readOptionalString(value: unknown) {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readOptionalNumber(value: unknown) {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function invalidMuseResponse(body: string, cause?: unknown) {
	return providerInvalidResponseError({ provider: "Muse", body, cause });
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
