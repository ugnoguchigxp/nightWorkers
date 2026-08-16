import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { OverviewDashboard } from "../../../shared/schemas/overview.schema";
import type { OverviewRange } from "../nightworkers/routing/workbench-route-state";
import {
	overviewDashboardQueryOptions,
	overviewStartupPreflightQueryOptions,
} from "./overview-queries";

export function isOverviewDashboardForScope(
	dashboard: Pick<OverviewDashboard, "scope"> | null,
	input: { range: OverviewRange; projectFilterId: string | null },
) {
	return Boolean(
		dashboard &&
			dashboard.scope.range === input.range &&
			dashboard.scope.repositoryId === input.projectFilterId,
	);
}

export function useOverviewDashboard(input: {
	range: OverviewRange;
	projectFilterId: string | null;
}) {
	const { t } = useTranslation();
	const dashboardQuery = useQuery(overviewDashboardQueryOptions(input));
	const startupPreflightQuery = useQuery(
		overviewStartupPreflightQueryOptions(),
	);

	const refresh = useCallback(async () => {
		await Promise.allSettled([
			dashboardQuery.refetch(),
			startupPreflightQuery.refetch(),
		]);
	}, [dashboardQuery, startupPreflightQuery]);

	return {
		dashboard: dashboardQuery.data ?? null,
		isLoading: dashboardQuery.isPending,
		error: dashboardQuery.error
			? dashboardQuery.error instanceof Error
				? dashboardQuery.error.message
				: t("overview.error.loadFailed")
			: null,
		refresh,
		startupWarnings:
			startupPreflightQuery.data?.checks.filter(
				(check) => check.status !== "pass",
			) ?? [],
	};
}
