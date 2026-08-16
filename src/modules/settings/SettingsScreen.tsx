import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { applyAppLanguage } from "../../i18n/I18nProvider";
import { ApiResponseError, readJsonResponse } from "../../lib/api-error";
import {
	AppearanceSettings,
	createBlueprintPreviewDesignSettings,
} from "../blueprint-preview";
import { SettingsHooksPanel } from "../hooks/SettingsHooksPanel";
import { SettingsMcpPanel } from "../mcp/SettingsMcpPanel";
import {
	useWorkspaceAppearanceActions,
	useWorkspaceAppearanceState,
} from "../nightworkers/contexts/WorkspaceAppearanceContext";
import { handleWorkbenchAnchorClick } from "../nightworkers/routing/workbench-link-click";
import { serializeWorkbenchRoute } from "../nightworkers/routing/workbench-route-state";
import type {
	FxRateCache,
	GeneralSettings,
	LlmSettings,
	Repository,
} from "../nightworkers/types";
import {
	SettingsOntologyPanel,
	SettingsProjectExplorationPanel,
} from "../ontology";
import { SettingsVulnerabilityScanProviderPanel } from "../securityScan";
import {
	llmSettingsQueryKeys,
	llmSettingsQueryOptions,
	readNormalizedLlmSettings,
} from "./llm-settings-query";
import { GeneralSettingsPanel } from "./SettingsGeneralPanel";
import { SettingsLlmPanel } from "./SettingsLlmPanel";
import { SettingsPlanModePanel } from "./SettingsPlanModePanel";
import { SettingsSaveActions } from "./SettingsSaveActions";
import { defaultSettings } from "./settings-defaults";
import {
	fxRateCacheQueryOptions,
	generalSettingsQueryOptions,
	settingsResourceQueryKeys,
} from "./settings-resource-queries";
import {
	refreshFxRates as refreshFxRatesCommand,
	saveGeneralSettings as saveGeneralSettingsCommand,
	saveLlmSettings,
} from "./settingsCommands";
import { useProjectIntelligenceSettings } from "./useProjectIntelligenceSettings";

type SaveFeedbackStatus = "idle" | "success" | "error";

import {
	defaultGeneralSettings,
	mergeGeneralSettings,
	type SettingsSectionId,
	settingsSections,
} from "./SettingsForms";

export function SettingsScreen({
	activeProject,
	activeSection = "general",
	onSectionChange,
	onClose,
}: {
	activeProject: Repository | null;
	activeSection?: SettingsSectionId;
	onSectionChange?: (section: SettingsSectionId) => void;
	onClose: () => void;
}) {
	const { t } = useTranslation();
	const queryClient = useQueryClient();
	const llmSettingsQuery = useQuery(llmSettingsQueryOptions());
	const generalSettingsQuery = useQuery(generalSettingsQueryOptions());
	const fxRateCacheQuery = useQuery(fxRateCacheQueryOptions());
	const [settings, setSettings] = useState<LlmSettings>(defaultSettings);
	const [generalSettings, setGeneralSettings] = useState<GeneralSettings>(
		defaultGeneralSettings,
	);
	const [isSaving, setIsSaving] = useState(false);
	const [llmSaveStatus, setLlmSaveStatus] =
		useState<SaveFeedbackStatus>("idle");
	const [llmSaveMessage, setLlmSaveMessage] = useState("");
	const [generalMessage, setGeneralMessage] = useState("");
	const [generalMessageStatus, setGeneralMessageStatus] =
		useState<SaveFeedbackStatus>("idle");
	const [isRefreshingFx, setIsRefreshingFx] = useState(false);
	const [isSavingGeneral, setIsSavingGeneral] = useState(false);
	const {
		securityIntelligence,
		securityMessage: securityIntelligenceMessage,
		securityMessageStatus: securityIntelligenceMessageStatus,
		securityBusy: securityIntelligenceBusy,
		changeSecurityIntelligence,
		saveSecurityIntelligence,
		projectExploration,
		explorationMessage: projectExplorationMessage,
		explorationMessageStatus: projectExplorationMessageStatus,
		explorationBusy: projectExplorationBusy,
		mcpServers,
		explorationConfigurationValid: projectExplorationConfigurationValid,
		changeProjectExploration,
		saveProjectExploration,
	} = useProjectIntelligenceSettings(activeProject);
	const {
		settings: appearanceSettings,
		savedSettings: savedAppearanceSettings,
	} = useWorkspaceAppearanceState();
	const [appearanceDraft, setAppearanceDraft] = useState(appearanceSettings);
	const [appearanceMessage, setAppearanceMessage] = useState("");
	const [appearanceMessageStatus, setAppearanceMessageStatus] =
		useState<SaveFeedbackStatus>("idle");
	const [isLlmDraftInitialized, setIsLlmDraftInitialized] = useState(false);
	const [isLlmDraftDirty, setIsLlmDraftDirty] = useState(false);
	const generalDraftStateRef = useRef({ initialized: false, dirty: false });
	const {
		applyAppearanceSettings,
		saveAppearanceSettings: persistAppearanceSettings,
	} = useWorkspaceAppearanceActions();

	useEffect(() => {
		if (activeSection === "appearance") return;
		setAppearanceDraft(appearanceSettings);
	}, [activeSection, appearanceSettings]);

	const activeSectionMeta =
		settingsSections.find((section) => section.id === activeSection) ||
		settingsSections[0];
	const ActiveSectionIcon = activeSectionMeta.icon;

	useEffect(() => {
		if (!llmSettingsQuery.data || (isLlmDraftInitialized && isLlmDraftDirty))
			return;
		setSettings(llmSettingsQuery.data);
		if (!isLlmDraftInitialized) setIsLlmDraftInitialized(true);
	}, [isLlmDraftDirty, isLlmDraftInitialized, llmSettingsQuery.data]);

	useEffect(() => {
		if (!generalSettingsQuery.data || generalDraftStateRef.current.dirty)
			return;
		setGeneralSettings(generalSettingsQuery.data);
		generalDraftStateRef.current.initialized = true;
	}, [generalSettingsQuery.data]);

	const handleSave = async () => {
		setIsSaving(true);
		setLlmSaveStatus("idle");
		setLlmSaveMessage("");
		try {
			const res = await saveLlmSettings(settings);
			const saved = await readNormalizedLlmSettings(res);
			queryClient.setQueryData(llmSettingsQueryKeys.settings, saved);
			setSettings(saved);
			setIsLlmDraftDirty(false);
			setLlmSaveStatus("success");
			setLlmSaveMessage(t("settings.saveSucceeded"));
		} catch (err) {
			setLlmSaveStatus("error");
			setLlmSaveMessage(
				err instanceof ApiResponseError
					? t("settings.saveFailedWithStatus", { status: err.status })
					: err instanceof Error
						? err.message
						: String(err),
			);
		} finally {
			setIsSaving(false);
		}
	};

	const onChange = <K extends keyof LlmSettings>(
		key: K,
		value: LlmSettings[K],
	) => {
		setLlmSaveStatus("idle");
		setLlmSaveMessage("");
		setIsLlmDraftDirty(true);
		setSettings((prev) => ({ ...prev, [key]: value }));
	};

	const saveGeneralSettings = async () => {
		setIsSavingGeneral(true);
		setGeneralMessage("");
		setGeneralMessageStatus("idle");
		try {
			const saved = mergeGeneralSettings(
				await readJsonResponse<Partial<GeneralSettings>>(
					await saveGeneralSettingsCommand(generalSettings),
				),
			);
			setGeneralSettings(saved);
			queryClient.setQueryData(settingsResourceQueryKeys.general, saved);
			generalDraftStateRef.current.dirty = false;
			void applyAppLanguage(saved.language);
			setGeneralMessage(t("settings.general.saveSucceeded"));
			setGeneralMessageStatus("success");
		} catch (error) {
			setGeneralMessage(
				error instanceof ApiResponseError
					? t("settings.general.saveFailed")
					: error instanceof Error
						? error.message
						: t("settings.general.saveFailed"),
			);
			setGeneralMessageStatus("error");
		} finally {
			setIsSavingGeneral(false);
		}
	};

	const refreshFxRates = async () => {
		setIsRefreshingFx(true);
		setGeneralMessage("");
		setGeneralMessageStatus("idle");
		try {
			const cache = await readJsonResponse<FxRateCache>(
				await refreshFxRatesCommand(),
			);
			queryClient.setQueryData(settingsResourceQueryKeys.fxRates, cache);
			setGeneralSettings((prev) => ({
				...prev,
				fx: { ...prev.fx, source: "ecb", lastRefreshedAt: cache.fetchedAt },
			}));
			setGeneralMessage(t("settings.general.exchangeRefreshSucceeded"));
			setGeneralMessageStatus("success");
		} catch (err) {
			setGeneralMessage(
				err instanceof ApiResponseError
					? t("settings.general.exchangeRefreshFailed", {
							status: err.status,
						})
					: err instanceof Error
						? err.message
						: String(err),
			);
			setGeneralMessageStatus("error");
		} finally {
			setIsRefreshingFx(false);
		}
	};

	const onGeneralSettingsChange = (next: GeneralSettings) => {
		generalDraftStateRef.current.dirty = true;
		setGeneralSettings(next);
	};

	const renderGeneralResourceErrors = () => (
		<>
			{generalSettingsQuery.isError ? (
				<div
					className="rounded-lg border border-rose-500/50 bg-rose-950/30 p-3 text-sm text-rose-100"
					role="alert"
				>
					<span>
						{generalSettingsQuery.error instanceof Error
							? generalSettingsQuery.error.message
							: t("settings.general.loadFailed")}
					</span>
					<button
						type="button"
						className="ml-3 underline"
						onClick={() => void generalSettingsQuery.refetch()}
					>
						{t("settings.general.retry")}
					</button>
				</div>
			) : null}
			{fxRateCacheQuery.isError ? (
				<div
					className="rounded-lg border border-amber-500/50 bg-amber-950/30 p-3 text-sm text-amber-100"
					role="alert"
				>
					<span>
						{fxRateCacheQuery.error instanceof Error
							? fxRateCacheQuery.error.message
							: t("settings.general.fxLoadFailed")}
					</span>
					<button
						type="button"
						className="ml-3 underline"
						onClick={() => void fxRateCacheQuery.refetch()}
					>
						{t("settings.general.retry")}
					</button>
				</div>
			) : null}
		</>
	);

	const saveAppearanceSettings = () => {
		persistAppearanceSettings(appearanceDraft);
		setAppearanceMessage(t("settings.saveSucceeded"));
		setAppearanceMessageStatus("success");
	};

	const updateAppearanceDraft = (next: typeof appearanceDraft) => {
		setAppearanceDraft(next);
		applyAppearanceSettings(next);
		setAppearanceMessage("");
		setAppearanceMessageStatus("idle");
	};

	const cancelAppearanceSettings = () => {
		applyAppearanceSettings(savedAppearanceSettings);
		setAppearanceDraft(savedAppearanceSettings);
		setAppearanceMessage("");
		setAppearanceMessageStatus("idle");
	};

	const resetAppearanceDraft = () => {
		updateAppearanceDraft(createBlueprintPreviewDesignSettings(undefined));
	};

	const renderAppearanceSecondaryActions = () => (
		<>
			<button
				type="button"
				className="rounded-lg border border-zinc-700/50 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-300"
				onClick={resetAppearanceDraft}
			>
				{t("settings.appearance.reset")}
			</button>
			<button
				type="button"
				className="rounded-lg border border-zinc-700/50 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-300"
				onClick={cancelAppearanceSettings}
			>
				{t("settings.appearance.cancel")}
			</button>
		</>
	);

	if (llmSettingsQuery.isPending) {
		return (
			<div
				className="flex flex-1 items-center justify-center bg-[#121214] text-zinc-500"
				aria-busy="true"
			>
				{t("settings.loading")}
			</div>
		);
	}
	if (llmSettingsQuery.isError && !isLlmDraftInitialized) {
		return (
			<div
				className="flex flex-1 flex-col items-center justify-center gap-3 bg-[#121214] text-zinc-300"
				role="alert"
			>
				<span>
					{llmSettingsQuery.error instanceof Error
						? llmSettingsQuery.error.message
						: t("settings.saveFailed")}
				</span>
				<button type="button" onClick={() => void llmSettingsQuery.refetch()}>
					{t("common.retry")}
				</button>
			</div>
		);
	}

	return (
		<div className="flex h-full min-h-0 bg-[#121214]">
			<aside className="nightworkers-settings-menu flex w-64 shrink-0 flex-col border-zinc-800 border-r bg-[#16161a] p-4">
				<a
					href={serializeWorkbenchRoute({
						kind: "overview",
						range: "30d",
						projectId: null,
					})}
					onClick={(event) => handleWorkbenchAnchorClick(event, onClose)}
					className="mb-5 inline-flex items-center gap-2 rounded-lg border border-zinc-700/50 bg-zinc-800 px-3 py-2 text-left text-xs text-zinc-300"
				>
					← {t("settings.backToApp")}
				</a>
				<div className="mb-3 px-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
					{t("settings.title")}
				</div>
				<nav className="grid gap-1" aria-label={t("settings.sections")}>
					{settingsSections.map((section) => {
						const Icon = section.icon;
						const active = activeSection === section.id;
						return (
							<a
								key={section.id}
								href={serializeWorkbenchRoute({
									kind: "settings",
									section: section.id,
								})}
								className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-left text-xs ${
									active
										? "border-indigo-500/70 bg-indigo-500/15 text-zinc-100"
										: "border-transparent text-zinc-400 hover:border-zinc-800 hover:bg-zinc-900/60 hover:text-zinc-200"
								}`}
								aria-current={active ? "page" : undefined}
								onClick={(event) =>
									handleWorkbenchAnchorClick(event, () =>
										onSectionChange?.(section.id),
									)
								}
							>
								<Icon className="h-4 w-4 shrink-0" />
								<span className="min-w-0">
									<span className="block font-semibold">
										{t(section.labelKey)}
									</span>
									<span className="block truncate text-[10px] text-zinc-500">
										{t(section.descriptionKey)}
									</span>
								</span>
							</a>
						);
					})}
				</nav>
			</aside>
			<main className="min-w-0 flex-1 overflow-y-auto p-8">
				<div className="mx-auto max-w-4xl space-y-4">
					<div className="flex items-center justify-between">
						<h1 className="flex items-center gap-2 text-xl font-bold text-zinc-100">
							<ActiveSectionIcon className="h-5 w-5 text-indigo-400" />
							{t(activeSectionMeta.labelKey)}
						</h1>
						<p className="text-xs text-zinc-500">
							{t(activeSectionMeta.descriptionKey)}
						</p>
					</div>

					{activeSection === "general" ? (
						<>
							{renderGeneralResourceErrors()}
							<SettingsSaveActions
								onSave={() => void saveGeneralSettings()}
								isSaving={isSavingGeneral}
								saveStatus={generalMessageStatus}
								saveMessage={generalMessage}
							/>
							<GeneralSettingsPanel
								value={generalSettings}
								fxCache={fxRateCacheQuery.data ?? null}
								isRefreshingFx={isRefreshingFx}
								onChange={onGeneralSettingsChange}
								onRefreshFx={() => void refreshFxRates()}
							/>
							<SettingsSaveActions
								onSave={() => void saveGeneralSettings()}
								isSaving={isSavingGeneral}
								saveStatus={generalMessageStatus}
								saveMessage={generalMessage}
							/>
						</>
					) : null}

					{activeSection === "plan-mode" ? (
						<>
							{renderGeneralResourceErrors()}
							<SettingsSaveActions
								onSave={() => void saveGeneralSettings()}
								isSaving={isSavingGeneral}
								saveStatus={generalMessageStatus}
								saveMessage={generalMessage}
							/>
							<SettingsPlanModePanel
								value={generalSettings}
								onChange={onGeneralSettingsChange}
							/>
							<SettingsSaveActions
								onSave={() => void saveGeneralSettings()}
								isSaving={isSavingGeneral}
								saveStatus={generalMessageStatus}
								saveMessage={generalMessage}
							/>
						</>
					) : null}

					{activeSection === "appearance" ? (
						<>
							<SettingsSaveActions
								onSave={saveAppearanceSettings}
								saveStatus={appearanceMessageStatus}
								saveMessage={appearanceMessage}
								secondaryAction={renderAppearanceSecondaryActions()}
							/>
							<AppearanceSettings
								value={appearanceDraft}
								onChange={updateAppearanceDraft}
							/>
							<SettingsSaveActions
								onSave={saveAppearanceSettings}
								saveStatus={appearanceMessageStatus}
								saveMessage={appearanceMessage}
								secondaryAction={renderAppearanceSecondaryActions()}
							/>
						</>
					) : null}

					{activeSection === "llm-providers" ? (
						<SettingsLlmPanel
							section="providers"
							settings={settings}
							isSaving={isSaving}
							saveStatus={llmSaveStatus}
							saveMessage={llmSaveMessage}
							onChange={onChange}
							handleSave={handleSave}
						/>
					) : null}

					{activeSection === "llm-routing" ? (
						<SettingsLlmPanel
							section="routing"
							settings={settings}
							isSaving={isSaving}
							saveStatus={llmSaveStatus}
							saveMessage={llmSaveMessage}
							onChange={onChange}
							handleSave={handleSave}
						/>
					) : null}

					{activeSection === "security-intelligence" ? (
						<>
							<SettingsVulnerabilityScanProviderPanel
								activeProject={activeProject}
							/>
							<SettingsOntologyPanel
								activeProject={activeProject}
								value={securityIntelligence}
								isSaving={securityIntelligenceBusy}
								onChange={changeSecurityIntelligence}
							/>
							<SettingsSaveActions
								onSave={() => void saveSecurityIntelligence()}
								isSaving={securityIntelligenceBusy}
								disabled={!activeProject || !securityIntelligence}
								saveStatus={securityIntelligenceMessageStatus}
								saveMessage={securityIntelligenceMessage}
							/>
							<SettingsProjectExplorationPanel
								activeProject={activeProject}
								value={projectExploration}
								mcpServers={mcpServers}
								isSaving={projectExplorationBusy}
								onChange={changeProjectExploration}
							/>
							<SettingsSaveActions
								onSave={() => void saveProjectExploration()}
								isSaving={projectExplorationBusy}
								disabled={
									!activeProject ||
									!projectExploration ||
									!projectExplorationConfigurationValid
								}
								saveStatus={projectExplorationMessageStatus}
								saveMessage={projectExplorationMessage}
							/>
						</>
					) : null}

					{activeSection === "hooks" ? <SettingsHooksPanel /> : null}

					{activeSection === "mcp" ? <SettingsMcpPanel /> : null}
				</div>
			</main>
		</div>
	);
}
