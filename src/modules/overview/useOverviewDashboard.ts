import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
	type OverviewDashboard,
	overviewDashboardSchema,
} from "../../../shared/schemas/overview.schema";
import type { OverviewRange } from "../nightworkers/routing/workbench-route-state";
import { fetchStartupPreflight } from "../settings";
import { fetchOverview } from "./overviewCommands";

type StartupPreflightView = {
	checks: Array<{
		id: string;
		label: string;
		status: "pass" | "warn" | "fail";
		detail: string;
	}>;
};

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
	const [dashboard, setDashboard] = useState<OverviewDashboard | null>(null);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [startupPreflight, setStartupPreflight] =
		useState<StartupPreflightView | null>(null);
	const requestSequenceRef = useRef(0);
	const mountedRef = useRef(true);
	const { t } = useTranslation();

	const query = useMemo(() => {
		const params = new URLSearchParams({ range: input.range });
		if (input.projectFilterId) {
			params.set("repositoryId", input.projectFilterId);
		}
		return params.toString();
	}, [input.projectFilterId, input.range]);

	const loadDashboard = useCallback(async () => {
		const requestSequence = requestSequenceRef.current + 1;
		requestSequenceRef.current = requestSequence;
		setIsLoading(true);
		setError(null);
		try {
			const response = await fetchOverview(query);
			if (!response.ok) {
				throw new Error(
					t("overview.error.loadFailed", { status: response.status }),
				);
			}
			const nextDashboard = overviewDashboardSchema.parse(
				await response.json(),
			);
			if (
				mountedRef.current &&
				requestSequenceRef.current === requestSequence
			) {
				setDashboard(nextDashboard);
			}
		} catch (cause) {
			if (
				mountedRef.current &&
				requestSequenceRef.current === requestSequence
			) {
				setError(cause instanceof Error ? cause.message : String(cause));
			}
		} finally {
			if (
				mountedRef.current &&
				requestSequenceRef.current === requestSequence
			) {
				setIsLoading(false);
			}
		}
	}, [query, t]);

	const loadPreflight = useCallback(async () => {
		try {
			const response = await fetchStartupPreflight();
			if (!response.ok) return;
			const nextPreflight = (await response.json()) as StartupPreflightView;
			if (mountedRef.current) setStartupPreflight(nextPreflight);
		} catch {
			// Preflight warnings are supplementary and must not hide Overview metrics.
		}
	}, []);

	const refresh = useCallback(async () => {
		await Promise.allSettled([loadDashboard(), loadPreflight()]);
	}, [loadDashboard, loadPreflight]);

	useEffect(() => {
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
			requestSequenceRef.current += 1;
		};
	}, []);

	useEffect(() => {
		void loadDashboard();
		const timer = window.setInterval(() => void loadDashboard(), 15_000);
		return () => window.clearInterval(timer);
	}, [loadDashboard]);

	useEffect(() => {
		void loadPreflight();
	}, [loadPreflight]);

	return {
		dashboard,
		isLoading,
		error,
		refresh,
		startupWarnings:
			startupPreflight?.checks.filter((check) => check.status !== "pass") ?? [],
	};
}
