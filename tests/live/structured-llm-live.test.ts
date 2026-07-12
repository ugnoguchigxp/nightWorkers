import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { callStructuredJsonLLM } from "../../api/services/structured-llm";
import { checkStructuredLlmProviderHealth } from "../../api/services/structured-llm/provider-health";
import type {
	StructuredLlmProviderEndpoint,
	StructuredLlmProviderEndpointKind,
	StructuredLlmProviderSettings,
} from "../../api/services/structured-llm/settings";

const liveEnabled = process.env.NIGHTWORKERS_LIVE_LLM_VITEST === "1";
const liveHealthEnabled =
	liveEnabled && process.env.NIGHTWORKERS_LIVE_LLM_HEALTH === "1";
const liveHealthSupported = liveHealthEnabled && isLiveHealthProbeSupported();

const originalRuntimeLane = process.env.NIGHTWORKERS_RUNTIME_LANE;
const originalSettingsPath = process.env.NIGHTWORKERS_LLM_SETTINGS_PATH;
let tempDir: string | null = null;

afterEach(() => {
	restoreEnv("NIGHTWORKERS_RUNTIME_LANE", originalRuntimeLane);
	restoreEnv("NIGHTWORKERS_LLM_SETTINGS_PATH", originalSettingsPath);
	if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
	tempDir = null;
});

describe("structured LLM live provider smoke", () => {
	it.skipIf(!liveEnabled)(
		"calls a configured live provider and receives structured JSON",
		async () => {
			const { endpoint, settings } = buildLiveSettingsFromEnv();
			installIsolatedLiveSettings(settings);

			const events: Array<{ type: string; data?: Record<string, unknown> }> =
				[];
			const raw = await callStructuredJsonLLM(
				"Return only JSON matching the requested schema.",
				'Respond with {"status":"ok","provider":"live"} and no other text.',
				{
					schemaName: "nightworkers_live_llm_smoke",
					schema: {
						type: "object",
						additionalProperties: false,
						properties: {
							status: { type: "string" },
							provider: { type: "string" },
						},
						required: ["status", "provider"],
					},
					role: "plan",
					timeoutMs: Number(
						process.env.NIGHTWORKERS_LIVE_LLM_TIMEOUT_MS || 60_000,
					),
					emitEvent: (event) =>
						events.push({ type: event.type, data: event.data }),
				},
			);

			const parsed = JSON.parse(raw) as { status?: string; provider?: string };
			expect(parsed).toMatchObject({ status: "ok" });
			expect(
				events.some((event) => event.type === "model.request_started"),
			).toBe(true);
			expect(
				events.some((event) => event.type === "model.response_finished"),
			).toBe(true);
			expect(events.at(0)?.data).toMatchObject({
				providerEndpointId: endpoint.id,
				role: "plan",
			});
		},
	);

	it.skipIf(!liveHealthSupported)(
		"can probe the configured live provider health endpoint when explicitly enabled",
		async () => {
			const { endpoint } = buildLiveSettingsFromEnv();
			const result = await checkStructuredLlmProviderHealth(endpoint, {
				timeoutMs: Number(
					process.env.NIGHTWORKERS_LIVE_LLM_HEALTH_TIMEOUT_MS || 10_000,
				),
			});

			expect(result.reachable).toBe(true);
			expect(result.ok).toBe(true);
		},
	);
});

function installIsolatedLiveSettings(settings: StructuredLlmProviderSettings) {
	tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nightworkers-live-llm-"));
	process.env.NIGHTWORKERS_LLM_SETTINGS_PATH = path.join(
		tempDir,
		"llm-settings.json",
	);
	process.env.NIGHTWORKERS_RUNTIME_LANE = "native-api-runner";
	fs.writeFileSync(
		process.env.NIGHTWORKERS_LLM_SETTINGS_PATH,
		JSON.stringify(settings, null, 2),
	);
}

function buildLiveSettingsFromEnv(): {
	endpoint: StructuredLlmProviderEndpoint;
	settings: StructuredLlmProviderSettings;
} {
	const provider = resolveLiveProviderKind();
	const endpoint = buildLiveEndpoint(provider);
	const primary = {
		providerEndpointId: endpoint.id,
		model: endpoint.models[0] || "",
	};
	return {
		endpoint,
		settings: {
			ACTIVE_LLM_PROVIDER: provider === "azure" ? "azure" : "openai",
			OPENAI_ENABLED: provider !== "azure",
			OPENAI_STREAMING_ENABLED: false,
			AZURE_OPENAI_ENABLED: provider === "azure",
			providerEndpoints: [endpoint],
			roleRoutes: [
				{ role: "plan", primary, fallbacks: [] },
				{ role: "implementation", primary, fallbacks: [] },
				{ role: "test", primary, fallbacks: [] },
				{ role: "review", primary, fallbacks: [] },
				{ role: "mission_pilot", primary, fallbacks: [] },
				{ role: "mission_task_generation", primary, fallbacks: [] },
			],
		},
	};
}

function resolveLiveProviderKind(): StructuredLlmProviderEndpointKind {
	const explicit = process.env.NIGHTWORKERS_LIVE_LLM_PROVIDER?.trim();
	if (explicit) return explicit as StructuredLlmProviderEndpointKind;
	if (
		process.env.AZURE_OPENAI_API_KEY &&
		process.env.AZURE_OPENAI_ENDPOINT &&
		process.env.AZURE_OPENAI_DEPLOYMENT_NAME
	) {
		return "azure";
	}
	if (
		process.env.LOCAL_OPENAI_BASE_URL ||
		process.env.NIGHTWORKERS_LOCAL_LLM_BASE_URL
	) {
		return "local";
	}
	if (process.env.OPENAI_COMPATIBLE_BASE_URL) return "openai-compatible";
	if (process.env.OPENAI_API_KEY) return "openai";
	throw new Error(
		"No live LLM provider is configured. Set NIGHTWORKERS_LIVE_LLM_PROVIDER plus matching credentials/base URL.",
	);
}

function isLiveHealthProbeSupported() {
	if (!liveHealthEnabled) return false;
	const explicit = process.env.NIGHTWORKERS_LIVE_LLM_PROVIDER?.trim();
	if (explicit === "openai" || explicit === "openai-compatible") return false;
	if (explicit) return true;
	if (
		process.env.AZURE_OPENAI_API_KEY &&
		process.env.AZURE_OPENAI_ENDPOINT &&
		process.env.AZURE_OPENAI_DEPLOYMENT_NAME
	) {
		return true;
	}
	if (
		process.env.LOCAL_OPENAI_BASE_URL ||
		process.env.NIGHTWORKERS_LOCAL_LLM_BASE_URL
	)
		return true;
	if (process.env.OPENAI_COMPATIBLE_BASE_URL) return false;
	if (process.env.OPENAI_API_KEY) return false;
	return true;
}

function buildLiveEndpoint(
	kind: StructuredLlmProviderEndpointKind,
): StructuredLlmProviderEndpoint {
	if (kind === "azure") {
		const apiKey = requireEnv("AZURE_OPENAI_API_KEY");
		const endpoint = requireEnv("AZURE_OPENAI_ENDPOINT");
		const deployment = requireEnv("AZURE_OPENAI_DEPLOYMENT_NAME");
		return {
			id: "live-azure",
			name: "Live Azure OpenAI",
			kind,
			enabled: true,
			apiKey,
			endpoint,
			apiVersion: process.env.AZURE_OPENAI_API_VERSION || "2024-05-01-preview",
			models: [deployment],
		};
	}

	if (kind === "openai") {
		return {
			id: "live-openai",
			name: "Live OpenAI",
			kind,
			enabled: true,
			apiKey: requireEnv("OPENAI_API_KEY"),
			baseUrl: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
			models: [process.env.OPENAI_MODEL || "gpt-4o-mini"],
		};
	}

	if (kind === "local" || kind === "openai-compatible") {
		return {
			id: `live-${kind}`,
			name: `Live ${kind}`,
			kind,
			enabled: true,
			apiKey:
				process.env.OPENAI_COMPATIBLE_API_KEY ||
				process.env.OPENAI_API_KEY ||
				"",
			baseUrl:
				process.env.OPENAI_COMPATIBLE_BASE_URL ||
				process.env.LOCAL_OPENAI_BASE_URL ||
				process.env.NIGHTWORKERS_LOCAL_LLM_BASE_URL ||
				process.env.OPENAI_BASE_URL ||
				"http://localhost:11434/v1",
			models: [
				process.env.OPENAI_COMPATIBLE_MODEL ||
					process.env.LOCAL_OPENAI_MODEL ||
					process.env.OPENAI_MODEL ||
					"qwen3-coder",
			],
		};
	}

	throw new Error(`Unsupported live LLM provider for this smoke test: ${kind}`);
}

function requireEnv(name: string) {
	const value = process.env[name]?.trim();
	if (!value) throw new Error(`${name} is required for live LLM smoke tests.`);
	return value;
}

function restoreEnv(name: string, value: string | undefined) {
	if (value === undefined) delete process.env[name];
	else process.env[name] = value;
}
