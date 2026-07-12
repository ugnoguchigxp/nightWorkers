import { Database } from "lucide-react";
import type React from "react";
import { useTranslation } from "react-i18next";
import type { NightWorkersCurrency } from "../../settings";
import {
	formatCompactCurrency,
	formatCompactNumber,
	formatExactNumber,
} from "../overviewFormat";
import {
	panelStyle,
	primaryTextStyle,
	subtleTextStyle,
} from "../overviewStyles";

export function KpiCard({
	label,
	value,
	exactValue,
	sub,
}: {
	label: string;
	value: string;
	exactValue: string;
	sub: string;
}) {
	return (
		<div className="border p-4" style={panelStyle} title={exactValue}>
			<span className="sr-only">
				{label} {exactValue}
			</span>
			<div
				className="text-[11px] font-semibold uppercase"
				style={subtleTextStyle}
			>
				{label}
			</div>
			<div className="mt-2 truncate text-2xl font-bold">{value}</div>
			<div className="mt-1 truncate text-xs" style={subtleTextStyle}>
				{sub}
			</div>
		</div>
	);
}

export function SectionTitle({
	icon,
	title,
}: {
	icon: React.ReactNode;
	title: string;
}) {
	return (
		<h2 className="flex items-center gap-2 text-sm font-bold">
			<span style={primaryTextStyle}>{icon}</span>
			{title}
		</h2>
	);
}

export function MetricRow({
	label,
	value,
	exactValue,
}: {
	label: string;
	value: string;
	exactValue?: string;
}) {
	return (
		<div className="flex items-center justify-between gap-4">
			<dt style={subtleTextStyle}>{label}</dt>
			<dd className="truncate font-semibold" title={exactValue}>
				{value}
			</dd>
		</div>
	);
}

export function CompactNumberValue({
	value,
	language,
}: {
	value: number;
	language: "ja" | "en";
}) {
	return (
		<span title={formatExactNumber(value, language)}>
			{formatCompactNumber(value)}
		</span>
	);
}

export function CompactCostValue({
	estimatedCost,
	estimatedCredits,
	currency,
	language,
}: {
	estimatedCost: number | null;
	estimatedCredits: number | null;
	currency: NightWorkersCurrency;
	language: "ja" | "en";
}) {
	const { t } = useTranslation();
	const creditsLabel = t("overview.value.credits", { lng: language });
	const hasCurrencyCost = estimatedCost !== null;
	const hasCredits = estimatedCredits !== null && estimatedCredits > 0;
	if (!hasCurrencyCost && !hasCredits) return <span>—</span>;
	return (
		<span
			className="inline-flex flex-col"
			title={formatExactCostValue({
				estimatedCost,
				estimatedCredits,
				currency,
				language,
				creditsLabel,
			})}
		>
			{hasCurrencyCost
				? formatCompactCurrency(estimatedCost, currency, language)
				: null}
			{hasCredits
				? `${formatCompactNumber(estimatedCredits)} ${creditsLabel}`
				: null}
		</span>
	);
}

export function OverviewTable({
	title,
	children,
}: {
	title: string;
	children: React.ReactNode;
}) {
	return (
		<div className="border p-4" style={panelStyle}>
			<SectionTitle icon={<Database className="h-4 w-4" />} title={title} />
			<div className="nightworkers-scrollbar mt-3 max-h-80 overflow-auto">
				<table className="w-full text-xs">{children}</table>
			</div>
		</div>
	);
}

export function EmptyTableRow({ colSpan }: { colSpan: number }) {
	const { t } = useTranslation();
	return (
		<tr>
			<td
				className="py-8 text-center text-xs"
				colSpan={colSpan}
				style={subtleTextStyle}
			>
				{t("overview.empty")}
			</td>
		</tr>
	);
}

export function EmptyState({ text }: { text: string }) {
	return (
		<div
			className="mt-4 flex h-36 items-center justify-center border border-dashed text-xs"
			style={subtleTextStyle}
		>
			{text}
		</div>
	);
}

export function formatTokensPerSecond(value: number | null) {
	return value === null
		? "—"
		: `${formatCompactNumber(value, { maximumFractionDigits: 1 })} tok/s`;
}

export function formatExactCurrencyValue(
	value: number | null,
	currency: NightWorkersCurrency,
	language: "ja" | "en",
) {
	return value === null
		? "—"
		: `${formatExactNumber(value, language)} ${currency}`;
}

function formatExactCostValue(input: {
	estimatedCost: number | null;
	estimatedCredits: number | null;
	currency: NightWorkersCurrency;
	language: "ja" | "en";
	creditsLabel: string;
}) {
	return [
		input.estimatedCost === null
			? null
			: `${formatExactNumber(input.estimatedCost, input.language)} ${input.currency}`,
		input.estimatedCredits === null || input.estimatedCredits <= 0
			? null
			: `${formatExactNumber(input.estimatedCredits, input.language)} ${input.creditsLabel}`,
	]
		.filter(Boolean)
		.join(" / ");
}
