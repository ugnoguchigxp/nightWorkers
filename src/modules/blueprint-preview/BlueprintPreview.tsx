import { Info, Palette } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
	fetchBlueprintDesignSettings,
	saveBlueprintDesignSettings,
} from "../blueprint/blueprintCommands";
import {
	AdoptionToggle,
	useBlueprintAdoption,
} from "./BlueprintPreviewAdoption";
import {
	DesignSettingsPanel,
	parseStableJsonKey,
	stableJsonKey,
} from "./BlueprintPreviewDesignSettingsPanel";
import {
	arrangeSectionsByRegion,
	BlueprintScreenSectionLayout,
	displayedSections,
	resolveScreenLayout,
} from "./BlueprintPreviewLayout";
import {
	BlueprintMetaPanel,
	getBlueprintMetaDebugData,
} from "./BlueprintPreviewMeta";
import { PreviewActionButton } from "./BlueprintPreviewPrimitives";
import "./blueprintPreview.css";
import {
	type BlueprintPreviewDesignSettings,
	createBlueprintDesignReference,
	createBlueprintPreviewDesignSettings,
} from "./designSettings";
import { toObjectArray } from "./previewModel";

export { getBlueprintMetaDebugData } from "./BlueprintPreviewMeta";

type BlueprintPreviewProps = {
	sessionId?: string | null;
	messageId?: string | null;
	blueprint: Record<string, unknown>;
	screens: Array<Record<string, unknown>>;
	validationIssues?: Array<Record<string, unknown>>;
};

export function BlueprintPreview({
	sessionId,
	messageId,
	blueprint,
	screens,
}: BlueprintPreviewProps) {
	const { t } = useTranslation();
	const blueprintId = String(
		blueprint.id || blueprint.name || screens[0]?.id || "draft-blueprint",
	);
	const previousBlueprintId = useRef(blueprintId);
	const designPresetKey = stableJsonKey(blueprint.designPreset);
	const initialSettings = useMemo(
		() =>
			createBlueprintPreviewDesignSettings(parseStableJsonKey(designPresetKey)),
		[designPresetKey],
	);
	const [settings, setSettings] =
		useState<BlueprintPreviewDesignSettings>(initialSettings);
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [metaOpen, setMetaOpen] = useState(false);
	const designTokenAdoption = useBlueprintAdoption({
		sessionId,
		messageId,
		kind: "designTokens",
	});
	const saveRequestSeqRef = useRef(0);

	useEffect(() => {
		setSettings(initialSettings);
		if (!sessionId) return;
		const controller = new AbortController();
		fetchBlueprintDesignSettings(sessionId, { signal: controller.signal })
			.then(async (res) => {
				if (!res.ok) return null;
				return (await res.json()) as { settings?: unknown };
			})
			.then((data) => {
				if (controller.signal.aborted || !data?.settings) return;
				setSettings(createBlueprintPreviewDesignSettings(data.settings));
			})
			.catch((error) => {
				if (error?.name !== "AbortError") {
					console.warn("Failed to load Blueprint design settings", error);
				}
			});
		return () => controller.abort();
	}, [initialSettings, sessionId]);

	useEffect(() => {
		if (previousBlueprintId.current === blueprintId) return;
		previousBlueprintId.current = blueprintId;
		setSettingsOpen(false);
		setMetaOpen(false);
	}, [blueprintId]);

	const designReference = useMemo(
		() =>
			createBlueprintDesignReference({
				blueprintId,
				settings,
			}),
		[blueprintId, settings],
	);

	const updateSettings = useCallback(
		(next: BlueprintPreviewDesignSettings) => {
			setSettings(next);
			if (!sessionId) return;
			const requestSeq = ++saveRequestSeqRef.current;
			saveBlueprintDesignSettings(sessionId, next)
				.then((res) => {
					if (!res.ok)
						throw new Error(
							`Failed to save Blueprint design settings: ${res.status}`,
						);
					return res.json();
				})
				.then((data: { settings?: unknown }) => {
					if (requestSeq !== saveRequestSeqRef.current || !data.settings)
						return;
					setSettings(createBlueprintPreviewDesignSettings(data.settings));
				})
				.catch((error) => {
					console.warn("Failed to save Blueprint design settings", error);
				});
		},
		[sessionId],
	);

	if (screens.length === 0) {
		return (
			<div className="rounded border border-slate-700/80 p-3 text-xs text-slate-400">
				{t("blueprint.preview.noScreens")}
			</div>
		);
	}

	const firstScreen = screens[0];
	const sections = toObjectArray(firstScreen?.sections);
	const screenLayout = resolveScreenLayout(firstScreen);
	const arrangedSections = arrangeSectionsByRegion(sections);
	const meta = getBlueprintMetaDebugData(
		blueprint.meta,
		displayedSections(arrangedSections),
	);

	return (
		<div
			className="blueprint-preview grid gap-[var(--blueprint-preview-gap)] rounded-xl border border-border p-[var(--blueprint-preview-section-padding)] text-ui"
			data-blueprint-preview
			data-theme={settings.theme}
			data-density={settings.density}
			data-shape={settings.shape}
			data-shadow={settings.shadow}
			data-shadow-direction={settings.shadowDirection}
			data-font={settings.font}
			data-contrast={settings.contrast}
			data-motion={settings.motion}
			data-button-variant={settings.componentVariants.button}
			data-card-variant={settings.componentVariants.card}
			data-table-variant={settings.componentVariants.table}
			data-input-variant={settings.componentVariants.input}
		>
			<div className="flex flex-wrap items-center justify-end gap-2">
				{meta ? (
					<PreviewActionButton
						aria-expanded={metaOpen}
						aria-controls="blueprint-meta-panel"
						tone={metaOpen ? "primary" : "secondary"}
						onClick={() => setMetaOpen((open) => !open)}
					>
						<Info className="h-3.5 w-3.5" />
						{t("blueprint.preview.seeMeta")}
					</PreviewActionButton>
				) : null}
				<div className="rounded-full border border-border bg-card px-3 py-1 text-[11px] text-muted-foreground">
					{t("blueprint.preview.sectionsCount", { count: sections.length })}
				</div>
				<PreviewActionButton
					aria-expanded={settingsOpen}
					aria-controls="blueprint-design-settings"
					tone={settingsOpen ? "primary" : "secondary"}
					onClick={() => setSettingsOpen((open) => !open)}
				>
					<Palette className="h-3.5 w-3.5" />
					{t("blueprint.preview.design")}
				</PreviewActionButton>
			</div>

			{metaOpen && meta ? (
				<BlueprintMetaPanel id="blueprint-meta-panel" meta={meta} />
			) : null}

			{settingsOpen ? (
				<DesignSettingsPanel
					id="blueprint-design-settings"
					value={settings}
					designReference={designReference}
					adoption={
						<AdoptionToggle
							label={t("blueprint.preview.designTokens")}
							adopted={designTokenAdoption.adopted}
							disabled={
								!designTokenAdoption.enabled || designTokenAdoption.saving
							}
							onToggle={designTokenAdoption.toggle}
						/>
					}
					onChange={updateSettings}
				/>
			) : null}

			<BlueprintScreenSectionLayout
				layout={screenLayout}
				sections={arrangedSections}
			/>
		</div>
	);
}
