import { Play, TestTube2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import type {
	E2ESummary,
	ProjectQualityOverview,
	ProjectQualityRun,
} from "../../../../shared/schemas/quality.schema";
import type { CoverageFileRow } from "../model/qualityRows";
import type { E2EResultRow } from "../model/qualityTypes";
import { CoverageReportSection } from "./CoverageReportSection";
import { E2EResultsSection } from "./E2EResultsSection";
import { JestStatusLabel, SectionHeading } from "./QualityUi";
import {
	controlStyle,
	mutedTextStyle,
	panelStyle,
	primaryButtonStyle,
	primaryTextStyle,
} from "./qualityStyles";

const coverageAxisMetrics = [
	"statements",
	"branches",
	"functions",
	"lines",
] as const;

export function coverageAxesFromQualityRun(
	run: ProjectQualityRun | null | undefined,
) {
	const gateMetrics = run?.coverageGate?.metrics ?? [];
	if (gateMetrics.length > 0) {
		return gateMetrics.map((metric) => ({
			labelKey: `projectDetail.coverage.${metric.metric}`,
			value: metric.actualPercent,
		}));
	}

	const total = coverageSummaryTotal(run?.coverageSummary);
	if (!total) return [];
	return coverageAxisMetrics.flatMap((metric) => {
		const value = coverageMetricPercent(total[metric]);
		return value === null
			? []
			: [{ labelKey: `projectDetail.coverage.${metric}`, value }];
	});
}

function coverageSummaryTotal(
	summary: unknown,
): Record<string, unknown> | null {
	if (!summary || typeof summary !== "object" || Array.isArray(summary))
		return null;
	const total = (summary as Record<string, unknown>).total;
	return total && typeof total === "object" && !Array.isArray(total)
		? (total as Record<string, unknown>)
		: null;
}

function coverageMetricPercent(metricSummary: unknown) {
	if (
		!metricSummary ||
		typeof metricSummary !== "object" ||
		Array.isArray(metricSummary)
	) {
		return null;
	}
	const pct = (metricSummary as Record<string, unknown>).pct;
	return typeof pct === "number" && Number.isFinite(pct) ? pct : null;
}

export function QualityReportPanel({
	quality,
	coverageRows,
	e2eRows,
	busy,
	creatingTask = false,
	selectedFileKeys = [],
	notice = "",
	onRun,
	onToggleFile,
	onCreateTask,
}: {
	quality: ProjectQualityOverview | null;
	coverageRows: CoverageFileRow[];
	e2eRows: E2EResultRow[];
	busy: boolean;
	creatingTask?: boolean;
	selectedFileKeys?: string[];
	notice?: string;
	onRun: (runType: "unit" | "e2e" | "all") => void;
	onToggleFile?: (fileKey: string) => void;
	onCreateTask?: () => void;
}) {
	const { t } = useTranslation();
	const runButtons = [
		{
			label: t("projectDetail.quality.runUnit"),
			runType: "unit" as const,
			capability: quality?.capabilities.unit,
		},
		{
			label: t("projectDetail.quality.runE2E"),
			runType: "e2e" as const,
			capability: quality?.capabilities.e2e,
		},
		{
			label: t("projectDetail.quality.runAll"),
			runType: "all" as const,
			capability: quality?.capabilities.all,
		},
	];
	const coverageRun = quality?.latestCoverageRun ?? null;
	const e2eRun = quality?.latestE2eResultRun ?? null;

	return (
		<section className="space-y-3">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<SectionHeading
					icon={<TestTube2 className="h-4 w-4" />}
					title={t("projectDetail.quality.title")}
				/>
				<div className="flex flex-wrap gap-2">
					{runButtons.map((button, index) => (
						<Button
							key={button.runType}
							type="button"
							onClick={() => onRun(button.runType)}
							disabled={busy || !button.capability?.runnable}
							title={
								button.capability?.runnable
									? button.capability.command
									: button.capability?.missingCapabilities.join(", ")
							}
							className="h-8 px-3 text-xs font-semibold"
							style={index === 2 ? primaryButtonStyle : controlStyle}
						>
							<Play className="h-3.5 w-3.5" />
							{button.label}
						</Button>
					))}
				</div>
			</div>

			<div className="grid gap-2 md:grid-cols-2">
				<QualityRunStatus
					label={t("projectDetail.quality.coverageReport")}
					run={coverageRun}
					emptyMessage={t("projectDetail.quality.coverageNotRun")}
					capability={quality?.capabilities.coverage}
				/>
				<QualityRunStatus
					label={t("projectDetail.quality.e2eResults")}
					run={e2eRun}
					emptyMessage={t("projectDetail.quality.e2eNotRun")}
					capability={quality?.capabilities.e2e}
				/>
			</div>

			<CoverageReportSection
				coverageRun={coverageRun}
				coverageRows={coverageRows}
				selectedFileKeys={selectedFileKeys}
				busy={busy}
				creatingTask={creatingTask}
				notice={notice}
				onToggleFile={onToggleFile}
				onCreateTask={onCreateTask}
			/>
			<E2EResultsSection rows={e2eRows} />
		</section>
	);
}

function QualityRunStatus({
	label,
	run,
	emptyMessage,
	capability,
}: {
	label: string;
	run: ProjectQualityRun | null;
	emptyMessage: string;
	capability?: {
		runnable: boolean;
		missingCapabilities: string[];
		command?: string;
	};
}) {
	const { t } = useTranslation();
	const missingCapability =
		!capability?.runnable && capability?.missingCapabilities.length
			? t("projectDetail.quality.missingCapability", {
					capability: capability.missingCapabilities.join(", "),
				})
			: null;
	return (
		<div className="border p-3 text-xs" style={panelStyle}>
			<div className="flex flex-wrap items-center justify-between gap-2">
				<span className="font-semibold">{label}</span>
				{run ? <QualityStatusChip status={run.status} /> : null}
			</div>
			<div className="mt-2 space-y-1" style={mutedTextStyle}>
				{run ? (
					<>
						<div>
							{run.runType} / {run.status}
							{run.exitCode === null ? "" : ` / exit ${run.exitCode}`}
						</div>
						<div className="truncate">{run.command}</div>
						{run.coverageGate ? (
							<div>
								{t("projectDetail.quality.coverageGateStatus", {
									status: run.coverageGate.passed ? "PASS" : "FAIL",
									target: run.coverageGate.targetPercent,
								})}
							</div>
						) : null}
						{missingCapability ? (
							<div style={{ color: "var(--nw-warning)" }}>
								{missingCapability}
							</div>
						) : null}
						{run.errorMessage ? (
							<div style={{ color: "var(--nw-warning)" }}>
								{run.errorMessage}
							</div>
						) : null}
						{run.latestOutput ? (
							<details className="mt-2">
								<summary className="cursor-pointer" style={primaryTextStyle}>
									{t("projectDetail.quality.commandOutput")}
								</summary>
								<pre
									className="nightworkers-scrollbar mt-2 max-h-40 overflow-auto whitespace-pre-wrap border p-2 font-mono text-[11px]"
									style={controlStyle}
								>
									{run.latestOutput}
								</pre>
							</details>
						) : null}
					</>
				) : (
					<div>{missingCapability ?? emptyMessage}</div>
				)}
			</div>
		</div>
	);
}

function QualityStatusChip({
	status,
}: {
	status: ProjectQualityRun["status"];
}) {
	if (status === "completed") return <JestStatusLabel status="PASS" />;
	if (status === "failed" || status === "cancelled")
		return <JestStatusLabel status="FAIL" />;
	return (
		<span
			className="inline-flex h-6 items-center border px-2 font-mono text-[11px] font-bold"
			style={{
				background:
					"color-mix(in srgb, var(--nw-primary) 12%, var(--nw-panel))",
				borderColor:
					"color-mix(in srgb, var(--nw-primary) 42%, var(--nw-border))",
				borderRadius: "var(--nw-control-radius)",
				color: "var(--nw-primary)",
			}}
		>
			{status.toUpperCase()}
		</span>
	);
}

export function e2eRowsFromSummary(
	summary: E2ESummary | null | undefined,
): E2EResultRow[] {
	if (!summary) return [];
	if (summary.suites.length === 0) {
		return [
			{
				suite: "E2E",
				status: summary.status === "passed" ? "PASS" : "FAIL",
				tests: summary.total > 0 ? `${summary.passed}/${summary.total}` : "—",
				duration:
					summary.durationMs === null
						? "—"
						: `${Math.round(summary.durationMs / 1000)}s`,
				lastFailure: summary.failed > 0 ? "See command output" : "—",
			},
		];
	}
	return summary.suites.map((suite) => ({
		suite: suite.title,
		status: suite.status === "passed" ? "PASS" : "FAIL",
		tests: String(suite.tests),
		duration:
			suite.durationMs === null
				? "—"
				: `${Math.round(suite.durationMs / 1000)}s`,
		lastFailure: suite.lastFailure ?? "—",
	}));
}
