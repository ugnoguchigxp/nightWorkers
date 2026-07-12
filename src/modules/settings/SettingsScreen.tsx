import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { applyAppLanguage } from "../../i18n/I18nProvider";
import { AppearanceSettings } from "../blueprint-preview";
import { SettingsHooksPanel } from "../hooks/SettingsHooksPanel";
import { SettingsMcpPanel } from "../mcp/SettingsMcpPanel";
import {
	useWorkspaceAppearanceActions,
	useWorkspaceAppearanceState,
} from "../nightworkers/contexts/WorkspaceAppearanceContext";
import { handleWorkbenchAnchorClick } from "../nightworkers/routing/workbench-link-click";
import { serializeWorkbenchRoute } from "../nightworkers/routing/workbench-route-state";
import type {
	GeneralSettings,
	LlmSettings,
	Repository,
} from "../nightworkers/types";
import {
	fetchProjectSecurityIntelligenceSettings,
	type ProjectSecurityIntelligenceSettingsResponse,
	SettingsOntologyPanel,
	saveProjectSecurityIntelligenceSettings,
} from "../ontology";
import { GeneralSettingsPanel } from "./SettingsGeneralPanel";
import { SettingsLlmPanel } from "./SettingsLlmPanel";
import { SettingsPlanModePanel } from "./SettingsPlanModePanel";
import { SettingsSaveActions } from "./SettingsSaveActions";
import { defaultSettings } from "./settings-defaults";
import {
	fetchGeneralSettings,
	fetchLlmSettings,
	refreshFxRates as refreshFxRatesCommand,
	saveGeneralSettings as saveGeneralSettingsCommand,
	saveLlmSettings,
} from "./settingsCommands";

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
	const [settings, setSettings] = useState<LlmSettings>(defaultSettings);
	const [generalSettings, setGeneralSettings] = useState<GeneralSettings>(
		defaultGeneralSettings,
	);
	const [isLoading, setIsLoading] = useState(true);
	const [isSaving, setIsSaving] = useState(false);
	const [llmSaveStatus, setLlmSaveStatus] =
		useState<SaveFeedbackStatus>("idle");
	const [llmSaveMessage, setLlmSaveMessage] = useState("");
	const [generalMessage, setGeneralMessage] = useState("");
	const [generalMessageStatus, setGeneralMessageStatus] =
		useState<SaveFeedbackStatus>("idle");
	const [isRefreshingFx, setIsRefreshingFx] = useState(false);
	const [isSavingGeneral, setIsSavingGeneral] = useState(false);
	const [securityIntelligence, setSecurityIntelligence] =
		useState<ProjectSecurityIntelligenceSettingsResponse | null>(null);
	const [securityIntelligenceMessage, setSecurityIntelligenceMessage] =
		useState("");
	const [
		securityIntelligenceMessageStatus,
		setSecurityIntelligenceMessageStatus,
	] = useState<SaveFeedbackStatus>("idle");
	const [securityIntelligenceBusy, setSecurityIntelligenceBusy] =
		useState(false);
	const { settings: appearanceSettings } = useWorkspaceAppearanceState();
	const [appearanceDraft, setAppearanceDraft] = useState(appearanceSettings);
	const [appearanceMessage, setAppearanceMessage] = useState("");
	const [appearanceMessageStatus, setAppearanceMessageStatus] =
		useState<SaveFeedbackStatus>("idle");
	const { setAppearanceSettings, resetAppearanceSettings } =
		useWorkspaceAppearanceActions();

	useEffect(() => {
		setAppearanceDraft(appearanceSettings);
	}, [appearanceSettings]);

	const activeSectionMeta =
		settingsSections.find((section) => section.id === activeSection) ||
		settingsSections[0];
	const ActiveSectionIcon = activeSectionMeta.icon;

	useEffect(() => {
		Promise.all([
			fetchLlmSettings().then((res) => res.json()),
			fetchGeneralSettings().then((res) => res.json()),
		])
			.then(
				([llmData, generalData]: [
					Partial<LlmSettings>,
					Partial<GeneralSettings>,
				]) => {
					setSettings({ ...defaultSettings, ...llmData });
					setGeneralSettings(mergeGeneralSettings(generalData));
				},
			)
			.finally(() => setIsLoading(false));
	}, []);

	useEffect(() => {
		if (!activeProject) {
			setSecurityIntelligence(null);
			setSecurityIntelligenceMessage("");
			setSecurityIntelligenceMessageStatus("idle");
			return;
		}
		let cancelled = false;
		setSecurityIntelligenceBusy(true);
		fetchProjectSecurityIntelligenceSettings(activeProject.id)
			.then(async (res) => {
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				return (await res.json()) as ProjectSecurityIntelligenceSettingsResponse;
			})
			.then((value) => {
				if (!cancelled) setSecurityIntelligence(value);
			})
			.catch((error) => {
				if (!cancelled) {
					setSecurityIntelligence(null);
					setSecurityIntelligenceMessage(
						error instanceof Error ? error.message : String(error),
					);
					setSecurityIntelligenceMessageStatus("error");
				}
			})
			.finally(() => {
				if (!cancelled) setSecurityIntelligenceBusy(false);
			});
		return () => {
			cancelled = true;
		};
	}, [activeProject]);

	const handleSave = async () => {
		setIsSaving(true);
		setLlmSaveStatus("idle");
		setLlmSaveMessage("");
		try {
			const res = await saveLlmSettings(settings);
			if (!res.ok) {
				throw new Error(
					t("settings.saveFailedWithStatus", { status: res.status }),
				);
			}
			setSettings(settings);
			setLlmSaveStatus("success");
			setLlmSaveMessage(t("settings.saveSucceeded"));
		} catch (err) {
			setLlmSaveStatus("error");
			setLlmSaveMessage(err instanceof Error ? err.message : String(err));
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
		setSettings((prev) => ({ ...prev, [key]: value }));
	};

	const saveGeneralSettings = async () => {
		setIsSavingGeneral(true);
		setGeneralMessage("");
		setGeneralMessageStatus("idle");
		try {
			const res = await saveGeneralSettingsCommand(generalSettings);
			if (!res.ok) {
				setGeneralMessage(t("settings.general.saveFailed"));
				setGeneralMessageStatus("error");
				return;
			}
			const saved = mergeGeneralSettings(
				(await res.json()) as Partial<GeneralSettings>,
			);
			setGeneralSettings(saved);
			void applyAppLanguage(saved.language);
			setGeneralMessage(t("settings.general.saveSucceeded"));
			setGeneralMessageStatus("success");
		} catch (error) {
			setGeneralMessage(
				error instanceof Error
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
			const res = await refreshFxRatesCommand();
			if (!res.ok) {
				throw new Error(
					t("settings.general.exchangeRefreshFailed", { status: res.status }),
				);
			}
			const cache = (await res.json()) as { fetchedAt: string };
			setGeneralSettings((prev) => ({
				...prev,
				fx: { ...prev.fx, source: "ecb", lastRefreshedAt: cache.fetchedAt },
			}));
			setGeneralMessage(t("settings.general.exchangeRefreshSucceeded"));
			setGeneralMessageStatus("success");
		} catch (err) {
			setGeneralMessage(err instanceof Error ? err.message : String(err));
			setGeneralMessageStatus("error");
		} finally {
			setIsRefreshingFx(false);
		}
	};

	const saveSecurityIntelligence = async () => {
		if (!activeProject || !securityIntelligence) return;
		setSecurityIntelligenceBusy(true);
		setSecurityIntelligenceMessage("");
		setSecurityIntelligenceMessageStatus("idle");
		try {
			const res = await saveProjectSecurityIntelligenceSettings(
				activeProject.id,
				securityIntelligence.settings,
			);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			setSecurityIntelligence(
				(await res.json()) as ProjectSecurityIntelligenceSettingsResponse,
			);
			setSecurityIntelligenceMessage(
				t("settings.securityIntelligence.saveSucceeded"),
			);
			setSecurityIntelligenceMessageStatus("success");
		} catch (error) {
			setSecurityIntelligenceMessage(
				error instanceof Error ? error.message : String(error),
			);
			setSecurityIntelligenceMessageStatus("error");
		} finally {
			setSecurityIntelligenceBusy(false);
		}
	};

	const saveAppearanceSettings = () => {
		setAppearanceSettings(appearanceDraft);
		setAppearanceMessage(t("settings.saveSucceeded"));
		setAppearanceMessageStatus("success");
	};

	if (isLoading) {
		return (
			<div className="flex flex-1 items-center justify-center bg-[#121214] text-zinc-500">
				設定をロード中...
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
							<SettingsSaveActions
								onSave={() => void saveGeneralSettings()}
								isSaving={isSavingGeneral}
								saveStatus={generalMessageStatus}
								saveMessage={generalMessage}
							/>
							<GeneralSettingsPanel
								value={generalSettings}
								isRefreshingFx={isRefreshingFx}
								onChange={setGeneralSettings}
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
							<SettingsSaveActions
								onSave={() => void saveGeneralSettings()}
								isSaving={isSavingGeneral}
								saveStatus={generalMessageStatus}
								saveMessage={generalMessage}
							/>
							<SettingsPlanModePanel
								value={generalSettings}
								onChange={setGeneralSettings}
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
								secondaryAction={
									<button
										type="button"
										className="rounded-lg border border-zinc-700/50 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-300"
										onClick={() => {
											resetAppearanceSettings();
											setAppearanceMessage(t("settings.saved"));
											setAppearanceMessageStatus("success");
										}}
									>
										{t("settings.appearance.reset")}
									</button>
								}
							/>
							<AppearanceSettings
								value={appearanceDraft}
								onChange={(next) => {
									setAppearanceDraft(next);
									setAppearanceMessage("");
									setAppearanceMessageStatus("idle");
								}}
							/>
							<SettingsSaveActions
								onSave={saveAppearanceSettings}
								saveStatus={appearanceMessageStatus}
								saveMessage={appearanceMessage}
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
							<SettingsSaveActions
								onSave={() => void saveSecurityIntelligence()}
								isSaving={securityIntelligenceBusy}
								disabled={!activeProject || !securityIntelligence}
								saveStatus={securityIntelligenceMessageStatus}
								saveMessage={securityIntelligenceMessage}
							/>
							<SettingsOntologyPanel
								activeProject={activeProject}
								value={securityIntelligence}
								isSaving={securityIntelligenceBusy}
								onChange={(value) => {
									setSecurityIntelligence(value);
									setSecurityIntelligenceMessage("");
									setSecurityIntelligenceMessageStatus("idle");
								}}
							/>
							<SettingsSaveActions
								onSave={() => void saveSecurityIntelligence()}
								isSaving={securityIntelligenceBusy}
								disabled={!activeProject || !securityIntelligence}
								saveStatus={securityIntelligenceMessageStatus}
								saveMessage={securityIntelligenceMessage}
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
