import { Plus, RefreshCw, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import {
	DEFAULT_LLM_REQUEST_TIMEOUT_SECONDS,
	MAX_LLM_REQUEST_TIMEOUT_SECONDS,
	MIN_LLM_REQUEST_TIMEOUT_SECONDS,
} from "../../../shared/llm-role";
import type { LlmSettings, ThinkingDepth } from "../nightworkers/types";
import { Field, NumberField, SelectField } from "./SettingsFields";
import { SettingsLlmProviderEndpoints } from "./SettingsLlmProviderEndpoints";
import {
	codexAuthSourceKey,
	emptyModelTarget,
	isThinkingModel,
	modelTargetFromKey,
	modelTargetKey,
	roleLabelKeys,
	thinkingDepthValues,
	withThinkingDepth,
} from "./SettingsLlmRoutingModel";
import { SettingsSaveActions } from "./SettingsSaveActions";
import { useSettingsLlmPanelController } from "./useSettingsLlmPanelController";

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
	const {
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
	} = useSettingsLlmPanelController({ section, settings, onChange });
	const modelTargetOptionsWithNone = [
		{ value: modelTargetKey(emptyModelTarget), label: t("settings.llm.none") },
		...modelTargetOptions,
	];
	const roleRoutes = settings.roleRoutes;
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
						<p className="mt-1 text-[11px] text-zinc-600">
							{t("settings.llm.requestTimeoutHelp")}
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
									<div className="grid grid-cols-1 items-end gap-2 md:grid-cols-[minmax(0,1fr)_minmax(10rem,12rem)_minmax(10rem,12rem)]">
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
														{
															...modelTargetFromKey(value),
															requestTimeoutSeconds:
																route.primary.requestTimeoutSeconds,
														},
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
										) : (
											<div className="hidden md:block" />
										)}
										<NumberField
											id={`${route.role}-primary-request-timeout`}
											label={t("settings.llm.requestTimeout")}
											value={
												route.primary.requestTimeoutSeconds ??
												DEFAULT_LLM_REQUEST_TIMEOUT_SECONDS
											}
											min={MIN_LLM_REQUEST_TIMEOUT_SECONDS}
											max={MAX_LLM_REQUEST_TIMEOUT_SECONDS}
											clampOnBlur
											onChange={(value) =>
												updateTargetRequestTimeout(route, "primary", value)
											}
										/>
									</div>
									{route.fallbacks.length ? (
										<div className="grid gap-2">
											{route.fallbacks.map((fallback, index) => (
												<div
													key={`${route.role}-fallback-${modelTargetKey(fallback)}-${fallback.thinkingDepth || "auto"}`}
													className="grid grid-cols-1 items-end gap-2 md:grid-cols-[minmax(0,1fr)_minmax(10rem,12rem)_minmax(10rem,12rem)_auto_auto_auto]"
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
																	{
																		...modelTargetFromKey(value),
																		requestTimeoutSeconds:
																			fallback.requestTimeoutSeconds,
																	},
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
													<NumberField
														id={`${route.role}-fallback-${index}-request-timeout`}
														label={t("settings.llm.requestTimeout")}
														value={
															fallback.requestTimeoutSeconds ??
															DEFAULT_LLM_REQUEST_TIMEOUT_SECONDS
														}
														min={MIN_LLM_REQUEST_TIMEOUT_SECONDS}
														max={MAX_LLM_REQUEST_TIMEOUT_SECONDS}
														clampOnBlur
														onChange={(value) =>
															updateTargetRequestTimeout(
																route,
																"fallback",
																value,
																index,
															)
														}
													/>
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
									onChange={(event) => updateCodexEnabled(event.target.checked)}
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
