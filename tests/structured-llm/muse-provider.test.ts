import { describe, expect, it, vi } from "vitest";
import {
	llmSettingsSchema,
	normalizeRawLlmSettings,
} from "../../api/modules/settings";
import {
	callMuseProvider,
	callMuseProviderToolTurn,
} from "../../api/services/structured-llm/muse-provider";
import {
	buildMuseAgentModelsUrl,
	buildMuseAgentSessionsUrl,
	MUSE_DEFAULT_MODEL,
} from "../../api/services/structured-llm/muse-provider-client";
import {
	checkStructuredLlmProviderExecutionReadiness,
	checkStructuredLlmProviderHealth,
} from "../../api/services/structured-llm/provider-health";
import type { StructuredLlmProviderEndpoint } from "../../api/services/structured-llm/settings";

const endpoint: StructuredLlmProviderEndpoint = {
	id: "muse-default",
	name: "Muse",
	kind: "muse",
	enabled: true,
	apiKey: "",
	baseUrl: "http://127.0.0.1:44449",
	models: [MUSE_DEFAULT_MODEL],
};

function sessionResponse(status = "idle") {
	return {
		id: "ags_session",
		runtime: "muse",
		model: MUSE_DEFAULT_MODEL,
		status,
		events_url: "/v1/agents/sessions/ags_session/events",
		cursor: "cursor-start",
	};
}

function modelsResponse() {
	return {
		object: "list",
		data: [
			{
				id: MUSE_DEFAULT_MODEL,
				runtime: "muse",
				display_name: "muse-spark-1.3-contributor",
				context_limit: 1_007_997,
				output_limit: 128_000,
			},
		],
	};
}

function jsonResponse(value: unknown, status = 200) {
	return new Response(JSON.stringify(value), {
		status,
		headers: { "content-type": "application/json" },
	});
}

describe("Muse structured LLM provider", () => {
	it("builds the documented model-list and session URLs", () => {
		expect(buildMuseAgentModelsUrl("http://127.0.0.1:44449")).toBe(
			"http://127.0.0.1:44449/v1/agents/models?runtime=muse",
		);
		expect(buildMuseAgentSessionsUrl("http://127.0.0.1:44449/v1")).toBe(
			"http://127.0.0.1:44449/v1/agents/sessions",
		);
	});

	it("registers the supplied Muse endpoint in normalized settings", () => {
		const settings = normalizeRawLlmSettings(llmSettingsSchema.parse({}));
		expect(settings.providerEndpoints).toContainEqual(
			expect.objectContaining({
				id: "muse-default",
				name: "Muse",
				kind: "muse",
				enabled: true,
				baseUrl: "http://127.0.0.1:44449",
				models: [MUSE_DEFAULT_MODEL],
			}),
		);
	});

	it("creates a session, consumes the terminal SSE event, and releases it", async () => {
		const calls: Array<{ url: string; init?: RequestInit }> = [];
		const fetchImpl = vi.fn(
			async (target: string | URL, init?: RequestInit) => {
				const url = String(target);
				calls.push({ url, init });
				if (url.endsWith("/v1/agents/sessions")) {
					return jsonResponse(sessionResponse(), 201);
				}
				if (url.endsWith("/v1/agents/sessions/ags_session/turns")) {
					return jsonResponse(
						{
							id: "agt_turn",
							session_id: "ags_session",
							status: "accepted",
						},
						202,
					);
				}
				if (url.includes("/events?after=cursor-start")) {
					const events = [
						{
							type: "message.completed",
							session_id: "ags_session",
							turn_id: "agt_turn",
							cursor: "cursor-message",
							data: { item_id: "message-1", text: '{"ok":true}' },
						},
						{
							type: "turn.completed",
							session_id: "ags_session",
							turn_id: "agt_turn",
							cursor: "cursor-terminal",
							data: { terminal: "completed", duration_ms: 12 },
						},
					]
						.map(
							(event) =>
								`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
						)
						.join("");
					return new Response(events, {
						status: 200,
						headers: { "content-type": "text/event-stream" },
					});
				}
				if (url.endsWith("/v1/agents/sessions/ags_session/release")) {
					return jsonResponse(sessionResponse("released"));
				}
				throw new Error(`Unexpected request: ${url}`);
			},
		) as typeof fetch;
		const setProviderDebug = vi.fn();

		const result = await callMuseProvider(
			{
				provider: "muse",
				systemPrompt: "system",
				userPrompt: "user",
				options: {
					label: "muse-test",
					normalizedRequest: {
						providerId: "muse",
						providerClass: "agent_session",
						providerEndpointId: endpoint.id,
						modelOrDeployment: MUSE_DEFAULT_MODEL,
						endpoint: endpoint.baseUrl || null,
					} as never,
				},
				signal: new AbortController().signal,
				setProviderDebug,
				fetchImpl,
			},
			{ providerEndpoints: [endpoint] },
		);

		expect(result).toMatchObject({
			content: '{"ok":true}',
			model: MUSE_DEFAULT_MODEL,
			usage: { mode: "estimated" },
			providerDebug: {
				provider: "muse",
				providerSessionId: "ags_session",
				providerTurnId: "agt_turn",
				terminal: "completed",
				cleanupStatus: "released",
			},
		});
		expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
			runtime: "muse",
			model: MUSE_DEFAULT_MODEL,
			approval_policy: "strict",
			workspace: { mode: "isolated" },
		});
		expect(JSON.parse(String(calls[1]?.init?.body))).toEqual({
			input: [
				{ type: "text", text: "system" },
				{ type: "text", text: "user" },
			],
		});
		expect(calls.map((call) => call.url)).toEqual([
			"http://127.0.0.1:44449/v1/agents/sessions",
			"http://127.0.0.1:44449/v1/agents/sessions/ags_session/turns",
			"http://127.0.0.1:44449/v1/agents/sessions/ags_session/events?after=cursor-start",
			"http://127.0.0.1:44449/v1/agents/sessions/ags_session/release",
		]);
		expect(setProviderDebug).toHaveBeenCalledWith(
			expect.objectContaining({ cleanupStatus: "released" }),
		);
	});

	it("requires the explicit provider-tools capability for tool turns", async () => {
		const result = await callMuseProviderToolTurn(
			{
				provider: "muse",
				messages: [{ role: "user", content: "hello" }],
				tools: [
					{
						name: "read",
						description: "Read data",
						inputSchema: { type: "object" },
					},
				],
				systemPrompt: "system",
				userPrompt: "user",
				options: {
					label: "muse-tool-test",
					normalizedRequest: {
						providerId: "muse",
						providerClass: "agent_session",
						providerEndpointId: endpoint.id,
					} as never,
				},
				signal: new AbortController().signal,
				setProviderDebug: vi.fn(),
				fetchImpl: vi.fn() as typeof fetch,
			},
			{ providerEndpoints: [endpoint] },
		);
		expect(result).toMatchObject({
			type: "unsupported",
			providerDebug: {
				provider: "muse",
				allowProviderTools: false,
			},
		});
	});

	it("uses model discovery and session creation for readiness", async () => {
		const calls: string[] = [];
		const fetchImpl = vi.fn(async (target: string | URL) => {
			const url = String(target);
			calls.push(url);
			if (url.includes("/v1/agents/models?runtime=muse")) {
				return jsonResponse(modelsResponse());
			}
			if (url.endsWith("/v1/agents/sessions")) {
				return jsonResponse(sessionResponse(), 201);
			}
			if (url.endsWith("/v1/agents/sessions/ags_session/release")) {
				return jsonResponse(sessionResponse("released"));
			}
			throw new Error(`Unexpected request: ${url}`);
		}) as typeof fetch;

		const health = await checkStructuredLlmProviderHealth(endpoint, {
			fetchImpl,
		});
		expect(health).toMatchObject({
			ok: true,
			reachable: true,
			providerKind: "muse",
			status: 200,
		});

		calls.length = 0;
		const readiness = await checkStructuredLlmProviderExecutionReadiness(
			endpoint,
			{ fetchImpl },
		);
		expect(readiness).toMatchObject({
			ok: true,
			reachable: true,
			providerKind: "muse",
			status: 201,
			probeKind: "execution_readiness",
		});
		expect(calls).toEqual([
			"http://127.0.0.1:44449/v1/agents/models?runtime=muse",
			"http://127.0.0.1:44449/v1/agents/sessions",
			"http://127.0.0.1:44449/v1/agents/sessions/ags_session/release",
		]);
	});
});
