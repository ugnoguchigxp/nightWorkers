import {
	Area,
	AreaChart,
	CartesianGrid,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import { compactChartLabel, toObjectArray } from "../previewModel";
import { analyticsDashboardChartData, analyticsTooltipStyle } from "./helpers";
import type { SectionRendererInput } from "./types";

export function renderAnalyticsDashboardSection({
	props,
}: SectionRendererInput) {
	const metrics = toObjectArray(props.metrics || props.items);
	const chartData = analyticsDashboardChartData(props);
	const metricItems =
		metrics.length > 0
			? metrics
			: [
					{ label: "Save Products", value: "178+" },
					{ label: "Stock Products", value: "20+" },
					{ label: "Sales Products", value: "190+" },
					{ label: "Job Application", value: "12+" },
				];
	return (
		<div className="grid gap-4 rounded-md border border-border bg-card p-4">
			<div className="grid gap-3 sm:grid-cols-4">
				{metricItems.slice(0, 4).map((metric, index) => (
					<div
						className="flex items-center gap-3 rounded-md border border-border bg-background p-3"
						key={String(metric.label || JSON.stringify(metric))}
					>
						<span
							className={`grid h-10 w-10 place-items-center rounded-full text-xs font-semibold ${
								index === 0
									? "bg-blue-500/15 text-blue-500"
									: index === 1
										? "bg-amber-500/15 text-amber-500"
										: index === 2
											? "bg-orange-500/15 text-orange-500"
											: "bg-indigo-500/15 text-indigo-500"
							}`}
						>
							{index + 1}
						</span>
						<div className="min-w-0">
							<div className="text-lg font-semibold text-foreground">
								{String(metric.value || index + 1)}
							</div>
							<div className="truncate text-[10px] text-muted-foreground">
								{String(metric.label || "Metric")}
							</div>
						</div>
					</div>
				))}
			</div>
			<div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_16rem]">
				<div className="rounded-md border border-border bg-background p-4">
					<div className="mb-3 flex items-center justify-between">
						<span className="text-sm font-semibold text-foreground">
							Reports
						</span>
						<span className="text-muted-foreground">...</span>
					</div>
					<div className="h-48 min-w-0 overflow-hidden rounded bg-muted p-2">
						<ResponsiveContainer height="100%" width="100%">
							<AreaChart
								data={chartData}
								margin={{ top: 12, right: 10, left: -20, bottom: 0 }}
							>
								<CartesianGrid
									stroke="var(--border)"
									strokeDasharray="3 3"
									vertical={false}
								/>
								<XAxis
									axisLine={false}
									dataKey="label"
									tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
									tickFormatter={compactChartLabel}
									tickLine={false}
								/>
								<YAxis
									axisLine={false}
									tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
									tickLine={false}
									width={34}
								/>
								<Tooltip contentStyle={analyticsTooltipStyle} />
								<Area
									dataKey="value"
									fill="var(--primary)"
									fillOpacity={0.16}
									name="Sales"
									stroke="var(--primary)"
									strokeWidth={2}
									type="monotone"
								/>
							</AreaChart>
						</ResponsiveContainer>
					</div>
				</div>
				<div className="rounded-md border border-border bg-background p-4">
					<div className="mb-4 flex items-center justify-between">
						<span className="text-sm font-semibold text-foreground">
							Analytics
						</span>
						<span className="text-muted-foreground">...</span>
					</div>
					<div className="mx-auto grid h-32 w-32 place-items-center rounded-full border-[18px] border-blue-500 border-r-amber-400 border-b-orange-400">
						<div className="text-center">
							<div className="text-2xl font-semibold text-foreground">80%</div>
							<div className="text-[10px] text-muted-foreground">
								Transactions
							</div>
						</div>
					</div>
					<div className="mt-4 flex justify-center gap-3 text-[10px] text-muted-foreground">
						<span>Sale</span>
						<span>Distribute</span>
						<span>Return</span>
					</div>
				</div>
			</div>
		</div>
	);
}
