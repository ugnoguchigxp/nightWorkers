import { useCallback, useEffect, useState } from "react";
import { readJsonResponse } from "../../lib/api-error";
import type {
	CodexSdkStatus,
	LlmModelTarget,
	LlmProviderEndpoint,
	LlmProviderHealthResult,
	LlmRole,
	LlmRoleRoute,
	LlmSettings,
	ThinkingDepth,
} from "../nightworkers/types";
import {
	emptyModelTarget,
	formatModelTargetLabel,
	modelTargetKey,
	uniqueModelOptions,
	withThinkingDepth,
} from "./SettingsLlmRoutingModel";
import { fetchCodexSdkStatus, testLlmProviderHealth } from "./settingsCommands";

type SettingsChange = <K extends keyof LlmSettings>(
	key: K,
	value: LlmSettings[K],
) => void;

export function useSettingsLlmPanelController(input: {
	section: "providers" | "routing";
	settings: LlmSettings;
	onChange: SettingsChange;
}) {
	const { section, settings, onChange } = input;
	const [codexStatus, setCodexStatus] = useState<CodexSdkStatus | null>(null);
	const [codexStatusLoading, setCodexStatusLoading] = useState(false);
	const [healthBusyEndpointId, setHealthBusyEndpointId] = useState<
		string | null
	>(null);
	const [healthResults, setHealthResults] = useState<
		Record<string, LlmProviderHealthResult>
	>({});

	const genericProviderEndpoints = settings.providerEndpoints.filter(
		(endpoint) => endpoint.kind !== "codex",
	);
	const codexModelOptions = uniqueModelOptions([
		...(settings.CODEX_MODEL
			? [{ value: settings.CODEX_MODEL, label: settings.CODEX_MODEL }]
			: []),
		...(codexStatus?.models || []),
		...settings.providerEndpoints
			.filter((endpoint) => endpoint.kind === "codex")
			.flatMap((endpoint) =>
				endpoint.models.map((model) => ({
					value: model,
					label: endpoint.modelDisplayNames?.[model]?.trim() || model,
				})),
			),
	]);
	const modelTargetOptions = settings.providerEndpoints
		.filter((endpoint) =>
			endpoint.kind === "codex" ? settings.CODEX_ENABLED : endpoint.enabled,
		)
		.flatMap((endpoint) =>
			(endpoint.kind === "codex" && codexModelOptions.length
				? codexModelOptions.map((option) => option.value)
				: endpoint.models
			).map((model) => ({
				value: modelTargetKey({ providerEndpointId: endpoint.id, model }),
				label: formatModelTargetLabel(endpoint, model, codexModelOptions),
			})),
		);

	const refreshCodexStatus = useCallback(async () => {
		setCodexStatusLoading(true);
		try {
			setCodexStatus(
				await readJsonResponse<CodexSdkStatus>(await fetchCodexSdkStatus()),
			);
		} catch {
			// Keep the last known status; the next manual or section refresh can retry.
		} finally {
			setCodexStatusLoading(false);
		}
	}, []);

	useEffect(() => {
		if (section !== "providers" && section !== "routing") return;
		void refreshCodexStatus();
	}, [section, refreshCodexStatus]);

	const updateEndpoint = (id: string, patch: Partial<LlmProviderEndpoint>) => {
		setHealthResults((current) => {
			if (!(id in current)) return current;
			const next = { ...current };
			delete next[id];
			return next;
		});
		onChange(
			"providerEndpoints",
			settings.providerEndpoints.map((endpoint) =>
				endpoint.id === id ? { ...endpoint, ...patch } : endpoint,
			),
		);
	};

	const updateCodexEnabled = (enabled: boolean) => {
		onChange("CODEX_ENABLED", enabled);
		onChange(
			"providerEndpoints",
			settings.providerEndpoints.map((endpoint) =>
				endpoint.kind === "codex" ? { ...endpoint, enabled } : endpoint,
			),
		);
	};

	const addEndpoint = () => {
		onChange("providerEndpoints", [
			...settings.providerEndpoints,
			{
				id: createEndpointId(),
				name: "Local LLM",
				kind: "local",
				enabled: true,
				apiKey: "",
				baseUrl: "http://localhost:11434/v1",
				endpoint: "",
				apiVersion: "",
				region: "",
				models: ["qwen3-coder"],
				modelDisplayNames: {},
			},
		]);
	};

	const removeEndpoint = (id: string) => {
		onChange(
			"providerEndpoints",
			settings.providerEndpoints.filter((endpoint) => endpoint.id !== id),
		);
		onChange(
			"roleRoutes",
			settings.roleRoutes.map((route) => ({
				...route,
				primary:
					route.primary.providerEndpointId === id
						? emptyModelTarget
						: route.primary,
				fallbacks: route.fallbacks.filter(
					(target) => target.providerEndpointId !== id,
				),
			})),
		);
	};

	const checkEndpointHealth = async (endpoint: LlmProviderEndpoint) => {
		setHealthBusyEndpointId(endpoint.id);
		try {
			const result = await readJsonResponse<LlmProviderHealthResult>(
				await testLlmProviderHealth(endpoint.id, endpoint),
			);
			setHealthResults((current) => ({ ...current, [endpoint.id]: result }));
		} catch (error) {
			setHealthResults((current) => ({
				...current,
				[endpoint.id]: {
					ok: false,
					reachable: false,
					providerEndpointId: endpoint.id,
					providerKind: endpoint.kind,
					url: null,
					status: null,
					durationMs: 0,
					checkedAt: new Date().toISOString(),
					message: error instanceof Error ? error.message : String(error),
				},
			}));
		} finally {
			setHealthBusyEndpointId(null);
		}
	};

	const updateRoleRoute = (role: LlmRole, patch: Partial<LlmRoleRoute>) => {
		onChange(
			"roleRoutes",
			settings.roleRoutes.map((route) =>
				route.role === role ? { ...route, ...patch } : route,
			),
		);
	};

	const updateFallback = (
		route: LlmRoleRoute,
		index: number,
		target: LlmModelTarget,
	) => {
		updateRoleRoute(route.role, {
			fallbacks: route.fallbacks.map((fallback, fallbackIndex) =>
				fallbackIndex === index
					? withThinkingDepth(target, target.thinkingDepth || "")
					: fallback,
			),
		});
	};

	const updateTargetThinkingDepth = (
		route: LlmRoleRoute,
		targetKey: "primary" | "fallback",
		thinkingDepth: "" | ThinkingDepth,
		fallbackIndex?: number,
	) => {
		if (targetKey === "primary") {
			updateRoleRoute(route.role, {
				primary: withThinkingDepth(route.primary, thinkingDepth),
			});
			return;
		}
		if (fallbackIndex === undefined) return;
		updateFallback(
			route,
			fallbackIndex,
			withThinkingDepth(route.fallbacks[fallbackIndex], thinkingDepth),
		);
	};

	const updateTargetRequestTimeout = (
		route: LlmRoleRoute,
		targetKey: "primary" | "fallback",
		requestTimeoutSeconds: number,
		fallbackIndex?: number,
	) => {
		if (targetKey === "primary") {
			updateRoleRoute(route.role, {
				primary: { ...route.primary, requestTimeoutSeconds },
			});
			return;
		}
		if (fallbackIndex === undefined) return;
		updateFallback(route, fallbackIndex, {
			...route.fallbacks[fallbackIndex],
			requestTimeoutSeconds,
		});
	};

	const moveFallback = (
		route: LlmRoleRoute,
		index: number,
		direction: -1 | 1,
	) => {
		const nextIndex = index + direction;
		if (nextIndex < 0 || nextIndex >= route.fallbacks.length) return;
		const fallbacks = [...route.fallbacks];
		[fallbacks[index], fallbacks[nextIndex]] = [
			fallbacks[nextIndex],
			fallbacks[index],
		];
		updateRoleRoute(route.role, { fallbacks });
	};

	return {
		codexStatus,
		codexStatusLoading,
		healthBusyEndpointId,
		healthResults,
		genericProviderEndpoints,
		codexModelOptions,
		modelTargetOptions,
		refreshCodexStatus,
		updateEndpoint,
		updateCodexEnabled,
		addEndpoint,
		removeEndpoint,
		checkEndpointHealth,
		updateRoleRoute,
		updateFallback,
		updateTargetThinkingDepth,
		updateTargetRequestTimeout,
		moveFallback,
	};
}

function createEndpointId() {
	if (!globalThis.crypto?.getRandomValues)
		return `ep_${Date.now().toString(16)}`;
	const bytes = new Uint8Array(8);
	globalThis.crypto.getRandomValues(bytes);
	const hex = [...bytes]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
	return `ep_${hex}`;
}
