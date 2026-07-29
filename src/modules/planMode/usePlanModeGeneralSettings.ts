import { useEffect, useState } from "react";
import type { GeneralSettings } from "../nightworkers/types";
import { fetchGeneralSettings } from "../settings";

export function usePlanModeGeneralSettings() {
	const [settings, setSettings] = useState<GeneralSettings | null>(null);
	useEffect(() => {
		const controller = new AbortController();
		fetchGeneralSettings({ signal: controller.signal })
			.then(async (response) => {
				if (!response.ok) return null;
				return (await response.json()) as GeneralSettings;
			})
			.then((nextSettings) => {
				if (!controller.signal.aborted) setSettings(nextSettings);
			})
			.catch((error) => {
				if (error?.name !== "AbortError")
					console.warn("Failed to load Plan Mode settings", error);
			});
		return () => controller.abort();
	}, []);
	return settings;
}
