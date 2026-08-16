import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { readJsonResponse } from "../../lib/api-error";
import type { LlmProvider, LlmSettings } from "../nightworkers/types";
import { defaultSettings } from "./settings-defaults";
import {
	fetchLlmModelOptions,
	fetchLlmSettings,
	saveLlmSettings,
} from "./settingsCommands";

const llmSettingsResponseSchema = z.record(z.string(), z.unknown());
const llmModelOptionsSchema = z.object({
	options: z.array(z.object({ value: z.string(), label: z.string() })),
});

export const llmSettingsQueryKeys = {
	settings: ["llmSettings"] as const,
	modelOptions: (provider: LlmProvider) =>
		["llmSettings", "modelOptions", provider] as const,
};

export function normalizeLlmSettings(
	settings: Partial<LlmSettings>,
): LlmSettings {
	return { ...defaultSettings, ...settings };
}

export async function readNormalizedLlmSettings(
	response: Response,
): Promise<LlmSettings> {
	const settings = await readJsonResponse(response, llmSettingsResponseSchema);
	return normalizeLlmSettings(settings as Partial<LlmSettings>);
}

export async function fetchNormalizedLlmSettings(): Promise<LlmSettings> {
	return readNormalizedLlmSettings(await fetchLlmSettings());
}

export async function saveNormalizedLlmSettings(
	settings: LlmSettings,
): Promise<LlmSettings> {
	return readNormalizedLlmSettings(await saveLlmSettings(settings));
}

export async function fetchLlmProviderModelOptions(_provider: LlmProvider) {
	const response = await readJsonResponse(
		await fetchLlmModelOptions(),
		llmModelOptionsSchema,
	);
	return response.options;
}

export function llmSettingsQueryOptions() {
	return queryOptions({
		queryKey: llmSettingsQueryKeys.settings,
		queryFn: fetchNormalizedLlmSettings,
	});
}

export function llmProviderModelOptionsQueryOptions(provider: LlmProvider) {
	return queryOptions({
		queryKey: llmSettingsQueryKeys.modelOptions(provider),
		queryFn: () => fetchLlmProviderModelOptions(provider),
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
	});
}
