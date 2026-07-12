import { useTranslation } from "react-i18next";
import {
	VisualOptionGrid,
	VisualSettingsGroup,
} from "./BlueprintPreviewDesignSettingsPanel";
import {
	type BlueprintPreviewDesignSettings,
	blueprintPreviewDesignOptions,
} from "./designSettings";
import "./blueprintPreview.css";

export function AppearanceSettings({
	value,
	onChange,
}: {
	value: BlueprintPreviewDesignSettings;
	onChange: (next: BlueprintPreviewDesignSettings) => void;
}) {
	const { t } = useTranslation();

	return (
		<section className="nightworkers-appearance-settings">
			<div className="grid gap-3">
				<VisualSettingsGroup
					title={t("settings.appearance.theme")}
					summary={value.theme}
					tone="workspace"
				>
					<VisualOptionGrid
						kind="theme"
						options={blueprintPreviewDesignOptions.theme}
						value={value.theme}
						onSelect={(theme) => onChange({ ...value, theme })}
						tone="workspace"
					/>
				</VisualSettingsGroup>
				<VisualSettingsGroup
					title={t("settings.appearance.density")}
					summary={value.density}
					tone="workspace"
				>
					<VisualOptionGrid
						kind="density"
						options={blueprintPreviewDesignOptions.density}
						value={value.density}
						onSelect={(density) => onChange({ ...value, density })}
						tone="workspace"
					/>
				</VisualSettingsGroup>
				<VisualSettingsGroup
					title={t("settings.appearance.shape")}
					summary={value.shape}
					tone="workspace"
				>
					<VisualOptionGrid
						kind="shape"
						options={blueprintPreviewDesignOptions.shape}
						value={value.shape}
						onSelect={(shape) => onChange({ ...value, shape })}
						tone="workspace"
					/>
				</VisualSettingsGroup>
				<VisualSettingsGroup
					title={t("settings.appearance.shadow")}
					summary={`${value.shadow} / ${value.shadowDirection}`}
					tone="workspace"
				>
					<div className="grid gap-3">
						<div className="grid gap-1.5">
							<div className="nightworkers-appearance-variant-label">
								{t("settings.appearance.strength")}
							</div>
							<VisualOptionGrid
								kind="shadow"
								options={blueprintPreviewDesignOptions.shadow}
								value={value.shadow}
								onSelect={(shadow) => onChange({ ...value, shadow })}
								tone="workspace"
							/>
						</div>
						<AppearanceVariantRow
							label={t("settings.appearance.direction")}
							options={blueprintPreviewDesignOptions.shadowDirection}
							value={value.shadowDirection}
							onSelect={(shadowDirection) =>
								onChange({ ...value, shadowDirection })
							}
						/>
					</div>
				</VisualSettingsGroup>
				<VisualSettingsGroup
					title={t("settings.appearance.font")}
					summary={value.font}
					tone="workspace"
				>
					<VisualOptionGrid
						kind="font"
						options={blueprintPreviewDesignOptions.font}
						value={value.font}
						onSelect={(font) => onChange({ ...value, font })}
						tone="workspace"
					/>
				</VisualSettingsGroup>
				<AppearanceGroup
					label={t("settings.appearance.contrast")}
					summary={value.contrast}
				>
					<AppearanceOptionRow
						options={blueprintPreviewDesignOptions.contrast}
						value={value.contrast}
						onSelect={(contrast) => onChange({ ...value, contrast })}
					/>
				</AppearanceGroup>
				<AppearanceGroup
					label={t("settings.appearance.motion")}
					summary={value.motion}
				>
					<AppearanceOptionRow
						options={blueprintPreviewDesignOptions.motion}
						value={value.motion}
						onSelect={(motion) => onChange({ ...value, motion })}
					/>
				</AppearanceGroup>
				<AppearanceGroup
					label={t("settings.appearance.componentVariants")}
					summary={t("settings.appearance.componentSummary")}
				>
					<div className="grid gap-2 md:grid-cols-2">
						<AppearanceVariantRow
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
						<AppearanceVariantRow
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
						<AppearanceVariantRow
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
						<AppearanceVariantRow
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
				</AppearanceGroup>
			</div>
		</section>
	);
}

function AppearanceGroup({
	label,
	summary,
	children,
}: {
	label: string;
	summary: string;
	children: React.ReactNode;
}) {
	return (
		<div className="nightworkers-appearance-group">
			<div className="nightworkers-appearance-group-header">
				<span className="nightworkers-appearance-group-title">{label}</span>
				<span className="nightworkers-appearance-group-summary">{summary}</span>
			</div>
			{children}
		</div>
	);
}

function AppearanceOptionRow<const T extends readonly string[]>({
	options,
	value,
	onSelect,
}: {
	options: T;
	value: T[number];
	onSelect: (value: T[number]) => void;
}) {
	return (
		<div className="nightworkers-appearance-legacy-options">
			{options.map((option) => (
				<button
					type="button"
					key={option}
					aria-pressed={option === value}
					className="nightworkers-appearance-option"
					onClick={() => onSelect(option)}
				>
					{option.replace(/-/g, " ")}
				</button>
			))}
		</div>
	);
}

function AppearanceVariantRow<const T extends readonly string[]>({
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
		<div className="grid gap-1">
			<div className="nightworkers-appearance-variant-label">{label}</div>
			<AppearanceOptionRow
				options={options}
				value={value}
				onSelect={onSelect}
			/>
		</div>
	);
}
