import type { TFunction } from "i18next";

export function previewColumns(props: Record<string, unknown>) {
	const propColumns = toObjectArray(props.columns);
	if (propColumns.length > 0) {
		return propColumns.map((column, index) => ({
			key: String(column.key || column.name || index),
			label: String(
				column.label || column.name || column.key || `Column ${index + 1}`,
			),
		}));
	}

	return [
		{ key: "name", label: "Name" },
		{ key: "status", label: "Status" },
		{ key: "owner", label: "Owner" },
	];
}

export function previewRows(
	props: Record<string, unknown>,
	columns: Array<{ key: string; label: string }>,
	limit = 4,
) {
	const rows = toObjectArray(props.rows);
	if (rows.length > 0) return rows.slice(0, limit);

	return Array.from({ length: limit }, (_, rowIndex) =>
		Object.fromEntries(
			columns.map((column, columnIndex) => [
				column.key,
				columnIndex === 0
					? `${column.label} ${rowIndex + 1}`
					: `Sample ${rowIndex + 1}`,
			]),
		),
	);
}

type PreviewImageSize = "small" | "large";

export const PREVIEW_CHART_HEIGHT = 176;
export const PREVIEW_CHART_MIN_WIDTH = 280;

const PREVIEW_IMAGE_SIZES: Record<
	PreviewImageSize,
	{ width: number; height: number }
> = {
	small: { width: 240, height: 135 },
	large: { width: 768, height: 432 },
};

export function previewImageFor(
	item: Record<string, unknown>,
	size: PreviewImageSize,
	seed: string,
) {
	const image = firstString(
		item.imageUrl,
		item.thumbnailUrl,
		item.posterUrl,
		item.coverUrl,
		item.src,
		item.image,
		item.thumbnail,
		nestedImageValue(item.image),
		nestedImageValue(item.media),
	);
	if (image) return image;

	const dimensions = PREVIEW_IMAGE_SIZES[size];
	return `https://picsum.photos/seed/${encodeURIComponent(seed)}/${dimensions.width}/${dimensions.height}.webp`;
}

export function previewImageAlt(
	item: Record<string, unknown>,
	fallback: string,
) {
	return (
		firstString(item.alt, item.title, item.label, item.name, item.caption) ||
		fallback
	);
}

function nestedImageValue(value: unknown) {
	if (!isObject(value)) return "";
	return firstString(value.url, value.src, value.imageUrl, value.thumbnailUrl);
}

function firstString(...values: unknown[]) {
	for (const value of values) {
		if (typeof value === "string" && value.trim()) return value;
	}
	return "";
}

export function chartPreviewItems(props: Record<string, unknown>) {
	const sourceItems = toObjectArray(props.data || props.items || props.cards);
	if (sourceItems.length > 0) {
		return sourceItems.slice(0, 6).map((item, index) => ({
			label: String(item.label || item.title || `Item ${index + 1}`),
			value: previewChartValue(item.value ?? item.max, 24 + index * 14),
		}));
	}

	const columns = previewColumns(props);
	return columns.slice(0, 5).map((column, index) => ({
		label: column.label,
		value: 24 + index * 14,
	}));
}

function previewChartValue(value: unknown, fallback: number) {
	const numberValue = Number(value);
	return Number.isFinite(numberValue) ? numberValue : fallback;
}

export function compactChartLabel(value: unknown) {
	const label = String(value || "");
	return label.length > 9 ? `${label.slice(0, 8)}...` : label;
}

export function previewGenericItems(
	props: Record<string, unknown>,
	t: TFunction,
) {
	const propItems = toObjectArray(
		props.items ||
			props.columns ||
			props.controls ||
			props.lines ||
			props.insights,
	);
	if (propItems.length > 0) {
		return propItems.slice(0, 5).map((item, index) => ({
			title: String(item.title || item.label || item.id || `Item ${index + 1}`),
			description: String(
				item.description || item.body || item.content || item.value || "",
			),
		}));
	}

	const columns = previewColumns(props);
	if (columns.length > 0) {
		return columns.slice(0, 4).map((column) => ({
			title: column.label,
			description: `Sample ${column.key}`,
		}));
	}

	return [
		{
			title: String(props.title || t("blueprint.preview.sectionFallbackTitle")),
			description: String(
				props.description ||
					props.body ||
					t("blueprint.preview.sectionFallbackDescription"),
			),
		},
	];
}

export function sectionFallbackText(componentName: string, t: TFunction) {
	return t("blueprint.preview.sectionFallbackText", {
		componentName: componentName || "Section",
	});
}

export function titleCase(value: string) {
	return value
		.replace(/[-_]+/g, " ")
		.replace(/\b\w/g, (letter) => letter.toUpperCase())
		.trim();
}

export function labelForOption(value: string) {
	if (value in shadowDirectionLabels) return shadowDirectionLabels[value];
	if (value in optionLabels) return optionLabels[value];
	return titleCase(value);
}

export function labelForOptionA11y(value: string) {
	if (value in shadowDirectionLabels)
		return `Shadow direction ${shadowDirectionA11yLabels[value]}`;
	return labelForOption(value);
}

const shadowDirectionLabels: Record<string, string> = {
	"0deg": "↓",
	"45deg": "↘",
	"90deg": "→",
	"135deg": "↗",
	"180deg": "↑",
	"225deg": "↖",
	"270deg": "←",
	"315deg": "↙",
};

const optionLabels: Record<string, string> = {
	campfire: "Camp Fire",
};

const shadowDirectionA11yLabels: Record<string, string> = {
	"0deg": "down",
	"45deg": "down right",
	"90deg": "right",
	"135deg": "up right",
	"180deg": "up",
	"225deg": "up left",
	"270deg": "left",
	"315deg": "down left",
};

export function isObject(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function toObjectArray(value: unknown): Array<Record<string, unknown>> {
	return Array.isArray(value) ? value.filter(isObject) : [];
}
