import { useTranslation } from "react-i18next";
import type { OverviewDashboard } from "../../../../shared/schemas/overview.schema";
import type { NightWorkersCurrency } from "../../settings";
import {
	formatCompactCurrency,
	formatCompactNumber,
	formatExactNumber,
} from "../overviewFormat";
import { panelStyle, subtleTextStyle } from "../overviewStyles";
import {
	getSeparatedTokenTotal,
	type OverviewViewModel,
} from "../overviewViewModel";
import {
	formatExactCurrencyValue,
	formatTokensPerSecond,
	KpiCard,
} from "./OverviewPrimitives";

export function OverviewMetrics({
	dashboard,
	viewModel,
	language,
	currency,
}: {
	dashboard: OverviewDashboard;
	viewModel: OverviewViewModel;
	language: "ja" | "en";
	currency: NightWorkersCurrency;
}) {
	const { t } = useTranslation();
	const tokenMetrics = viewModel.tokenMetrics.map((metric) => ({
		...metric,
		label: t(`overview.kpi.${metric.key}`),
	}));
	const displayedTokenTotal = getSeparatedTokenTotal(dashboard.usage);
	return (
		<>
			<section
				className="grid gap-2 border p-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5"
				style={panelStyle}
				aria-label={t("overview.section.tokenBreakdown")}
			>
				{tokenMetrics.map((metric) => (
					<div
						key={metric.key}
						className="min-w-0"
						title={formatExactNumber(metric.value, language)}
					>
						<span className="sr-only">
							{metric.label} {formatExactNumber(metric.value, language)} tokens
						</span>
						<div
							className="truncate text-[10px] font-semibold uppercase"
							style={subtleTextStyle}
						>
							{metric.label}
						</div>
						<div className="mt-1 truncate text-sm font-bold">
							{formatCompactNumber(metric.value)}
						</div>
					</div>
				))}
			</section>

			<section className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
				<KpiCard
					label={t("overview.kpi.runs")}
					value={formatCompactNumber(dashboard.runs.total)}
					exactValue={formatExactNumber(dashboard.runs.total, language)}
					sub={t("overview.kpi.runDetails", {
						completed: dashboard.runs.completed,
						failed: dashboard.runs.failed,
						active: dashboard.runs.active,
					})}
				/>
				<KpiCard
					label={t("overview.kpi.calls")}
					value={formatCompactNumber(dashboard.usage.callCount)}
					exactValue={`${formatExactNumber(dashboard.usage.callCount, language)} calls / ${formatExactNumber(displayedTokenTotal, language)} tokens`}
					sub={t("overview.kpi.callDetails", {
						count: dashboard.usage.callCount,
						tokens: formatCompactNumber(displayedTokenTotal),
					})}
				/>
				<KpiCard
					label={t("overview.kpi.outputSpeed")}
					value={formatTokensPerSecond(dashboard.usage.outputTokensPerSecond)}
					exactValue={
						dashboard.usage.outputTokensPerSecond === null
							? "—"
							: String(dashboard.usage.outputTokensPerSecond)
					}
					sub={t("overview.kpi.outputSpeedDetails", {
						count: dashboard.usage.measuredDurationCallCount,
					})}
				/>
				<KpiCard
					label={t("overview.kpi.cost")}
					value={formatCompactCurrency(
						dashboard.cost.estimatedTotal,
						currency,
						language,
					)}
					exactValue={formatExactCurrencyValue(
						dashboard.cost.estimatedTotal,
						currency,
						language,
					)}
					sub={t("overview.kpi.pricedCalls", {
						priced: dashboard.cost.pricedCallCount,
						unpriced: dashboard.cost.unpricedCallCount,
					})}
				/>
				<KpiCard
					label={t("overview.kpi.cacheRate")}
					value={
						viewModel.cacheRate === null
							? "—"
							: `${formatCompactNumber(viewModel.cacheRate)}%`
					}
					exactValue={
						viewModel.cacheRate === null ? "—" : `${viewModel.cacheRate}%`
					}
					sub={t("overview.kpi.cacheRateDetails")}
				/>
			</section>
		</>
	);
}
