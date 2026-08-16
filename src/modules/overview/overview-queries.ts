import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import {
	type OverviewDashboard,
	overviewDashboardSchema,
} from "../../../shared/schemas/overview.schema";
import { readJsonResponse } from "../../lib/api-error";
import type { OverviewRange } from "../nightworkers/routing/workbench-route-state";
import { fetchStartupPreflight } from "../settings";
import { fetchOverview } from "./overviewCommands";

export type StartupPreflightView = {
	checks: Array<{
		id: string;
		label: string;
		status: "pass" | "warn" | "fail";
		detail: string;
	}>;
};

const startupPreflightSchema = z.object({
	checks: z.array(
		z.object({
			id: z.string(),
			label: z.string(),
			status: z.enum(["pass", "warn", "fail"]),
			detail: z.string(),
		}),
	),
});

export const overviewQueryKeys = {
	dashboard: (input: {
		range: OverviewRange;
		projectFilterId: string | null;
	}) =>
		[
			"overview",
			{ range: input.range, repositoryId: input.projectFilterId },
		] as const,
	startupPreflight: ["overview", "startup-preflight"] as const,
};

function overviewQuery(input: {
	range: OverviewRange;
	projectFilterId: string | null;
}) {
	const params = new URLSearchParams({ range: input.range });
	if (input.projectFilterId) params.set("repositoryId", input.projectFilterId);
	return params.toString();
}

export async function fetchOverviewDashboard(
	input: { range: OverviewRange; projectFilterId: string | null },
	signal?: AbortSignal,
): Promise<OverviewDashboard> {
	return readJsonResponse(
		await fetchOverview(overviewQuery(input), { signal }),
		overviewDashboardSchema,
	);
}

export function overviewDashboardQueryOptions(input: {
	range: OverviewRange;
	projectFilterId: string | null;
}) {
	return queryOptions({
		queryKey: overviewQueryKeys.dashboard(input),
		queryFn: ({ signal }) => fetchOverviewDashboard(input, signal),
		refetchInterval: 15_000,
	});
}

export async function fetchOverviewStartupPreflight(
	signal?: AbortSignal,
): Promise<StartupPreflightView> {
	return readJsonResponse(
		await fetchStartupPreflight({ signal }),
		startupPreflightSchema,
	);
}

export function overviewStartupPreflightQueryOptions() {
	return queryOptions({
		queryKey: overviewQueryKeys.startupPreflight,
		queryFn: ({ signal }) => fetchOverviewStartupPreflight(signal),
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
	});
}
