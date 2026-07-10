import { formatCurrency } from "../../i18n/format";
import type { AppCurrency, AppLanguage } from "../../i18n/types";

const COMPACT_UNITS = [
	{ value: 1_000_000_000_000_000, suffix: "P" },
	{ value: 1_000_000_000_000, suffix: "T" },
	{ value: 1_000_000_000, suffix: "G" },
	{ value: 1_000_000, suffix: "M" },
	{ value: 1_000, suffix: "K" },
] as const;

type CompactNumberOptions = {
	maximumFractionDigits?: number;
};

export function formatCompactNumber(
	value: number,
	options: CompactNumberOptions = {},
) {
	if (!Number.isFinite(value)) return "—";
	const normalized = Object.is(value, -0) ? 0 : value;
	const maximumFractionDigits = Math.min(
		2,
		Math.max(0, options.maximumFractionDigits ?? 2),
	);
	const absolute = Math.abs(normalized);
	const initialIndex = COMPACT_UNITS.findIndex(
		(unit) => absolute >= unit.value,
	);
	if (initialIndex === -1) {
		return formatMantissa(normalized, maximumFractionDigits);
	}

	let unitIndex = initialIndex;
	let scaled = normalized / COMPACT_UNITS[unitIndex].value;
	while (
		unitIndex > 0 &&
		Math.abs(roundTo(scaled, maximumFractionDigits)) >= 1_000
	) {
		unitIndex -= 1;
		scaled = normalized / COMPACT_UNITS[unitIndex].value;
	}

	return `${formatMantissa(scaled, maximumFractionDigits)}${COMPACT_UNITS[unitIndex].suffix}`;
}

export function formatExactNumber(value: number, language: AppLanguage) {
	if (!Number.isFinite(value)) return "—";
	return new Intl.NumberFormat(language === "en" ? "en-US" : "ja-JP", {
		maximumFractionDigits: 20,
	}).format(Object.is(value, -0) ? 0 : value);
}

export function formatCompactCurrency(
	value: number | null,
	currency: AppCurrency,
	language: AppLanguage,
) {
	if (value === null || !Number.isFinite(value)) return "—";
	if (Math.abs(value) < 1_000) return formatCurrency(value, currency, language);
	const locale = language === "en" ? "en-US" : "ja-JP";
	const symbol =
		new Intl.NumberFormat(locale, {
			style: "currency",
			currency,
			currencyDisplay: "narrowSymbol",
		})
			.formatToParts(0)
			.find((part) => part.type === "currency")?.value ?? currency;
	const sign = value < 0 ? "-" : "";
	return `${sign}${symbol}${formatCompactNumber(Math.abs(value))}`;
}

function formatMantissa(value: number, maximumFractionDigits: number) {
	return new Intl.NumberFormat("en-US", {
		maximumFractionDigits,
		useGrouping: false,
	}).format(value);
}

function roundTo(value: number, fractionDigits: number) {
	const factor = 10 ** fractionDigits;
	return Math.round(value * factor) / factor;
}
