import { apiFetch } from "../../lib/api-base";
import { jsonRequest } from "../../lib/api-request";
import type {
	GeneralSettings,
	LlmProviderEndpoint,
	LlmSettings,
} from "../nightworkers/types";

export function fetchLlmSettings() {
	return apiFetch("/api/settings/llm");
}

export function saveLlmSettings(settings: LlmSettings) {
	return apiFetch("/api/settings/llm", jsonRequest("POST", settings));
}

export function fetchGeneralSettings(init?: RequestInit) {
	return apiFetch("/api/settings/general", init);
}

export function saveGeneralSettings(settings: GeneralSettings) {
	return apiFetch("/api/settings/general", jsonRequest("POST", settings));
}

export function previewDataRetentionCleanup() {
	return apiFetch("/api/settings/data-retention/cleanup/preview", {
		method: "POST",
	});
}

export function executeDataRetentionCleanup(input: {
	previewId: string;
	expectedSettingsRevision: number;
	idempotencyKey: string;
	reclaimDiskSpace: "incremental" | "skip";
}) {
	return apiFetch(
		"/api/settings/data-retention/cleanup",
		jsonRequest("POST", input),
	);
}

export function fetchFxRates() {
	return apiFetch("/api/settings/fx");
}

export function refreshFxRates() {
	return apiFetch("/api/settings/fx/refresh", { method: "POST" });
}

export function fetchPricingRows(
	input: {
		provider?: string;
		model?: string;
		limit?: number;
		cursor?: string | null;
	} = {},
) {
	const query = new URLSearchParams();
	if (input.provider) query.set("provider", input.provider);
	if (input.model) query.set("model", input.model);
	query.set("limit", String(input.limit ?? 50));
	if (input.cursor) query.set("cursor", input.cursor);
	return apiFetch(`/api/settings/pricing?${query.toString()}`);
}

export function importPublicPricingRows() {
	return apiFetch("/api/settings/pricing/import-public", { method: "POST" });
}

export function fetchLlmModelOptions() {
	return apiFetch("/api/settings/llm/models");
}

export function fetchCodexSdkStatus() {
	return apiFetch("/api/settings/codex/status");
}

export function fetchStartupPreflight() {
	return apiFetch("/api/settings/preflight/startup");
}

export function runLlmSmokeTest() {
	return apiFetch("/api/settings/llm/smoke", { method: "POST" });
}

export function testLlmProviderHealth(
	id: string,
	endpoint?: LlmProviderEndpoint,
) {
	return apiFetch(
		`/api/settings/llm/providers/${encodeURIComponent(id)}/health`,
		{
			method: "POST",
			...(endpoint
				? {
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ endpoint }),
					}
				: {}),
		},
	);
}
