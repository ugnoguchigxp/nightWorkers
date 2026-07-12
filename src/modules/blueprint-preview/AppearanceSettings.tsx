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
		<section className="space-y-4 rounded-2xl border border-zinc-800/60 bg-[#16161a] p-6">
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
				<VisualSettingsGroup
					title={t("settings.appearance.shadow")}
					summary={`${value.shadow} / ${value.shadowDirection}`}
				>
					<div className="grid gap-3">
						<div className="grid gap-1.5">
							<div className="text-[10px] font-semibold uppercase text-zinc-500">
								{t("settings.appearance.strength")}
							</div>
							<VisualOptionGrid
								kind="shadow"
								options={blueprintPreviewDesignOptions.shadow}
								value={value.shadow}
								onSelect={(shadow) => onChange({ ...value, shadow })}
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
				>
					<VisualOptionGrid
						kind="font"
						options={blueprintPreviewDesignOptions.font}
						value={value.font}
						onSelect={(font) => onChange({ ...value, font })}
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
		<div className="rounded-xl border border-zinc-800 bg-zinc-950/30 p-3">
			<div className="mb-2 flex items-center justify-between gap-3 text-xs">
				<span className="font-semibold text-zinc-200">{label}</span>
				<span className="text-zinc-500">{summary}</span>
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
		<div className="flex flex-wrap gap-1.5">
			{options.map((option) => (
				<button
					type="button"
					key={option}
					className={`rounded-lg border px-2.5 py-1 text-[11px] capitalize ${
						option === value
							? "border-indigo-400 bg-indigo-500 text-white"
							: "border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-zinc-500"
					}`}
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
			<div className="text-[10px] font-semibold uppercase text-zinc-500">
				{label}
			</div>
			<AppearanceOptionRow
				options={options}
				value={value}
				onSelect={onSelect}
			/>
		</div>
	);
}
