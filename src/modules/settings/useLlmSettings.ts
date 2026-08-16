import { useQuery, useQueryClient } from "@tanstack/react-query";
import { readJsonResponse } from "../../lib/api-error";
import type { LlmProvider, LlmSettings } from "../nightworkers/types";
import {
	llmProviderModelOptionsQueryOptions,
	llmSettingsQueryKeys,
	llmSettingsQueryOptions,
	saveNormalizedLlmSettings,
} from "./llm-settings-query";
import { runLlmSmokeTest } from "./settingsCommands";

export function useLlmSettings() {
	const queryClient = useQueryClient();
	const { data: llmSettings = null } = useQuery(llmSettingsQueryOptions());
	const activeProvider = (llmSettings?.ACTIVE_LLM_PROVIDER ||
		"azure") as LlmProvider;
	const { data: providerModelOptions = [] } = useQuery(
		llmProviderModelOptionsQueryOptions(activeProvider),
	);
	const save = async (settings: LlmSettings) => {
		const saved = await saveNormalizedLlmSettings(settings);
		queryClient.setQueryData(llmSettingsQueryKeys.settings, saved);
		queryClient.invalidateQueries({
			queryKey: ["llmSettings", "modelOptions"],
		});
		return saved;
	};

	return {
		llmSettings,
		activeProvider,
		providerModelOptions,
		setActiveProvider: async (provider: LlmProvider) => {
			const merged = {
				...(llmSettings || {}),
				ACTIVE_LLM_PROVIDER: provider,
			} as LlmSettings;
			await save(merged);
		},
		toggleProviderEnabled: async (provider: LlmProvider, enabled: boolean) => {
			if (!llmSettings) return;
			const flagKey: Record<LlmProvider, keyof LlmSettings> = {
				openai: "OPENAI_ENABLED",
				azure: "AZURE_OPENAI_ENABLED",
				bedrock: "AWS_BEDROCK_ENABLED",
				codex: "CODEX_ENABLED",
			};
			const merged = { ...llmSettings, [flagKey[provider]]: enabled };
			await save(merged);
		},
		updateProviderModel: async (model: string) => {
			if (!llmSettings) return;
			const modelKey: Record<LlmProvider, keyof LlmSettings> = {
				openai: "OPENAI_MODEL",
				azure: "AZURE_OPENAI_DEPLOYMENT_NAME",
				bedrock: "AWS_BEDROCK_MODEL",
				codex: "CODEX_MODEL",
			};
			const merged = { ...llmSettings, [modelKey[activeProvider]]: model };
			await save(merged);
		},
		runLlmSmokeTest: async () => {
			return readJsonResponse<{
				ok: boolean;
				provider: string;
				message: string;
			}>(await runLlmSmokeTest());
		},
	};
}
