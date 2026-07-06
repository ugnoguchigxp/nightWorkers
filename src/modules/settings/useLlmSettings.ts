import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { LlmProvider, LlmSettings } from "../nightworkers/types";
import {
	fetchLlmModelOptions,
	fetchLlmSettings,
	runLlmSmokeTest,
	saveLlmSettings,
} from "./settingsCommands";

export function useLlmSettings() {
	const queryClient = useQueryClient();
	const { data: llmSettings = null } = useQuery({
		queryKey: ["llmSettings"],
		queryFn: async () => {
			const res = await fetchLlmSettings();
			if (!res.ok) throw new Error("Failed to fetch llm settings");
			return (await res.json()) as LlmSettings;
		},
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
	});
	const activeProvider = (llmSettings?.ACTIVE_LLM_PROVIDER ||
		"azure") as LlmProvider;
	const { data: providerModelOptions = [] } = useQuery({
		queryKey: ["llmModelOptions", activeProvider],
		queryFn: async () => {
			const res = await fetchLlmModelOptions();
			if (!res.ok) throw new Error("Failed to fetch model options");
			const data = (await res.json()) as {
				options: Array<{ value: string; label: string }>;
			};
			return data.options;
		},
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
	});

	return {
		llmSettings,
		activeProvider,
		providerModelOptions,
		setActiveProvider: async (provider: LlmProvider) => {
			const merged = {
				...(llmSettings || {}),
				ACTIVE_LLM_PROVIDER: provider,
			} as LlmSettings;
			const res = await saveLlmSettings(merged);
			if (!res.ok) throw new Error("Failed to save llm settings");
			queryClient.invalidateQueries({ queryKey: ["llmSettings"] });
			queryClient.invalidateQueries({ queryKey: ["llmModelOptions"] });
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
			const res = await saveLlmSettings(merged);
			if (!res.ok) throw new Error("Failed to save llm settings");
			queryClient.invalidateQueries({ queryKey: ["llmSettings"] });
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
			const res = await saveLlmSettings(merged);
			if (!res.ok) throw new Error("Failed to save model settings");
			queryClient.invalidateQueries({ queryKey: ["llmSettings"] });
			queryClient.invalidateQueries({ queryKey: ["llmModelOptions"] });
		},
		runLlmSmokeTest: async () => {
			const res = await runLlmSmokeTest();
			if (!res.ok) throw new Error("Failed to run smoke");
			return (await res.json()) as {
				ok: boolean;
				provider: string;
				message: string;
			};
		},
	};
}
