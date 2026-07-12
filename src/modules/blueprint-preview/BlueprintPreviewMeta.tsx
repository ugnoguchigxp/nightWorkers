import { Info } from "lucide-react";
import { useTranslation } from "react-i18next";
import { SettingsGroup } from "./BlueprintPreviewDesignSettingsPanel";
import { PreviewCard } from "./BlueprintPreviewPrimitives";

type BlueprintMetaDebugData = {
	intent: string;
	selectedSections: Array<{ sectionType: string; selectionReason: string }>;
};

export function getBlueprintMetaDebugData(
	value: unknown,
	displayedScreenSections?: Array<Record<string, unknown>>,
): BlueprintMetaDebugData | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const record = value as Record<string, unknown>;
	const intent = typeof record.intent === "string" ? record.intent.trim() : "";
	const rootSelectedSections = Array.isArray(record.selectedSections)
		? record.selectedSections
				.filter((section): section is Record<string, unknown> =>
					Boolean(
						section && typeof section === "object" && !Array.isArray(section),
					),
				)
				.map((section) => ({
					sectionType: String(section.sectionType || ""),
					selectionReason: String(section.selectionReason || ""),
				}))
				.filter((section) => section.sectionType && section.selectionReason)
		: [];
	const selectedSections =
		displayedScreenSections && displayedScreenSections.length > 0
			? displayedScreenSections
					.map((section) => {
						const sectionType = String(section.componentName || "");
						if (!sectionType) return null;
						const rootSection = rootSelectedSections.find(
							(item) => item.sectionType === sectionType,
						);
						const selectionReason = String(
							rootSection?.selectionReason || section.intent || "",
						).trim();
						if (!selectionReason) return null;
						return { sectionType, selectionReason };
					})
					.filter(
						(
							section,
						): section is {
							sectionType: string;
							selectionReason: string;
						} => Boolean(section),
					)
			: rootSelectedSections;
	return intent && selectedSections.length > 0
		? { intent, selectedSections }
		: null;
}

export function BlueprintMetaPanel({
	id,
	meta,
}: {
	id: string;
	meta: BlueprintMetaDebugData;
}) {
	const { t } = useTranslation();
	return (
		<PreviewCard id={id} className="rounded-lg p-3 text-xs">
			<div className="mb-3 flex items-start gap-2 text-muted-foreground">
				<Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
				<div className="min-w-0">
					<div className="font-semibold text-foreground">
						{t("blueprint.meta.title")}
					</div>
					<div className="mt-1 leading-5">
						{t("blueprint.meta.description")}
					</div>
				</div>
			</div>
			<div className="grid gap-2">
				<SettingsGroup title={t("blueprint.meta.intent")} summary="intent">
					<p className="leading-5 text-foreground">{meta.intent}</p>
				</SettingsGroup>
				<SettingsGroup
					title={t("blueprint.meta.selectedSections")}
					summary={`${meta.selectedSections.length}`}
				>
					<div className="grid gap-2">
						{meta.selectedSections.map((section, _index) => (
							<div
								key={`-`}
								className="rounded border border-border bg-background p-2"
							>
								<div className="font-mono text-[11px] font-semibold text-foreground">
									{section.sectionType}
								</div>
								<p className="mt-1 leading-5 text-muted-foreground">
									{section.selectionReason}
								</p>
							</div>
						))}
					</div>
				</SettingsGroup>
			</div>
		</PreviewCard>
	);
}
