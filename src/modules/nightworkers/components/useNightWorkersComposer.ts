import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { WorkbenchLlmSelection } from "../hooks/nightWorkersWorkspaceState";
import type { NightWorkersWorkspaceState } from "../hooks/useNightWorkersWorkspace";
import type { ComposerThinkingDepth, ThinkingDepthOption } from "../types";
import {
	COMPOSER_THINKING_DEPTH_OPTIONS,
	findComposerRouteTargetByKey,
	isThinkingModel,
	modelTargetKey,
	parseModelTargetKey,
	resolveActiveComposerRouteTarget,
	resolveComposerRouteTarget,
	resolveCurrentProviderModel,
} from "./nightworkers-shell-utils";

export function useNightWorkersComposer(workspace: NightWorkersWorkspaceState) {
	const previousActiveSessionIdRef = useRef<string | null>(null);
	const preserveComposerOverrideSessionIdRef = useRef<string | null>(null);
	const userSelectedComposerModelRef = useRef(false);
	const [model, setModel] = useState("");
	const [thinkingDepth, setThinkingDepth] = useState<ComposerThinkingDepth>("");
	const activeSessionId = workspace.activeSessionId;

	if (previousActiveSessionIdRef.current !== activeSessionId) {
		previousActiveSessionIdRef.current = activeSessionId;
		const preserveOverride =
			Boolean(activeSessionId) &&
			preserveComposerOverrideSessionIdRef.current === activeSessionId;
		preserveComposerOverrideSessionIdRef.current = null;
		if (!preserveOverride) userSelectedComposerModelRef.current = false;
	}

	const currentProviderModel = resolveCurrentProviderModel(workspace);
	const activeComposerRouteTarget = useMemo(
		() =>
			resolveActiveComposerRouteTarget({
				activeSessionId: workspace.activeSessionId,
				latestRun: workspace.latestRun,
				latestRunEvents: workspace.latestRunEvents,
			}),
		[workspace.activeSessionId, workspace.latestRun, workspace.latestRunEvents],
	);
	const composerModelOptions = useMemo(() => {
		const endpoints = workspace.llmSettings?.providerEndpoints || [];
		const endpointOptions = endpoints
			.filter((endpoint) =>
				endpoint.kind === "codex"
					? workspace.llmSettings?.CODEX_ENABLED && endpoint.enabled
					: endpoint.enabled,
			)
			.flatMap((endpoint) =>
				endpoint.models.map((endpointModel) => ({
					value: modelTargetKey({
						providerEndpointId: endpoint.id,
						model: endpointModel,
					}),
					label:
						endpoint.modelDisplayNames?.[endpointModel]?.trim() ||
						`${endpointModel} (${endpoint.name})`,
				})),
			);
		const options = endpointOptions.length
			? endpointOptions
			: workspace.providerModelOptions;
		if (!activeComposerRouteTarget) return options;
		const activeKey = modelTargetKey(activeComposerRouteTarget);
		if (options.some((option) => option.value === activeKey)) return options;
		const activeEndpoint = endpoints.find(
			(endpoint) =>
				endpoint.id === activeComposerRouteTarget.providerEndpointId,
		);
		return [
			...options,
			{
				value: activeKey,
				label:
					activeEndpoint?.modelDisplayNames?.[
						activeComposerRouteTarget.model
					]?.trim() ||
					(activeEndpoint
						? `${activeComposerRouteTarget.model} (${activeEndpoint.name})`
						: activeComposerRouteTarget.model),
			},
		];
	}, [
		activeComposerRouteTarget,
		workspace.llmSettings,
		workspace.providerModelOptions,
	]);
	const composerModelOptionKeys = useMemo(
		() => new Set(composerModelOptions.map((option) => option.value)),
		[composerModelOptions],
	);
	const preferredRouteTarget = useMemo(
		() =>
			activeComposerRouteTarget ||
			resolveComposerRouteTarget(
				workspace.llmSettings?.roleRoutes,
				composerModelOptionKeys,
			),
		[
			activeComposerRouteTarget,
			composerModelOptionKeys,
			workspace.llmSettings?.roleRoutes,
		],
	);
	const selectedModelTarget = parseModelTargetKey(model);
	const selectedComposerModel =
		selectedModelTarget?.model || model || currentProviderModel || "";
	const selectedComposerModelSupportsThinking = isThinkingModel(
		selectedComposerModel,
	);
	const composerThinkingDepthOptions: ThinkingDepthOption[] =
		selectedComposerModelSupportsThinking
			? COMPOSER_THINKING_DEPTH_OPTIONS
			: [];

	useEffect(() => {
		if (!composerModelOptions.length) {
			if (
				!userSelectedComposerModelRef.current &&
				currentProviderModel &&
				model !== currentProviderModel
			) {
				setModel(currentProviderModel);
			}
			return;
		}
		const currentModelIsAvailable = composerModelOptionKeys.has(model);
		if (
			userSelectedComposerModelRef.current &&
			currentModelIsAvailable &&
			!activeComposerRouteTarget
		)
			return;
		if (!currentModelIsAvailable) userSelectedComposerModelRef.current = false;
		const nextModel = preferredRouteTarget
			? modelTargetKey(preferredRouteTarget)
			: composerModelOptions[0].value;
		if (model !== nextModel) setModel(nextModel);
		const nextThinkingDepth =
			preferredRouteTarget && isThinkingModel(preferredRouteTarget.model)
				? (preferredRouteTarget.thinkingDepth ?? "")
				: "";
		if (thinkingDepth !== nextThinkingDepth)
			setThinkingDepth(nextThinkingDepth);
	}, [
		activeComposerRouteTarget,
		composerModelOptionKeys,
		composerModelOptions,
		currentProviderModel,
		model,
		preferredRouteTarget,
		thinkingDepth,
	]);

	useEffect(() => {
		if (selectedComposerModelSupportsThinking) return;
		setThinkingDepth("");
	}, [selectedComposerModelSupportsThinking]);

	const buildComposerLlmSelection = useCallback(():
		| WorkbenchLlmSelection
		| undefined => {
		if (!userSelectedComposerModelRef.current) return undefined;
		const target = parseModelTargetKey(model);
		const selected = target || { providerEndpointId: "", model };
		if (!selected.model) return undefined;
		return {
			model: selected.model,
			providerEndpointId: selected.providerEndpointId || undefined,
			thinkingDepth: isThinkingModel(selected.model)
				? thinkingDepth
				: undefined,
		};
	}, [model, thinkingDepth]);
	const clearComposerLlmSelectionOverride = useCallback(() => {
		userSelectedComposerModelRef.current = false;
		if (!preferredRouteTarget) return;
		setModel(modelTargetKey(preferredRouteTarget));
		setThinkingDepth(
			isThinkingModel(preferredRouteTarget.model)
				? (preferredRouteTarget.thinkingDepth ?? "")
				: "",
		);
	}, [preferredRouteTarget]);
	const handleComposerModelChange = useCallback(
		(nextModel: string) => {
			if (activeComposerRouteTarget) return;
			userSelectedComposerModelRef.current = true;
			setModel(nextModel);
			const routeTarget = findComposerRouteTargetByKey(
				workspace.llmSettings?.roleRoutes,
				nextModel,
			);
			const parsedTarget = parseModelTargetKey(nextModel);
			const nextTargetModel =
				routeTarget?.model || parsedTarget?.model || nextModel;
			setThinkingDepth(
				routeTarget && isThinkingModel(nextTargetModel)
					? (routeTarget.thinkingDepth ?? "")
					: "",
			);
		},
		[activeComposerRouteTarget, workspace.llmSettings?.roleRoutes],
	);
	const handleComposerThinkingDepthChange = useCallback(
		(nextThinkingDepth: ComposerThinkingDepth) => {
			if (activeComposerRouteTarget) return;
			userSelectedComposerModelRef.current = true;
			setThinkingDepth(nextThinkingDepth);
		},
		[activeComposerRouteTarget],
	);

	return {
		model,
		thinkingDepth,
		composerModelOptions,
		composerThinkingDepthOptions,
		buildComposerLlmSelection,
		clearComposerLlmSelectionOverride,
		handleComposerModelChange,
		handleComposerThinkingDepthChange,
		preserveComposerOverrideSessionIdRef,
	};
}
