import { queryOptions } from "@tanstack/react-query";
import { readJsonResponse } from "../../lib/api-error";
import type { FxRateCache, GeneralSettings } from "../nightworkers/types";
import { mergeGeneralSettings } from "./SettingsForms";
import { fetchFxRates, fetchGeneralSettings } from "./settingsCommands";

export const settingsResourceQueryKeys = {
	general: ["settings", "general"] as const,
	fxRates: ["settings", "fx-rates"] as const,
};

export async function fetchNormalizedGeneralSettings(
	signal?: AbortSignal,
): Promise<GeneralSettings> {
	const response = await fetchGeneralSettings({ signal });
	return mergeGeneralSettings(
		await readJsonResponse<Partial<GeneralSettings>>(response),
	);
}

export async function fetchFxRateCache(
	signal?: AbortSignal,
): Promise<FxRateCache | null> {
	return readJsonResponse<FxRateCache | null>(await fetchFxRates({ signal }));
}

export function generalSettingsQueryOptions() {
	return queryOptions({
		queryKey: settingsResourceQueryKeys.general,
		queryFn: ({ signal }) => fetchNormalizedGeneralSettings(signal),
	});
}

export function fxRateCacheQueryOptions() {
	return queryOptions({
		queryKey: settingsResourceQueryKeys.fxRates,
		queryFn: ({ signal }) => fetchFxRateCache(signal),
		refetchOnWindowFocus: false,
	});
}
