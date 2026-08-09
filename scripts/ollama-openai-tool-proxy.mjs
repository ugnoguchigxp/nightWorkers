import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 11_435;
const DEFAULT_OLLAMA_ORIGIN = "http://127.0.0.1:11434";
const MAX_REQUEST_BYTES = 8 * 1024 * 1024;

export function toOllamaToolMessages(messages) {
	const toolNamesByCallId = new Map();
	return messages.map((message) => {
		if (message?.role === "assistant" && Array.isArray(message.tool_calls)) {
			const toolCalls = message.tool_calls.map((toolCall) => {
				const name = toolCall?.function?.name || "";
				if (toolCall?.id && name) toolNamesByCallId.set(toolCall.id, name);
				return {
					function: {
						name,
						arguments: parseArguments(toolCall?.function?.arguments),
					},
				};
			});
			return {
				role: "assistant",
				content: message.content || "",
				tool_calls: toolCalls,
			};
		}
		if (message?.role === "tool") {
			return {
				role: "tool",
				tool_name: toolNamesByCallId.get(message.tool_call_id) || "",
				content: message.content || "",
			};
		}
		return {
			role: message?.role,
			content: message?.content ?? "",
		};
	});
}

export function toOpenAIToolCompletion(response, requestedModel) {
	const toolCalls = Array.isArray(response?.message?.tool_calls)
		? response.message.tool_calls.map((toolCall, index) => ({
				id: toolCall?.id || `call_ollama_${index}`,
				type: "function",
				function: {
					name: toolCall?.function?.name || "",
					arguments: JSON.stringify(toolCall?.function?.arguments ?? {}),
				},
			}))
		: [];
	return {
		id: `chatcmpl_ollama_${Date.now()}`,
		object: "chat.completion",
		created: Math.floor(Date.now() / 1_000),
		model: response?.model || requestedModel,
		choices: [
			{
				index: 0,
				message: {
					role: "assistant",
					content: response?.message?.content || "",
					...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
				},
				finish_reason: toolCalls.length > 0 ? "tool_calls" : "stop",
			},
		],
		usage: {
			prompt_tokens: finiteNumber(response?.prompt_eval_count),
			completion_tokens: finiteNumber(response?.eval_count),
			total_tokens:
				finiteNumber(response?.prompt_eval_count) +
				finiteNumber(response?.eval_count),
		},
	};
}

export function createOllamaOpenAIToolProxy(options = {}) {
	const host = options.host || DEFAULT_HOST;
	const port = Number(options.port || DEFAULT_PORT);
	const ollamaOrigin = options.ollamaOrigin || DEFAULT_OLLAMA_ORIGIN;
	const server = http.createServer(async (request, response) => {
		try {
			if (
				request.method !== "POST" ||
				request.url !== "/v1/chat/completions"
			) {
				writeJson(response, 404, {
					error: { message: "Only POST /v1/chat/completions is supported." },
				});
				return;
			}
			const body = await readJsonBody(request);
			if (body.stream === true) {
				writeJson(response, 400, {
					error: { message: "Streaming is not supported by this pilot proxy." },
				});
				return;
			}
			const upstream = await fetch(`${ollamaOrigin}/api/chat`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					model: body.model,
					messages: toOllamaToolMessages(body.messages || []),
					tools: body.tools || [],
					stream: false,
					think: false,
				}),
			});
			const upstreamText = await upstream.text();
			if (!upstream.ok) {
				writeJson(response, upstream.status, {
					error: {
						message: `Ollama request failed with status ${upstream.status}.`,
						upstreamBody: upstreamText.slice(0, 2_000),
					},
				});
				return;
			}
			const upstreamJson = JSON.parse(upstreamText);
			writeJson(
				response,
				200,
				toOpenAIToolCompletion(upstreamJson, body.model),
			);
		} catch (error) {
			writeJson(response, 500, {
				error: {
					message: error instanceof Error ? error.message : String(error),
				},
			});
		}
	});
	return {
		server,
		listen: () =>
			new Promise((resolve, reject) => {
				server.once("error", reject);
				server.listen(port, host, () => {
					server.off("error", reject);
					resolve({ host, port, ollamaOrigin });
				});
			}),
	};
}

function parseArguments(value) {
	if (value && typeof value === "object" && !Array.isArray(value)) return value;
	if (typeof value !== "string" || !value.trim()) return {};
	try {
		const parsed = JSON.parse(value);
		return parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? parsed
			: {};
	} catch {
		return {};
	}
}

function finiteNumber(value) {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

async function readJsonBody(request) {
	const chunks = [];
	let totalBytes = 0;
	for await (const chunk of request) {
		totalBytes += chunk.length;
		if (totalBytes > MAX_REQUEST_BYTES)
			throw new Error("Request body exceeded the pilot proxy limit.");
		chunks.push(chunk);
	}
	return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function writeJson(response, status, payload) {
	response.writeHead(status, {
		"content-type": "application/json",
		"cache-control": "no-store",
	});
	response.end(JSON.stringify(payload));
}

const isMain =
	process.argv[1] &&
	path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
	const proxy = createOllamaOpenAIToolProxy({
		host: process.env.NIGHTWORKERS_OLLAMA_PROXY_HOST,
		port: process.env.NIGHTWORKERS_OLLAMA_PROXY_PORT,
		ollamaOrigin: process.env.NIGHTWORKERS_OLLAMA_ORIGIN,
	});
	const address = await proxy.listen();
	console.log(
		`[ollama-openai-tool-proxy] listening on http://${address.host}:${address.port}; upstream=${address.ollamaOrigin}`,
	);
}
