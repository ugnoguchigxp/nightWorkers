import type { ProjectQualityRun } from "../../../shared/schemas/quality.schema";

const COVERAGE_AXES = ["statements", "branches", "functions", "lines"] as const;

export type OverviewCoverageAxis = {
	key: (typeof COVERAGE_AXES)[number];
	actualPercent: number;
};

export function coverageAxesFromQualityRun(
	run: ProjectQualityRun | null | undefined,
): OverviewCoverageAxis[] {
	const total = coverageSummaryTotal(run?.coverageSummary);
	if (!total) return [];
	return COVERAGE_AXES.flatMap((key) => {
		const actualPercent = coverageMetricPercent(total[key]);
		return actualPercent === null ? [] : [{ key, actualPercent }];
	});
}

function coverageSummaryTotal(
	summary: unknown,
): Record<string, unknown> | null {
	if (!summary || typeof summary !== "object" || Array.isArray(summary)) {
		return null;
	}
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
