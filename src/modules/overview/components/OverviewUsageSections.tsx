import type { TFunction } from "i18next";
import { AlertTriangle, BarChart3, CircleDollarSign } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { OverviewDashboard } from "../../../../shared/schemas/overview.schema";
import { formatDateTime } from "../../../i18n/format";
import type { OverviewRange } from "../../nightworkers/routing/workbench-route-state";
import type { NightWorkersCurrency } from "../../settings/settingsTypes";
import {
	formatCompactCurrency,
	formatCompactNumber,
	formatExactNumber,
} from "../overviewFormat";
import {
	panelStyle,
	primaryTextStyle,
	subtleTextStyle,
	tokenSegmentStyles,
} from "../overviewStyles";
import {
	getSeparatedTokenTotal,
	getUncachedInputTokens,
	type OverviewViewModel,
} from "../overviewViewModel";
import {
	EmptyState,
	formatExactCurrencyValue,
	MetricRow,
	SectionTitle,
} from "./OverviewPrimitives";

export function OverviewUsageSections({
	dashboard,
	viewModel,
	range,
	language,
	timezone,
	currency,
}: {
	dashboard: OverviewDashboard;
	viewModel: OverviewViewModel;
	range: OverviewRange;
	language: "ja" | "en";
	timezone: string;
	currency: NightWorkersCurrency;
}) {
	const { t } = useTranslation();
	return (
		<>
			<section
				className={
					range === "all"
						? "grid gap-4"
						: "grid gap-4 xl:grid-cols-[1.2fr_0.8fr]"
				}
			>
				{range === "all" ? null : (
					<div className="border p-4" style={panelStyle}>
						<SectionTitle
							icon={<BarChart3 className="h-4 w-4" />}
							title={t("overview.section.daily")}
						/>
						{!viewModel.hasDailyUsageData ? (
							<EmptyState text={t("overview.empty")} />
						) : (
							<>
								<TokenLegend />
								<div className="mt-4 flex h-48 items-end gap-1">
									{dashboard.dailyUsage.map((bucket) => {
										const uncached = getUncachedInputTokens(bucket);
										const cached = bucket.cachedInputTokens;
										const output = bucket.outputTokens;
										const total = getSeparatedTokenTotal(bucket);
										return (
											<div
												key={bucket.key}
												className="flex min-w-0 flex-1 flex-col items-center gap-1"
											>
												<div
													className="flex w-full flex-col justify-end overflow-hidden rounded-t"
													style={{
														height: `${Math.max(4, (total / viewModel.maxBucketTokens) * 170)}px`,
													}}
													title={t("overview.chart.bucketTokenParts", {
														bucket: bucket.key,
														input: formatExactNumber(uncached, language),
														cached: formatExactNumber(cached, language),
														output: formatExactNumber(output, language),
													})}
												>
													<TokenSegment
														value={output}
														total={total}
														tone="output"
													/>
													<TokenSegment
														value={cached}
														total={total}
														tone="cachedInput"
													/>
													<TokenSegment
														value={uncached}
														total={total}
														tone="input"
													/>
												</div>
												{range === "30d" ? null : (
													<span
														className="max-w-full truncate text-[9px]"
														style={subtleTextStyle}
													>
														{bucket.key}
													</span>
												)}
											</div>
										);
									})}
								</div>
							</>
						)}
					</div>
				)}

				<div className="border p-4" style={panelStyle}>
					<SectionTitle
						icon={<CircleDollarSign className="h-4 w-4" />}
						title={t("overview.section.cost")}
					/>
					<dl className="mt-4 grid gap-3 text-xs">
						<MetricRow
							label={t("overview.cost.input")}
							value={formatCompactCurrency(
								dashboard.cost.inputCost,
								currency,
								language,
							)}
							exactValue={formatExactCurrencyValue(
								dashboard.cost.inputCost,
								currency,
								language,
							)}
						/>
						<MetricRow
							label={t("overview.cost.cachedInput")}
							value={formatCompactCurrency(
								dashboard.cost.cachedInputCost,
								currency,
								language,
							)}
							exactValue={formatExactCurrencyValue(
								dashboard.cost.cachedInputCost,
								currency,
								language,
							)}
						/>
						<MetricRow
							label={t("overview.cost.output")}
							value={formatCompactCurrency(
								dashboard.cost.outputCost,
								currency,
								language,
							)}
							exactValue={formatExactCurrencyValue(
								dashboard.cost.outputCost,
								currency,
								language,
							)}
						/>
						<MetricRow
							label={t("overview.cost.codexCredits")}
							value={
								dashboard.cost.creditTotal === null
									? t("overview.value.notAvailable")
									: formatCompactNumber(dashboard.cost.creditTotal)
							}
							exactValue={
								dashboard.cost.creditTotal === null
									? "—"
									: `${formatExactNumber(dashboard.cost.creditTotal, language)} ${t("overview.value.credits", { lng: language })}`
							}
						/>
						<MetricRow
							label={t("overview.cost.exchangeRates")}
							value={
								dashboard.cost.fxRate
									? t("overview.cost.fxRate", {
											base: dashboard.cost.fxBaseCurrency,
											currency,
											rate: dashboard.cost.fxRate.toFixed(4),
										})
									: t("overview.value.notAvailable")
							}
						/>
						<MetricRow
							label={t("overview.cost.updated")}
							value={formatDateTime(dashboard.generatedAt, language, timezone)}
						/>
					</dl>
				</div>
			</section>
			<OverviewWarnings warnings={dashboard.warnings} t={t} />
		</>
	);
}

function OverviewWarnings({
	warnings,
	t,
}: {
	warnings: OverviewDashboard["warnings"];
	t: TFunction;
}) {
	if (warnings.length === 0) return null;
	return (
		<section
			className="border p-3 text-xs"
			style={{
				background:
					"color-mix(in srgb, var(--nw-primary) 10%, var(--nw-panel))",
				borderColor:
					"color-mix(in srgb, var(--nw-primary) 36%, var(--nw-border))",
				borderRadius: "var(--nw-radius)",
				color: "var(--nw-text)",
			}}
		>
			<div className="flex items-center gap-2 font-semibold">
				<AlertTriangle className="h-4 w-4" style={primaryTextStyle} />
				{t("overview.warning.title")}
			</div>
			<div className="mt-2 flex flex-wrap gap-2">
				{warnings.map((warning, index) => (
					<span
						key={JSON.stringify([
							warning.code,
							warning.message,
							warning.provider,
							warning.model,
							index,
						])}
						className="border px-2 py-1"
						style={{
							borderColor:
								"color-mix(in srgb, var(--nw-primary) 32%, var(--nw-border))",
							borderRadius: "var(--nw-control-radius)",
							color: "var(--nw-muted-text)",
						}}
					>
						{formatWarningCode(warning.code, t)}
					</span>
				))}
			</div>
		</section>
	);
}

function TokenLegend() {
	const { t } = useTranslation();
	const items = [
		{ key: "input", label: t("overview.table.input") },
		{ key: "cachedInput", label: t("overview.table.cachedInput") },
		{ key: "output", label: t("overview.table.output") },
	] as const;
	return (
		<div
			className="mt-3 flex flex-wrap gap-3 text-[10px]"
			style={subtleTextStyle}
		>
			{items.map((item) => (
				<span key={item.key} className="inline-flex items-center gap-1.5">
					<span
						className="h-2 w-2 rounded-full"
						style={tokenSegmentStyles[item.key]}
					/>
					{item.label}
				</span>
			))}
		</div>
	);
}

function TokenSegment({
	value,
	total,
	tone,
}: {
	value: number;
	total: number;
	tone: keyof typeof tokenSegmentStyles;
}) {
	if (value <= 0 || total <= 0) return null;
	return (
		<div
			style={{
				...tokenSegmentStyles[tone],
				height: `${Math.max(2, (value / total) * 100)}%`,
			}}
		/>
	);
}

function formatWarningCode(code: string, t: TFunction) {
	const key = `overview.warning.${code}`;
	const translated = t(key);
	return translated === key ? code : translated;
}
