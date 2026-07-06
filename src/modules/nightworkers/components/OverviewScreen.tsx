import {
	AlertTriangle,
	BarChart3,
	CircleDollarSign,
	Database,
	RefreshCw,
} from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import {
	formatCurrency,
	formatDateTime,
	formatTokenCount,
} from "../../../i18n/format";
import { fetchOverview } from "../nightWorkersCommands";
import { handleWorkbenchAnchorClick } from "../routing/workbench-link-click";
import {
	type OverviewRange,
	serializeWorkbenchRoute,
} from "../routing/workbench-route-state";
import type {
	NightWorkersCurrency,
	OverviewDashboard,
	Repository,
} from "../types";

type OverviewScreenProps = {
	projects: Repository[];
	range: OverviewRange;
	projectFilterId: string | null;
	onRangeChange: (range: OverviewRange) => void;
	onProjectFilterChange: (projectId: string | null) => void;
	onOpenSession: (sessionId: string) => void;
};

const overviewShellStyle = {
	background: "var(--nw-background)",
	color: "var(--nw-text)",
} satisfies React.CSSProperties;

const panelStyle = {
	background: "var(--nw-panel)",
	borderColor: "var(--nw-border)",
	borderRadius: "var(--nw-radius)",
	boxShadow: "var(--nw-shadow)",
	color: "var(--nw-text)",
} satisfies React.CSSProperties;

const controlStyle = {
	background: "var(--nw-panel)",
	borderColor: "var(--nw-border)",
	borderRadius: "var(--nw-control-radius)",
	color: "var(--nw-text)",
} satisfies React.CSSProperties;

const mutedTextStyle = {
	color: "var(--nw-muted-text)",
} satisfies React.CSSProperties;

const subtleTextStyle = {
	color: "var(--nw-subtle-text)",
} satisfies React.CSSProperties;

const primaryTextStyle = {
	color: "var(--nw-primary)",
} satisfies React.CSSProperties;

const tableBorderStyle = {
	borderColor: "var(--nw-border)",
} satisfies React.CSSProperties;

export function OverviewScreen({
	projects,
	range,
	projectFilterId,
	onRangeChange,
	onProjectFilterChange,
	onOpenSession,
}: OverviewScreenProps) {
	const [dashboard, setDashboard] = useState<OverviewDashboard | null>(null);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const { t } = useTranslation();

	const language = dashboard?.settings.language || "ja";
	const timezone = dashboard?.scope.timezone || "Asia/Tokyo";
	const currency = (dashboard?.scope.currency || "JPY") as NightWorkersCurrency;

	const query = useMemo(() => {
		const params = new URLSearchParams({ range });
		if (projectFilterId) params.set("repositoryId", projectFilterId);
		return params.toString();
	}, [range, projectFilterId]);

	const loadOverview = useCallback(async () => {
		setIsLoading(true);
		setError(null);
		try {
			const res = await fetchOverview(query);
			if (!res.ok)
				throw new Error(t("overview.error.loadFailed", { status: res.status }));
			const data = (await res.json()) as OverviewDashboard;
			setDashboard(data);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setIsLoading(false);
		}
	}, [query, t]);

	useEffect(() => {
		void loadOverview();
		const timer = window.setInterval(() => void loadOverview(), 15_000);
		return () => window.clearInterval(timer);
	}, [loadOverview]);

	const maxBucketTokens = Math.max(
		1,
		...(dashboard?.dailyUsage || []).map((p) => p.totalTokens),
	);
	const hasDailyUsageData = (dashboard?.dailyUsage || []).some(
		(bucket) => bucket.totalTokens > 0,
	);

	return (
		<div
			className="nightworkers-scrollbar h-full min-h-0 overflow-y-auto p-6"
			style={overviewShellStyle}
		>
			<div className="mx-auto max-w-7xl space-y-6">
				<header
					className="flex flex-wrap items-start justify-between gap-4 border-b pb-4"
					style={tableBorderStyle}
				>
					<div>
						<h1 className="flex items-center gap-2 text-xl font-bold">
							<BarChart3 className="h-5 w-5" style={primaryTextStyle} />
							{t("overview.title")}
						</h1>
						<p className="mt-1 text-xs" style={mutedTextStyle}>
							{t("overview.subtitle")}
						</p>
					</div>
					<div className="flex flex-wrap items-center gap-2">
						<select
							value={projectFilterId || "all"}
							onChange={(event) =>
								onProjectFilterChange(
									event.target.value === "all" ? null : event.target.value,
								)
							}
							className="h-9 border px-3 text-xs"
							style={controlStyle}
						>
							<option value="all">{t("overview.filter.allProjects")}</option>
							{projects.map((project) => (
								<option key={project.id} value={project.id}>
									{project.name}
								</option>
							))}
						</select>
						{(["24h", "7d", "30d", "all"] as const).map((value) => (
							<a
								key={value}
								href={serializeWorkbenchRoute({
									kind: "overview",
									range: value,
									projectId: projectFilterId,
								})}
								onClick={(event) =>
									handleWorkbenchAnchorClick(event, () => onRangeChange(value))
								}
								className="inline-flex h-9 items-center border px-3 text-xs"
								aria-current={range === value ? "page" : undefined}
								style={
									range === value
										? {
												background:
													"color-mix(in srgb, var(--nw-primary) 14%, var(--nw-panel))",
												borderColor: "var(--nw-primary)",
												borderRadius: "var(--nw-control-radius)",
												color: "var(--nw-primary)",
											}
										: controlStyle
								}
							>
								{t(`overview.range.${value}`)}
							</a>
						))}
						<Button
							type="button"
							variant="ghost"
							className="h-9 px-3 text-xs"
							style={{ color: "var(--nw-text)" }}
							onClick={loadOverview}
						>
							{isLoading ? (
								<RefreshCw className="h-3.5 w-3.5 animate-spin" />
							) : (
								<RefreshCw className="h-3.5 w-3.5" />
							)}
							{t("overview.action.refresh")}
						</Button>
					</div>
				</header>

				{error ? (
					<div
						className="border p-3 text-xs"
						style={{
							background:
								"color-mix(in srgb, var(--nw-danger) 10%, var(--nw-panel))",
							borderColor:
								"color-mix(in srgb, var(--nw-danger) 45%, var(--nw-border))",
							borderRadius: "var(--nw-radius)",
							color: "var(--nw-danger)",
						}}
					>
						{error}
					</div>
				) : null}

				{dashboard ? (
					<>
						<section className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
							<KpiCard
								label={t("overview.kpi.totalTokens")}
								value={formatTokenCount(dashboard.usage.totalTokens)}
								sub={t("overview.kpi.callCount", {
									count: dashboard.usage.callCount,
								})}
							/>
							<KpiCard
								label={t("overview.kpi.input")}
								value={formatTokenCount(dashboard.usage.inputTokens)}
								sub={t("overview.kpi.inputDetails", {
									prompt: formatTokenCount(dashboard.usage.promptInputTokens),
									cached: formatTokenCount(dashboard.usage.cachedInputTokens),
								})}
							/>
							<KpiCard
								label={t("overview.kpi.output")}
								value={formatTokenCount(dashboard.usage.outputTokens)}
								sub={t("overview.kpi.reasoningTokens", {
									tokens: formatTokenCount(
										dashboard.usage.reasoningOutputTokens,
									),
								})}
							/>
							<KpiCard
								label={t("overview.kpi.outputSpeed")}
								value={formatTokensPerSecond(
									dashboard.usage.outputTokensPerSecond,
								)}
								sub={t("overview.kpi.outputSpeedDetails", {
									count: dashboard.usage.measuredDurationCallCount,
								})}
							/>
							<KpiCard
								label={t("overview.kpi.stateCard")}
								value={formatTokenCount(dashboard.usage.stateCardTokens)}
								sub={t("overview.kpi.inputBreakdown")}
							/>
							<KpiCard
								label={t("overview.kpi.cost")}
								value={formatCurrency(
									dashboard.cost.estimatedTotal,
									currency,
									language,
								)}
								sub={t("overview.kpi.pricedCalls", {
									priced: dashboard.cost.pricedCallCount,
									unpriced: dashboard.cost.unpricedCallCount,
								})}
							/>
						</section>

						<section className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
							<div className="border p-4" style={panelStyle}>
								<SectionTitle
									icon={<BarChart3 className="h-4 w-4" />}
									title={t("overview.section.daily")}
								/>
								{!hasDailyUsageData ? (
									<EmptyState text={t("overview.empty")} />
								) : (
									<div className="mt-4 flex h-48 items-end gap-1">
										{dashboard.dailyUsage.map((bucket) => (
											<div
												key={bucket.key}
												className="flex min-w-0 flex-1 flex-col items-center gap-1"
											>
												<div
													className="w-full rounded-t"
													style={{
														background: "var(--nw-primary)",
														height: `${Math.max(4, (bucket.totalTokens / maxBucketTokens) * 170)}px`,
													}}
													title={t("overview.chart.bucketTokens", {
														bucket: bucket.key,
														tokens: formatTokenCount(bucket.totalTokens),
													})}
												/>
												<span
													className="max-w-full truncate text-[9px]"
													style={subtleTextStyle}
												>
													{bucket.key}
												</span>
											</div>
										))}
									</div>
								)}
							</div>

							<div className="border p-4" style={panelStyle}>
								<SectionTitle
									icon={<CircleDollarSign className="h-4 w-4" />}
									title={t("overview.section.cost")}
								/>
								<dl className="mt-4 grid gap-3 text-xs">
									<MetricRow
										label={t("overview.cost.input")}
										value={formatCurrency(
											dashboard.cost.inputCost,
											currency,
											language,
										)}
									/>
									<MetricRow
										label={t("overview.cost.cachedInput")}
										value={formatCurrency(
											dashboard.cost.cachedInputCost,
											currency,
											language,
										)}
									/>
									<MetricRow
										label={t("overview.cost.output")}
										value={formatCurrency(
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
												: dashboard.cost.creditTotal.toFixed(3)
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
										value={formatDateTime(
											dashboard.generatedAt,
											language,
											timezone,
										)}
									/>
								</dl>
							</div>
						</section>

						{dashboard.warnings.length > 0 ? (
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
									{dashboard.warnings.map((warning, _index) => (
										<span
											key={`${String(warning.code)}-${String(warning.message || "")}`}
											className="border px-2 py-1"
											style={{
												borderColor:
													"color-mix(in srgb, var(--nw-primary) 32%, var(--nw-border))",
												borderRadius: "var(--nw-control-radius)",
												color: "var(--nw-muted-text)",
											}}
										>
											{formatWarningCode(String(warning.code), t)}
										</span>
									))}
								</div>
							</section>
						) : null}

						<section className="grid gap-4 xl:grid-cols-2">
							<OverviewTable title={t("overview.section.models")}>
								<thead style={subtleTextStyle}>
									<tr>
										<th className="py-2 text-left">
											{t("overview.table.model")}
										</th>
										<th className="py-2 text-right">
											{t("overview.table.tokens")}
										</th>
										<th className="py-2 text-right">
											{t("overview.table.outputSpeed")}
										</th>
										<th className="py-2 text-right">
											{t("overview.table.calls")}
										</th>
										<th className="py-2 text-right">
											{t("overview.table.cost")}
										</th>
										<th className="py-2 text-right">
											{t("overview.table.pricing")}
										</th>
									</tr>
								</thead>
								<tbody>
									{dashboard.modelBreakdown.map((item) => (
										<tr
											key={`${item.provider}:${item.model}`}
											className="border-t"
											style={tableBorderStyle}
										>
											<td className="max-w-[220px] truncate py-2">
												<div className="font-semibold">
													{item.model || t("overview.value.unknownModel")}
												</div>
												<div className="text-[10px]" style={subtleTextStyle}>
													{item.provider}
												</div>
											</td>
											<td className="py-2 text-right">
												{formatTokenCount(item.totalTokens)}
											</td>
											<td className="py-2 text-right">
												{formatTokensPerSecond(item.outputTokensPerSecond)}
											</td>
											<td className="py-2 text-right">{item.callCount}</td>
											<td className="py-2 text-right">
												{formatCurrency(item.estimatedCost, currency, language)}
											</td>
											<td className="py-2 text-right">
												{t(`overview.pricingStatus.${item.pricingStatus}`)}
											</td>
										</tr>
									))}
								</tbody>
							</OverviewTable>

							<OverviewTable title={t("overview.section.recent")}>
								<thead style={subtleTextStyle}>
									<tr>
										<th className="py-2 text-left">
											{t("overview.table.call")}
										</th>
										<th className="py-2 text-right">
											{t("overview.table.tokens")}
										</th>
										<th className="py-2 text-right">
											{t("overview.table.outputSpeed")}
										</th>
										<th className="py-2 text-right">
											{t("overview.table.cost")}
										</th>
									</tr>
								</thead>
								<tbody>
									{dashboard.recentExpensiveCalls.map((call) => (
										<tr
											key={call.id}
											className="border-t"
											style={tableBorderStyle}
										>
											<td className="max-w-[280px] py-2">
												<a
													href={serializeWorkbenchRoute({
														kind: "session",
														sessionId: call.taskId,
														artifact: null,
													})}
													className="truncate text-left font-semibold"
													style={primaryTextStyle}
													onClick={(event) =>
														handleWorkbenchAnchorClick(event, () =>
															onOpenSession(call.taskId),
														)
													}
												>
													{call.taskTitle || call.label}
												</a>
												<div
													className="truncate text-[10px]"
													style={subtleTextStyle}
												>
													{call.provider} /{" "}
													{call.model || t("overview.value.unknownModel")} /{" "}
													{formatDateTime(call.createdAt, language, timezone)}
												</div>
											</td>
											<td className="py-2 text-right">
												{formatTokenCount(call.totalTokens)}
											</td>
											<td className="py-2 text-right">
												{formatTokensPerSecond(call.outputTokensPerSecond)}
											</td>
											<td className="py-2 text-right">
												{formatCurrency(call.estimatedCost, currency, language)}
											</td>
										</tr>
									))}
								</tbody>
							</OverviewTable>
						</section>
					</>
				) : (
					<EmptyState text={t("overview.empty")} />
				)}
			</div>
		</div>
	);
}

function KpiCard({
	label,
	value,
	sub,
}: {
	label: string;
	value: string;
	sub: string;
}) {
	return (
		<div className="border p-4" style={panelStyle}>
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

function SectionTitle({
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

function MetricRow({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex items-center justify-between gap-4">
			<dt style={subtleTextStyle}>{label}</dt>
			<dd className="truncate font-semibold">{value}</dd>
		</div>
	);
}

function OverviewTable({
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

function EmptyState({ text }: { text: string }) {
	return (
		<div
			className="border border-dashed p-8 text-center text-xs"
			style={{
				background: "var(--nw-surface)",
				borderColor: "var(--nw-border)",
				borderRadius: "var(--nw-radius)",
				color: "var(--nw-subtle-text)",
			}}
		>
			{text}
		</div>
	);
}

function formatTokensPerSecond(value: number | null) {
	if (value === null) return "—";
	if (value >= 100) return `${value.toFixed(0)} tok/s`;
	if (value >= 10) return `${value.toFixed(1)} tok/s`;
	return `${value.toFixed(2)} tok/s`;
}

function formatWarningCode(
	code: string,
	t: ReturnType<typeof useTranslation>["t"],
) {
	return t(`overview.warning.${code}`, { defaultValue: code });
}
