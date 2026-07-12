import { Plus, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
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
import { Field, SelectField } from "./SettingsFields";
import { SettingsLlmProviderEndpoints } from "./SettingsLlmProviderEndpoints";
import {
	codexAuthSourceKey,
	emptyModelTarget,
	formatModelTargetLabel,
	isThinkingModel,
	modelTargetFromKey,
	modelTargetKey,
	roleLabelKeys,
	thinkingDepthValues,
	uniqueModelOptions,
	withThinkingDepth,
} from "./SettingsLlmRoutingModel";
import { SettingsSaveActions } from "./SettingsSaveActions";
import { fetchCodexSdkStatus, testLlmProviderHealth } from "./settingsCommands";

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

export function SettingsLlmPanel({
	section,
	settings,
	isSaving,
	saveStatus,
	saveMessage,
	onChange,
	handleSave,
}: {
	section: "providers" | "routing";
	settings: LlmSettings;
	isSaving: boolean;
	saveStatus: "idle" | "success" | "error";
	saveMessage: string;
	onChange: <K extends keyof LlmSettings>(
		key: K,
		value: LlmSettings[K],
	) => void;
	handleSave: () => Promise<void>;
}) {
	const { t } = useTranslation();
	const thinkingDepthOptions = thinkingDepthValues.map((value) => ({
		value,
		label: t(`settings.llm.thinking.${value || "auto"}`),
	}));
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
	const modelTargetOptionsWithNone = [
		{ value: modelTargetKey(emptyModelTarget), label: t("settings.llm.none") },
		...modelTargetOptions,
	];
	const roleRoutes = settings.roleRoutes;

	const refreshCodexStatus = useCallback(async () => {
		setCodexStatusLoading(true);
		try {
			const res = await fetchCodexSdkStatus();
			if (!res.ok) return;
			setCodexStatus((await res.json()) as CodexSdkStatus);
		} finally {
			setCodexStatusLoading(false);
		}
	}, []);

	useEffect(() => {
		if (section !== "providers" && section !== "routing") return;
		void refreshCodexStatus();
	}, [section, refreshCodexStatus]);

	const updateEndpoint = (id: string, patch: Partial<LlmProviderEndpoint>) => {
		onChange(
			"providerEndpoints",
			settings.providerEndpoints.map((endpoint) =>
				endpoint.id === id ? { ...endpoint, ...patch } : endpoint,
			),
		);
	};

	const addEndpoint = () => {
		const id = createEndpointId();
		onChange("providerEndpoints", [
			...settings.providerEndpoints,
			{
				id,
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
			const res = await testLlmProviderHealth(endpoint.id, endpoint);
			if (!res.ok) throw new Error(await res.text());
			const result = (await res.json()) as LlmProviderHealthResult;
			setHealthResults((current) => ({ ...current, [endpoint.id]: result }));
		} catch (err) {
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
					message: err instanceof Error ? err.message : String(err),
				},
			}));
		} finally {
			setHealthBusyEndpointId(null);
		}
	};

	const updateRoleRoute = (role: LlmRole, patch: Partial<LlmRoleRoute>) => {
		onChange(
			"roleRoutes",
			roleRoutes.map((route) =>
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

	return (
		<div className="grid gap-4">
			<SettingsSaveActions
				onSave={() => void handleSave()}
				isSaving={isSaving}
				saveStatus={saveStatus}
				saveMessage={saveMessage}
			/>
			{section === "providers" ? (
				<SettingsLlmProviderEndpoints
					genericProviderEndpoints={genericProviderEndpoints}
					healthResults={healthResults}
					healthBusyEndpointId={healthBusyEndpointId}
					addEndpoint={addEndpoint}
					updateEndpoint={updateEndpoint}
					removeEndpoint={removeEndpoint}
					checkEndpointHealth={checkEndpointHealth}
				/>
			) : null}

			{section === "routing" ? (
				<section className="space-y-4 rounded-2xl border border-zinc-800/60 bg-[#16161a] p-6">
					<div>
						<h2 className="text-sm font-semibold text-zinc-100">
							{t("settings.llm.routing.title")}
						</h2>
						<p className="mt-1 text-xs text-zinc-500">
							{t("settings.llm.routing.description")}
						</p>
					</div>
					<div className="grid gap-3">
						{roleRoutes.map((route) => {
							return (
								<div
									key={route.role}
									className="grid gap-3 rounded-xl border border-zinc-800 bg-zinc-950/30 p-4"
								>
									<div className="flex items-center justify-between gap-3">
										<div className="text-xs font-semibold text-zinc-200">
											{t(roleLabelKeys[route.role])}
										</div>
										<Button
											type="button"
											size="sm"
											variant="secondary"
											icon={Plus}
											onClick={() =>
												updateRoleRoute(route.role, {
													fallbacks: [
														...route.fallbacks,
														modelTargetFromKey(
															modelTargetOptions[0]?.value || "",
														),
													],
												})
											}
										>
											{t("settings.llm.fallback.add")}
										</Button>
									</div>
									<div className="grid grid-cols-1 items-end gap-2 md:grid-cols-[minmax(0,1fr)_minmax(10rem,12rem)]">
										<SelectField
											id={`${route.role}-primary-model-target`}
											label={t("settings.llm.primaryModel")}
											value={modelTargetKey(route.primary)}
											options={
												modelTargetOptions.length
													? modelTargetOptions
													: [
															{
																value: modelTargetKey(emptyModelTarget),
																label: t("settings.llm.noModelTargets"),
															},
														]
											}
											onChange={(value) =>
												updateRoleRoute(route.role, {
													primary: withThinkingDepth(
														modelTargetFromKey(value),
														route.primary.thinkingDepth || "",
													),
												})
											}
										/>
										{isThinkingModel(route.primary.model) ? (
											<SelectField
												id={`${route.role}-primary-thinking-depth`}
												label={t("settings.llm.thinking.title")}
												value={route.primary.thinkingDepth || ""}
												options={thinkingDepthOptions}
												onChange={(value) =>
													updateTargetThinkingDepth(
														route,
														"primary",
														value as "" | ThinkingDepth,
													)
												}
											/>
										) : null}
									</div>
									{route.fallbacks.length ? (
										<div className="grid gap-2">
											{route.fallbacks.map((fallback, index) => (
												<div
													key={`${route.role}-fallback-${modelTargetKey(fallback)}-${fallback.thinkingDepth || "auto"}`}
													className="grid grid-cols-1 items-end gap-2 md:grid-cols-[minmax(0,1fr)_minmax(10rem,12rem)_auto_auto_auto]"
												>
													<SelectField
														id={`${route.role}-fallback-${index}`}
														label={t("settings.llm.fallback.item", {
															index: index + 1,
														})}
														value={modelTargetKey(fallback)}
														options={modelTargetOptionsWithNone}
														onChange={(value) =>
															updateFallback(
																route,
																index,
																withThinkingDepth(
																	modelTargetFromKey(value),
																	fallback.thinkingDepth || "",
																),
															)
														}
													/>
													{isThinkingModel(fallback.model) ? (
														<SelectField
															id={`${route.role}-fallback-${index}-thinking-depth`}
															label={t("settings.llm.thinking.title")}
															value={fallback.thinkingDepth || ""}
															options={thinkingDepthOptions}
															onChange={(value) =>
																updateTargetThinkingDepth(
																	route,
																	"fallback",
																	value as "" | ThinkingDepth,
																	index,
																)
															}
														/>
													) : (
														<div className="hidden md:block" />
													)}
													<Button
														type="button"
														size="sm"
														variant="ghost"
														disabled={index === 0}
														onClick={() => moveFallback(route, index, -1)}
													>
														{t("settings.llm.fallback.moveUp")}
													</Button>
													<Button
														type="button"
														size="sm"
														variant="ghost"
														disabled={index === route.fallbacks.length - 1}
														onClick={() => moveFallback(route, index, 1)}
													>
														{t("settings.llm.fallback.moveDown")}
													</Button>
													<Button
														type="button"
														size="icon"
														variant="ghost"
														title={t("settings.llm.fallback.remove")}
														onClick={() =>
															updateRoleRoute(route.role, {
																fallbacks: route.fallbacks.filter(
																	(_fallback, fallbackIndex) =>
																		fallbackIndex !== index,
																),
															})
														}
													>
														<Trash2 className="h-4 w-4" />
													</Button>
												</div>
											))}
										</div>
									) : null}
								</div>
							);
						})}
					</div>
				</section>
			) : null}

			{section === "providers" ? (
				<section className="space-y-4 rounded-2xl border border-zinc-800/60 bg-[#16161a] p-6">
					<div className="flex items-start justify-between gap-3">
						<div>
							<h2 className="text-sm font-semibold text-zinc-100">Codex SDK</h2>
							<p className="mt-1 text-xs text-zinc-500">
								{t("settings.llm.codex.description")}
							</p>
						</div>
						<Button
							type="button"
							size="sm"
							variant="secondary"
							icon={RefreshCw}
							disabled={codexStatusLoading}
							onClick={() => void refreshCodexStatus()}
						>
							{t("settings.llm.refresh")}
						</Button>
					</div>
					<div className="grid gap-3 rounded-xl border border-zinc-800 bg-zinc-950/30 p-4">
						<div className="flex flex-wrap items-center justify-between gap-3">
							<label className="inline-flex items-center gap-2 text-xs text-zinc-300">
								<input
									type="checkbox"
									checked={settings.CODEX_ENABLED}
									onChange={(event) =>
										onChange("CODEX_ENABLED", event.target.checked)
									}
								/>
								{t("settings.llm.codex.enable")}
							</label>
							<span
								className={`rounded-full border px-2 py-1 text-[11px] ${
									codexStatus?.loggedIn
										? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
										: "border-zinc-700 bg-zinc-900 text-zinc-400"
								}`}
							>
								{codexStatusLoading
									? t("settings.llm.codex.checking")
									: codexStatus?.loggedIn
										? t("settings.llm.codex.loggedIn", {
												source: t(codexAuthSourceKey(codexStatus)),
											})
										: t(codexAuthSourceKey(codexStatus))}
							</span>
						</div>
						{codexStatus ? (
							<div className="grid gap-1 text-[11px] text-zinc-500">
								<div>
									{t("settings.llm.codex.home", {
										path: codexStatus.codexHome,
									})}
								</div>
								<div>
									{t("settings.llm.codex.models", {
										count: codexStatus.models.length,
										source: codexStatus.modelSource,
									})}
								</div>
							</div>
						) : null}
					</div>
					<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
						<SelectField
							id="codex-model"
							label={t("settings.field.modelName")}
							value={settings.CODEX_MODEL}
							options={
								codexModelOptions.length
									? codexModelOptions
									: [{ value: "", label: t("settings.llm.none") }]
							}
							onChange={(v) => onChange("CODEX_MODEL", v)}
						/>
						<Field
							id="codex-access-token"
							label={t("settings.llm.codex.accessTokenOverride")}
							type="password"
							value={settings.CODEX_ACCESS_TOKEN}
							onChange={(v) => onChange("CODEX_ACCESS_TOKEN", v)}
						/>
					</div>
				</section>
			) : null}

			<SettingsSaveActions
				onSave={() => void handleSave()}
				isSaving={isSaving}
				saveStatus={saveStatus}
				saveMessage={saveMessage}
			/>
		</div>
	);
}
