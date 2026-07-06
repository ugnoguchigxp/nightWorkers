export type BlueprintPreviewDesignSettings = {
	theme:
		| "light"
		| "dark"
		| "eclipse"
		| "macosclassic"
		| "campfire"
		| "mint"
		| "bloom"
		| "mocha";
	density: "compact" | "default" | "comfortable";
	shape: "sharp" | "default" | "rounded" | "pill";
	shadow: "none" | "subtle" | "medium" | "strong";
	shadowDirection:
		| "0deg"
		| "45deg"
		| "90deg"
		| "135deg"
		| "180deg"
		| "225deg"
		| "270deg"
		| "315deg";
	font: "system" | "geist" | "serif" | "mono";
	contrast: "standard" | "high";
	motion: "reduced" | "standard";
	componentVariants: {
		button: "solid" | "soft" | "outline";
		card: "plain" | "outlined" | "elevated";
		table: "plain" | "striped" | "dense-grid";
		input: "outline" | "filled" | "underline";
	};
};

export type BlueprintDesignReference = {
	source: "blueprint-preview";
	blueprintId: string;
	capturedAt: string;
	settings: BlueprintPreviewDesignSettings;
	tokenMapping: {
		theme: string;
		density: string;
		radius: string;
		shadow: string;
		shadowDirection: string;
		font: string;
		contrast: string;
		motion: string;
	};
	notes: string[];
};

export const defaultBlueprintPreviewDesignSettings: BlueprintPreviewDesignSettings =
	{
		theme: "light",
		density: "compact",
		shape: "default",
		shadow: "subtle",
		shadowDirection: "0deg",
		font: "geist",
		contrast: "standard",
		motion: "standard",
		componentVariants: {
			button: "solid",
			card: "outlined",
			table: "striped",
			input: "outline",
		},
	};

const themes = [
	"light",
	"dark",
	"eclipse",
	"macosclassic",
	"campfire",
	"mint",
	"bloom",
	"mocha",
] as const;
const densities = ["compact", "default", "comfortable"] as const;
const shapes = ["sharp", "default", "rounded", "pill"] as const;
const shadows = ["none", "subtle", "medium", "strong"] as const;
const shadowDirections = [
	"0deg",
	"45deg",
	"90deg",
	"135deg",
	"180deg",
	"225deg",
	"270deg",
	"315deg",
] as const;
const fonts = ["system", "geist", "serif", "mono"] as const;
const contrasts = ["standard", "high"] as const;
const motions = ["reduced", "standard"] as const;
const buttonVariants = ["solid", "soft", "outline"] as const;
const cardVariants = ["plain", "outlined", "elevated"] as const;
const tableVariants = ["plain", "striped", "dense-grid"] as const;
const inputVariants = ["outline", "filled", "underline"] as const;

export const blueprintPreviewDesignOptions = {
	theme: themes,
	density: densities,
	shape: shapes,
	shadow: shadows,
	shadowDirection: shadowDirections,
	font: fonts,
	contrast: contrasts,
	motion: motions,
	buttonVariant: buttonVariants,
	cardVariant: cardVariants,
	tableVariant: tableVariants,
	inputVariant: inputVariants,
};

export function createBlueprintPreviewDesignSettingsFromPreset(
	designPreset: unknown,
): BlueprintPreviewDesignSettings {
	if (!isRecord(designPreset)) return cloneDefaultSettings();
	const componentVariants = isRecord(designPreset.componentVariants)
		? designPreset.componentVariants
		: {};

	return {
		theme: normalizeTheme(designPreset.theme),
		density: pickOption(
			designPreset.density,
			densities,
			defaultBlueprintPreviewDesignSettings.density,
		),
		shape: pickOption(
			designPreset.shape || designPreset.radius,
			shapes,
			defaultBlueprintPreviewDesignSettings.shape,
		),
		shadow: pickOption(
			designPreset.shadow,
			shadows,
			defaultBlueprintPreviewDesignSettings.shadow,
		),
		shadowDirection: pickOption(
			designPreset.shadowDirection,
			shadowDirections,
			defaultBlueprintPreviewDesignSettings.shadowDirection,
		),
		font: normalizeFont(designPreset.font ?? designPreset.fontScale),
		contrast: pickOption(
			designPreset.contrast,
			contrasts,
			defaultBlueprintPreviewDesignSettings.contrast,
		),
		motion: pickOption(
			designPreset.motion,
			motions,
			defaultBlueprintPreviewDesignSettings.motion,
		),
		componentVariants: {
			button: pickOption(
				componentVariants.button,
				buttonVariants,
				defaultBlueprintPreviewDesignSettings.componentVariants.button,
			),
			card: pickOption(
				componentVariants.card,
				cardVariants,
				defaultBlueprintPreviewDesignSettings.componentVariants.card,
			),
			table: pickOption(
				componentVariants.table,
				tableVariants,
				defaultBlueprintPreviewDesignSettings.componentVariants.table,
			),
			input: pickOption(
				componentVariants.input,
				inputVariants,
				defaultBlueprintPreviewDesignSettings.componentVariants.input,
			),
		},
	};
}

export const createBlueprintPreviewDesignSettings =
	createBlueprintPreviewDesignSettingsFromPreset;

export function createBlueprintDesignReference(input: {
	blueprintId: string;
	capturedAt?: string;
	settings: BlueprintPreviewDesignSettings;
}): BlueprintDesignReference {
	return {
		source: "blueprint-preview",
		blueprintId: input.blueprintId,
		capturedAt: input.capturedAt || new Date().toISOString(),
		settings: input.settings,
		tokenMapping: {
			theme: input.settings.theme,
			density: input.settings.density,
			radius: input.settings.shape,
			shadow: input.settings.shadow,
			shadowDirection: input.settings.shadowDirection,
			font: input.settings.font,
			contrast: input.settings.contrast,
			motion: input.settings.motion,
		},
		notes: [
			"Blueprint Preview is a specification-review mock, not production UI source.",
			"Use these selections as implementation-plan design reference material.",
		],
	};
}

export function designReferenceSummary(
	settings: BlueprintPreviewDesignSettings,
): string {
	return [
		`Theme: ${settings.theme}`,
		`Density: ${settings.density}`,
		`Shape: ${settings.shape}`,
		`Shadow: ${settings.shadow}`,
		`Shadow direction: ${settings.shadowDirection}`,
		`Font: ${settings.font}`,
		`Contrast: ${settings.contrast}`,
		`Motion: ${settings.motion}`,
		`Component variants: button=${settings.componentVariants.button}, card=${settings.componentVariants.card}, table=${settings.componentVariants.table}, input=${settings.componentVariants.input}`,
	].join("\n");
}

function normalizeTheme(
	value: unknown,
): BlueprintPreviewDesignSettings["theme"] {
	if (value === "nightworkers-light") return "light";
	if (value === "nightworkers-dark") return "dark";
	if (value === "fire") return "campfire";
	return pickOption(value, themes, defaultBlueprintPreviewDesignSettings.theme);
}

function normalizeFont(value: unknown): BlueprintPreviewDesignSettings["font"] {
	if (value === "small" || value === "default" || value === "large")
		return "geist";
	return pickOption(value, fonts, defaultBlueprintPreviewDesignSettings.font);
}

function cloneDefaultSettings(): BlueprintPreviewDesignSettings {
	return {
		...defaultBlueprintPreviewDesignSettings,
		componentVariants: {
			...defaultBlueprintPreviewDesignSettings.componentVariants,
		},
	};
}

function pickOption<const T extends readonly string[]>(
	value: unknown,
	options: T,
	fallback: T[number],
): T[number] {
	return typeof value === "string" && options.includes(value)
		? value
		: fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
