import {
	Activity,
	CircleDollarSign,
	ClipboardCheck,
	Files,
	GitCommitHorizontal,
	TestTube2,
	Zap,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type {
	ProjectDetailMetrics,
	ProjectMeta,
} from "../../../../../shared/schemas/project-detail.schema";
import {
	CompactHealthTile,
	CoverageBreakdown,
	EmptyBlock,
	EmptyTableRow,
	formatCompactTokens,
	KpiTile,
	SectionHeading,
	SectionLabel,
	TokenBreakdownBand,
} from "./ProjectDetailCommon";
import { StackSummaryBadge } from "./ProjectDetailStack";
import {
	mutedTextStyle,
	panelStyle,
	subtleTextStyle,
	tableBorderStyle,
} from "./styles";
import type { CoverageAxis, ModelUsageRow, TopTokenTaskRow } from "./types";

type ProjectDetailOverviewProps = {
	metrics: ProjectDetailMetrics;
	totalRuns: number;
	completedCount: number;
	modelUsageRows: ModelUsageRow[];
	topTokenTasks: TopTokenTaskRow[];
	coverageAxes: CoverageAxis[];
	onOpenSession: (sessionId: string) => void;
};

export function ProjectDetailOverview({
	metrics,
	totalRuns,
	completedCount,
	modelUsageRows,
	topTokenTasks,
	coverageAxes,
	onOpenSession,
}: ProjectDetailOverviewProps) {
	const { t } = useTranslation();
	return (
		<section className="space-y-3">
			<SectionHeading
				icon={<Activity className="h-4 w-4" />}
				title={t("projectDetail.metrics.title")}
				aside={
					<div className="flex max-w-full flex-wrap items-center justify-end gap-2">
						<ProjectMetaBadges projectMeta={metrics.projectMeta} />
						<StackSummaryBadge stackProfile={metrics.stackProfile} />
					</div>
				}
			/>
			<TokenBreakdownBand metrics={metrics} />
			<div className="grid gap-4 xl:grid-cols-[1.45fr_0.75fr]">
				<div className="space-y-4">
					<div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
						<KpiTile
							label={t("projectDetail.metrics.runs")}
							value={totalRuns.toLocaleString()}
							sub={t("projectDetail.metrics.completed", {
								count: completedCount,
							})}
						/>
						<KpiTile
							label={t("projectDetail.metrics.cost")}
							value={
								metrics.llmUsage.totalCost === null
									? "—"
									: `$${metrics.llmUsage.totalCost.toFixed(2)}`
							}
							sub={t("projectDetail.metrics.notConnected")}
						/>
						<KpiTile
							label={t("projectDetail.metrics.avgTokensPerRun")}
							value={
								metrics.llmUsage.averageTokensPerRun?.toLocaleString() ?? "—"
							}
							sub="tokens / run"
						/>
						<KpiTile
							label={t("projectDetail.metrics.outputSpeed")}
							value={formatTokensPerSecond(
								metrics.llmUsage.outputTokensPerSecond,
							)}
							sub="output tok/s"
						/>
						<KpiTile
							label={t("projectDetail.metrics.avgCostPerRun")}
							value={
								metrics.llmUsage.averageCostPerRun === null
									? "—"
									: `$${metrics.llmUsage.averageCostPerRun.toFixed(2)}`
							}
							sub="cost / run"
						/>
					</div>

					<div className="border p-4" style={panelStyle}>
						<SectionLabel
							icon={<CircleDollarSign className="h-4 w-4" />}
							title={t("projectDetail.metrics.modelMix")}
						/>
						<div className="mt-3 overflow-hidden">
							<table className="w-full text-xs">
								<thead style={subtleTextStyle}>
									<tr>
										<th className="py-2 text-left">
											{t("projectDetail.field.model")}
										</th>
										<th className="py-2 text-right">
											{t("projectDetail.field.calls")}
										</th>
										<th className="py-2 text-right">
											{t("projectDetail.field.tokens")}
										</th>
										<th className="py-2 text-right">
											{t("projectDetail.field.outputSpeed")}
										</th>
										<th className="py-2 text-right">
											{t("projectDetail.field.cost")}
										</th>
									</tr>
								</thead>
								<tbody>
									{modelUsageRows.length > 0 ? (
										modelUsageRows.map((row) => (
											<tr
												key={`${row.role}:${row.model}`}
												className="border-t"
												style={tableBorderStyle}
											>
												<td className="max-w-[160px] py-2">
													<div className="truncate font-semibold">
														{row.model}
													</div>
													<div
														className="truncate text-[10px]"
														style={subtleTextStyle}
													>
														{row.role} · I/O{" "}
														{formatCompactTokens(row.inputTokens)} /{" "}
														{formatCompactTokens(row.outputTokens)}
													</div>
												</td>
												<td className="py-2 text-right">{row.calls}</td>
												<td className="py-2 text-right">
													{formatCompactTokens(row.tokens)}
												</td>
												<td className="py-2 text-right">
													{formatTokensPerSecond(row.outputTokensPerSecond)}
												</td>
												<td className="py-2 text-right">{row.cost}</td>
											</tr>
										))
									) : (
										<EmptyTableRow
											colSpan={5}
											message={t("projectDetail.empty.modelUsage")}
										/>
									)}
								</tbody>
							</table>
						</div>
					</div>
				</div>

				<aside className="space-y-3">
					<div className="grid grid-cols-[82px_minmax(0,1fr)] gap-3">
						<CompactHealthTile
							icon={<ClipboardCheck className="h-4 w-4" />}
							label={t("projectDetail.health.evaluation")}
							value={
								metrics.health.latestEvaluationScore === null
									? "—"
									: String(metrics.health.latestEvaluationScore)
							}
							tone="primary"
							compact
						/>
						<CompactHealthTile
							icon={<TestTube2 className="h-4 w-4" />}
							label={t("projectDetail.health.coverageGate")}
							value={<CoverageBreakdown axes={coverageAxes} />}
							tone="warning"
						/>
					</div>
					<div className="border p-4" style={panelStyle}>
						<SectionLabel
							icon={<Zap className="h-4 w-4" />}
							title={t("projectDetail.metrics.topTokenTasks")}
						/>
						{topTokenTasks.length > 0 ? (
							<div className="mt-3 space-y-2">
								{topTokenTasks.map((task) => {
									const sessionId = task.sessionId;
									const taskKey = `${sessionId ?? task.phase}:${task.title}`;
									const content = (
										<>
											<span className="min-w-0">
												<span className="block truncate text-xs font-semibold">
													{task.title}
												</span>
												<span
													className="block truncate text-[10px]"
													style={subtleTextStyle}
												>
													{task.phase} / {task.cost}
												</span>
												<span
													className="block truncate text-[10px]"
													style={subtleTextStyle}
												>
													I/O {formatCompactTokens(task.inputTokens)} /{" "}
													{formatCompactTokens(task.outputTokens)}
												</span>
												<span
													className="block truncate text-[10px]"
													style={subtleTextStyle}
												>
													{formatTokensPerSecond(task.outputTokensPerSecond)}{" "}
													output tok/s
												</span>
											</span>
											<span className="shrink-0 text-right">
												<span className="block text-xs font-semibold">
													{formatCompactTokens(task.tokens)}
												</span>
												<span
													className="block text-[10px]"
													style={mutedTextStyle}
												>
													tokens
												</span>
											</span>
										</>
									);
									return sessionId ? (
										<button
											key={taskKey}
											type="button"
											onClick={() => onOpenSession(sessionId)}
											className="flex w-full min-w-0 items-center justify-between gap-3 border-b py-2 text-left last:border-b-0"
											style={tableBorderStyle}
										>
											{content}
										</button>
									) : (
										<div
											key={taskKey}
											className="flex min-w-0 items-center justify-between gap-3 border-b py-2 last:border-b-0"
											style={tableBorderStyle}
										>
											{content}
										</div>
									);
								})}
							</div>
						) : (
							<EmptyBlock message={t("projectDetail.empty.topTokenTasks")} />
						)}
					</div>
				</aside>
			</div>
		</section>
	);
}

function ProjectMetaBadges({
	projectMeta,
}: {
	projectMeta: ProjectMeta | null;
}) {
	const { t, i18n } = useTranslation();
	if (!projectMeta) return null;
	const gitText =
		projectMeta.git.displayHead ?? t("projectDetail.meta.gitUnavailable");
	const dateText = formatCommitDate(projectMeta.git.committedAt, i18n.language);
	const scaleText = t(
		`projectDetail.meta.fileScale.${projectMeta.fileScale.value}`,
	);
	return (
		<div className="flex max-w-full flex-wrap items-center justify-end gap-2 text-xs">
			<div
				className="flex min-h-8 max-w-full items-center gap-2 border px-3 font-mono font-semibold"
				style={{
					background:
						"color-mix(in srgb, var(--nw-primary) 8%, var(--nw-panel))",
					borderColor:
						"color-mix(in srgb, var(--nw-primary) 32%, var(--nw-border))",
					borderRadius: "var(--nw-control-radius)",
					color: "var(--nw-text)",
				}}
				title={[
					projectMeta.git.head,
					projectMeta.git.committedAt,
					`scanned ${projectMeta.scannedAt}`,
				]
					.filter(Boolean)
					.join(" / ")}
			>
				<GitCommitHorizontal className="h-3.5 w-3.5 shrink-0" />
				<span className="truncate">{gitText}</span>
				{dateText ? (
					<span className="font-sans font-medium" style={subtleTextStyle}>
						{dateText}
					</span>
				) : null}
			</div>
			<div
				className="flex min-h-8 items-center gap-2 border px-3 font-semibold"
				style={{
					background:
						"color-mix(in srgb, var(--nw-warning) 10%, var(--nw-panel))",
					borderColor:
						"color-mix(in srgb, var(--nw-warning) 30%, var(--nw-border))",
					borderRadius: "var(--nw-control-radius)",
					color: "var(--nw-text)",
				}}
				title={t("projectDetail.meta.fileScaleTitle", {
					total: projectMeta.files.total,
					source: projectMeta.files.source,
					loc: projectMeta.files.sourceLoc,
					tests: projectMeta.files.tests,
					score: projectMeta.fileScale.score,
				})}
			>
				<Files className="h-3.5 w-3.5 shrink-0" />
				<span>{scaleText}</span>
			</div>
		</div>
	);
}

function formatCommitDate(value: string | null, locale: string) {
	if (!value) return null;
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return null;
	return new Intl.DateTimeFormat(locale, {
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).format(date);
}

function formatTokensPerSecond(value: number | null) {
	if (value === null) return "—";
	if (value >= 100) return value.toFixed(0);
	if (value >= 10) return value.toFixed(1);
	return value.toFixed(2);
}
