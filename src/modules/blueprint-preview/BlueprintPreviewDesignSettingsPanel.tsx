import { Check, SlidersHorizontal } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { PreviewCard, PreviewOptionButton } from "./BlueprintPreviewPrimitives";
import {
	type BlueprintPreviewDesignSettings,
	blueprintPreviewDesignOptions,
	type createBlueprintDesignReference,
	designReferenceSummary,
} from "./designSettings";
import { labelForOption, labelForOptionA11y } from "./previewModel";

export function DesignSettingsPanel({
	id,
	value,
	designReference,
	adoption,
	onChange,
}: {
	id: string;
	value: BlueprintPreviewDesignSettings;
	designReference: ReturnType<typeof createBlueprintDesignReference>;
	adoption?: ReactNode;
	onChange: (next: BlueprintPreviewDesignSettings) => void;
}) {
	const { t } = useTranslation();

	return (
		<PreviewCard id={id} className="rounded-lg p-3 text-xs">
			<div className="mb-3 flex items-start gap-2 text-muted-foreground">
				<SlidersHorizontal className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
				<div className="min-w-0 flex-1">
					<div className="font-semibold text-foreground">
						{t("blueprint.designSettings.title")}
					</div>
					<div className="mt-1 leading-5">
						{t("blueprint.designSettings.description")}
					</div>
				</div>
				{adoption ? <div className="shrink-0">{adoption}</div> : null}
			</div>
			<div className="grid gap-3">
				<VisualSettingsGroup
					title={t("settings.appearance.theme")}
					summary={value.theme}
				>
					<VisualOptionGrid
						kind="theme"
						options={blueprintPreviewDesignOptions.theme}
						value={value.theme}
						onSelect={(theme) => onChange({ ...value, theme })}
					/>
				</VisualSettingsGroup>
				<VisualSettingsGroup
					title={t("settings.appearance.density")}
					summary={value.density}
				>
					<VisualOptionGrid
						kind="density"
						options={blueprintPreviewDesignOptions.density}
						value={value.density}
						onSelect={(density) => onChange({ ...value, density })}
					/>
				</VisualSettingsGroup>
				<VisualSettingsGroup
					title={t("settings.appearance.shape")}
					summary={value.shape}
				>
					<VisualOptionGrid
						kind="shape"
						options={blueprintPreviewDesignOptions.shape}
						value={value.shape}
						onSelect={(shape) => onChange({ ...value, shape })}
					/>
				</VisualSettingsGroup>
				<SettingsGroup
					title={t("settings.appearance.shadow")}
					summary={`${value.shadow} / ${labelForOption(value.shadowDirection)}`}
				>
					<div className="grid gap-3">
						<div className="grid gap-1.5">
							<div className="text-[11px] font-semibold uppercase text-muted-foreground">
								{t("settings.appearance.strength")}
							</div>
							<VisualOptionGrid
								kind="shadow"
								options={blueprintPreviewDesignOptions.shadow}
								value={value.shadow}
								onSelect={(shadow) => onChange({ ...value, shadow })}
							/>
						</div>
						<VariantRow
							label={t("settings.appearance.direction")}
							options={blueprintPreviewDesignOptions.shadowDirection}
							value={value.shadowDirection}
							onSelect={(shadowDirection) =>
								onChange({ ...value, shadowDirection })
							}
						/>
					</div>
				</SettingsGroup>
				<VisualSettingsGroup
					title={t("settings.appearance.font")}
					summary={value.font}
				>
					<VisualOptionGrid
						kind="font"
						options={blueprintPreviewDesignOptions.font}
						value={value.font}
						onSelect={(font) => onChange({ ...value, font })}
					/>
				</VisualSettingsGroup>
				<SettingsGroup
					title={t("settings.appearance.contrast")}
					summary={value.contrast}
				>
					<OptionRow
						options={blueprintPreviewDesignOptions.contrast}
						value={value.contrast}
						onSelect={(contrast) => onChange({ ...value, contrast })}
					/>
				</SettingsGroup>
				<SettingsGroup
					title={t("settings.appearance.motion")}
					summary={value.motion}
				>
					<OptionRow
						options={blueprintPreviewDesignOptions.motion}
						value={value.motion}
						onSelect={(motion) => onChange({ ...value, motion })}
					/>
				</SettingsGroup>
				<SettingsGroup
					title={t("settings.appearance.componentVariants")}
					summary={t("settings.appearance.componentSummary")}
				>
					<div className="grid gap-3">
						<VariantRow
							label={t("settings.appearance.button")}
							options={blueprintPreviewDesignOptions.buttonVariant}
							value={value.componentVariants.button}
							onSelect={(button) =>
								onChange({
									...value,
									componentVariants: { ...value.componentVariants, button },
								})
							}
						/>
						<VariantRow
							label={t("settings.appearance.card")}
							options={blueprintPreviewDesignOptions.cardVariant}
							value={value.componentVariants.card}
							onSelect={(card) =>
								onChange({
									...value,
									componentVariants: { ...value.componentVariants, card },
								})
							}
						/>
						<VariantRow
							label={t("settings.appearance.table")}
							options={blueprintPreviewDesignOptions.tableVariant}
							value={value.componentVariants.table}
							onSelect={(table) =>
								onChange({
									...value,
									componentVariants: { ...value.componentVariants, table },
								})
							}
						/>
						<VariantRow
							label={t("settings.appearance.input")}
							options={blueprintPreviewDesignOptions.inputVariant}
							value={value.componentVariants.input}
							onSelect={(input) =>
								onChange({
									...value,
									componentVariants: { ...value.componentVariants, input },
								})
							}
						/>
					</div>
				</SettingsGroup>
				<details className="rounded border border-border bg-card">
					<summary className="cursor-pointer select-none px-3 py-2 font-semibold text-foreground">
						{t("blueprint.designSettings.implementationPlanAttachment")}
					</summary>
					<div className="border-border border-t p-3">
						<pre className="whitespace-pre-wrap rounded border border-border bg-background p-2 font-mono text-[11px] leading-5 text-foreground">
							{designReferenceSummary(designReference.settings)}
						</pre>
					</div>
				</details>
			</div>
		</PreviewCard>
	);
}

type VisualOptionKind = "theme" | "density" | "shape" | "shadow" | "font";

function VisualSettingsGroup({
	title,
	summary,
	children,
}: {
	title: string;
	summary: string;
	children: ReactNode;
}) {
	return (
		<section className="rounded-lg border border-border bg-card p-2.5">
			<div className="mb-3 flex items-center justify-between gap-3">
				<span className="font-semibold text-foreground">{title}</span>
				<span className="rounded-full border border-border bg-background px-2 py-0.5 text-[10px] text-muted-foreground">
					{labelForOption(summary)}
				</span>
			</div>
			{children}
		</section>
	);
}

function VisualOptionGrid<const T extends readonly string[]>({
	kind,
	options,
	value,
	onSelect,
}: {
	kind: VisualOptionKind;
	options: T;
	value: T[number];
	onSelect: (value: T[number]) => void;
}) {
	return (
		<div
			className={
				kind === "theme"
					? "grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4"
					: "flex flex-wrap gap-1.5"
			}
		>
			{options.map((option) => {
				const selected = option === value;
				return (
					<button
						aria-label={labelForOptionA11y(option)}
						aria-pressed={selected}
						className={`group relative min-w-0 overflow-hidden rounded-md border text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
							selected
								? "border-primary bg-primary/5 ring-1 ring-primary"
								: "border-border bg-background hover:border-primary/60 hover:bg-muted/50"
						} ${kind === "theme" ? "p-2" : "flex h-8 items-center gap-1.5 px-1.5 py-1"}`}
						key={option}
						type="button"
						onClick={() => onSelect(option)}
					>
						<OptionVisual
							compact={kind !== "theme"}
							kind={kind}
							option={option}
						/>
						<span
							className={`${kind === "theme" ? "mt-2 block" : "min-w-0"} truncate text-[11px] font-semibold text-foreground`}
						>
							{labelForOption(option)}
						</span>
						{selected ? (
							<span
								className={`grid h-4 w-4 place-items-center rounded-full bg-primary text-primary-foreground ${
									kind === "theme"
										? "absolute top-1.5 right-1.5"
										: "absolute -top-1 -right-1"
								}`}
							>
								<Check aria-hidden className="h-3 w-3" strokeWidth={3} />
							</span>
						) : null}
					</button>
				);
			})}
		</div>
	);
}

function OptionVisual({
	compact,
	kind,
	option,
}: {
	compact: boolean;
	kind: VisualOptionKind;
	option: string;
}) {
	if (kind === "theme") return <ThemeVisual theme={option} />;
	if (kind === "density")
		return <DensityVisual compact={compact} density={option} />;
	if (kind === "shape") return <ShapeVisual compact={compact} shape={option} />;
	if (kind === "shadow")
		return <ShadowVisual compact={compact} shadow={option} />;
	return <FontVisual compact={compact} font={option} />;
}

function ThemeVisual({ theme }: { theme: string }) {
	return (
		<div
			className={`blueprint-design-option-preview blueprint-design-theme-${theme}`}
		>
			<div className="blueprint-design-option-sidebar" />
			<div className="blueprint-design-option-main">
				<i />
				<b />
				<span />
			</div>
		</div>
	);
}

function DensityVisual({
	compact,
	density,
}: {
	compact: boolean;
	density: string;
}) {
	return (
		<div
			className={`blueprint-design-option-preview blueprint-design-density-${density} ${compact ? "blueprint-design-option-preview-compact" : ""}`}
		>
			<div className="blueprint-design-density-row">
				<i />
				<span />
			</div>
			<div className="blueprint-design-density-row">
				<i />
				<span />
			</div>
			<div className="blueprint-design-density-row">
				<i />
				<span />
			</div>
		</div>
	);
}

function ShapeVisual({ compact, shape }: { compact: boolean; shape: string }) {
	return (
		<div
			className={`blueprint-design-option-preview blueprint-design-shape-${shape} ${compact ? "blueprint-design-option-preview-compact" : ""}`}
		>
			<div className="blueprint-design-shape-avatar" />
			<div className="blueprint-design-shape-copy">
				<i />
				<span />
			</div>
			<div className="blueprint-design-shape-button" />
		</div>
	);
}

function ShadowVisual({
	compact,
	shadow,
}: {
	compact: boolean;
	shadow: string;
}) {
	return (
		<div
			className={`blueprint-design-option-preview blueprint-design-shadow-${shadow} ${compact ? "blueprint-design-option-preview-compact" : ""}`}
		>
			<div className="blueprint-design-shadow-card">
				<i />
				<span />
			</div>
		</div>
	);
}

function FontVisual({ compact, font }: { compact: boolean; font: string }) {
	return (
		<div
			className={`blueprint-design-option-preview blueprint-design-font-${font} ${compact ? "blueprint-design-option-preview-compact" : ""}`}
		>
			<strong>Aa</strong>
			<div>
				<i>The quick brown</i>
				<span>Design system preview</span>
			</div>
		</div>
	);
}

export function SettingsGroup({
	title,
	summary,
	children,
}: {
	title: string;
	summary: string;
	children: React.ReactNode;
}) {
	return (
		<section className="rounded border border-border bg-card">
			<div className="flex items-center justify-between gap-3 px-3 py-2">
				<span className="font-semibold text-foreground">{title}</span>
				<span className="rounded border border-border bg-background px-2 py-0.5 text-[10px] text-muted-foreground">
					{summary}
				</span>
			</div>
			<div className="border-border border-t p-3">{children}</div>
		</section>
	);
}

function VariantRow<const T extends readonly string[]>({
	label,
	options,
	value,
	onSelect,
}: {
	label: string;
	options: T;
	value: T[number];
	onSelect: (value: T[number]) => void;
}) {
	return (
		<div className="grid gap-1.5">
			<div className="text-[11px] font-semibold uppercase text-muted-foreground">
				{label}
			</div>
			<OptionRow options={options} value={value} onSelect={onSelect} />
		</div>
	);
}

function OptionRow<const T extends readonly string[]>({
	options,
	value,
	onSelect,
}: {
	options: T;
	value: T[number];
	onSelect: (value: T[number]) => void;
}) {
	return (
		<div className="flex flex-wrap gap-1.5">
			{options.map((option) => (
				<PreviewOptionButton
					key={option}
					aria-label={labelForOptionA11y(option)}
					selected={option === value}
					onClick={() => onSelect(option)}
				>
					{labelForOption(option)}
				</PreviewOptionButton>
			))}
		</div>
	);
}

export function stableJsonKey(value: unknown) {
	if (value === undefined) return "undefined";
	try {
		return JSON.stringify(value) || "null";
	} catch {
		return String(value);
	}
}

export function parseStableJsonKey(value: string) {
	if (value === "undefined") return undefined;
	try {
		return JSON.parse(value) as unknown;
	} catch {
		return undefined;
	}
}
