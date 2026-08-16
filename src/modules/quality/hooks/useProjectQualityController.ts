import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ProjectQualityOverview } from "../../../../shared/schemas/quality.schema";
import { i18next } from "../../../i18n/setup";
import { ApiResponseError, readJsonResponse } from "../../../lib/api-error";
import type { Task } from "../../nightworkers/types";
import {
	createCoverageImprovementTask,
	createProjectQualityRun,
	fetchProjectQuality,
} from "../api/qualityCommands";
import {
	coverageAxesFromQualityRun,
	e2eRowsFromSummary,
} from "../components/QualityReportPanel";
import { coverageRowsFromSummary } from "../model/qualityRows";

export function useProjectQualityController(input: {
	repositoryId: string;
	projectRoot: string;
	onTasksCreated?: (tasks: Task[]) => Promise<void> | void;
}) {
	const [quality, setQuality] = useState<ProjectQualityOverview | null>(null);
	const [selectedFileKeys, setSelectedFileKeys] = useState<string[]>([]);
	const [busyAction, setBusyAction] = useState<string | null>(null);
	const [error, setError] = useState("");
	const [notice, setNotice] = useState("");
	const previousRunIdRef = useRef<string | null>(null);
	const actionInFlightRef = useRef(false);
	const actionGenerationRef = useRef(0);
	const repositoryIdRef = useRef(input.repositoryId);
	repositoryIdRef.current = input.repositoryId;

	const coverageRows = useMemo(
		() =>
			coverageRowsFromSummary(
				quality?.latestCoverageRun?.coverageSummary,
				input.projectRoot,
			),
		[input.projectRoot, quality?.latestCoverageRun?.coverageSummary],
	);
	const e2eRows = useMemo(
		() => e2eRowsFromSummary(quality?.latestE2eResultRun?.e2eSummary),
		[quality?.latestE2eResultRun?.e2eSummary],
	);
	const coverageAxes = useMemo(
		() => coverageAxesFromQualityRun(quality?.latestCoverageRun),
		[quality?.latestCoverageRun],
	);

	const load = useCallback(async () => {
		const repositoryId = input.repositoryId;
		const response = await fetchProjectQuality(repositoryId);
		const payload = await readJsonResponse<ProjectQualityOverview>(response);
		if (repositoryIdRef.current === repositoryId) setQuality(payload);
	}, [input.repositoryId]);

	useEffect(() => {
		let cancelled = false;
		actionGenerationRef.current += 1;
		actionInFlightRef.current = false;
		previousRunIdRef.current = null;
		setQuality(null);
		setBusyAction(null);
		setError("");
		setNotice("");
		setSelectedFileKeys([]);
		fetchProjectQuality(input.repositoryId)
			.then((response) => readJsonResponse<ProjectQualityOverview>(response))
			.then((payload) => {
				if (!cancelled) setQuality(payload);
			})
			.catch((loadError) => {
				if (!cancelled)
					setError(
						loadError instanceof Error ? loadError.message : String(loadError),
					);
			});
		return () => {
			cancelled = true;
		};
	}, [input.repositoryId]);

	useEffect(() => {
		const runId = quality?.latestCoverageRun?.id ?? null;
		if (previousRunIdRef.current !== runId) {
			previousRunIdRef.current = runId;
			setSelectedFileKeys([]);
			return;
		}
		const available = new Set(
			coverageRows.filter((row) => !row.summary).map((row) => row.key),
		);
		setSelectedFileKeys((current) =>
			current.filter((key) => available.has(key)),
		);
	}, [coverageRows, quality?.latestCoverageRun?.id]);

	const run = useCallback(
		async (runType: "unit" | "e2e" | "all") => {
			if (actionInFlightRef.current) return;
			const repositoryId = input.repositoryId;
			const actionGeneration = actionGenerationRef.current;
			actionInFlightRef.current = true;
			setBusyAction(`run:${runType}`);
			setError("");
			setNotice("");
			try {
				await readJsonResponse(
					await createProjectQualityRun(repositoryId, { runType }),
				);
				if (
					repositoryIdRef.current === repositoryId &&
					actionGenerationRef.current === actionGeneration
				)
					await load();
			} catch (runError) {
				if (
					repositoryIdRef.current === repositoryId &&
					actionGenerationRef.current === actionGeneration
				) {
					setError(
						runError instanceof Error ? runError.message : String(runError),
					);
				}
			} finally {
				if (actionGenerationRef.current === actionGeneration) {
					actionInFlightRef.current = false;
					setBusyAction(null);
				}
			}
		},
		[input.repositoryId, load],
	);

	const toggleFile = useCallback((fileKey: string) => {
		setSelectedFileKeys((current) => {
			if (current.includes(fileKey))
				return current.filter((key) => key !== fileKey);
			if (current.length >= 20) return current;
			return [...current, fileKey];
		});
		setNotice("");
	}, []);

	const createTask = useCallback(async () => {
		const runId = quality?.latestCoverageRun?.id;
		if (!runId || selectedFileKeys.length === 0 || actionInFlightRef.current)
			return;
		const repositoryId = input.repositoryId;
		const actionGeneration = actionGenerationRef.current;
		actionInFlightRef.current = true;
		setBusyAction("coverage-task");
		setError("");
		setNotice("");
		try {
			const response = await createCoverageImprovementTask(
				repositoryId,
				runId,
				{ fileKeys: selectedFileKeys },
			);
			const result = await readJsonResponse<{ task: Task }>(response);
			if (
				repositoryIdRef.current !== repositoryId ||
				actionGenerationRef.current !== actionGeneration
			)
				return;
			setSelectedFileKeys([]);
			setNotice(i18next.t("projectDetail.quality.coverageTaskCreated"));
			const refreshResults = await Promise.allSettled([
				Promise.resolve().then(() => input.onTasksCreated?.([result.task])),
				load(),
			]);
			if (
				repositoryIdRef.current === repositoryId &&
				actionGenerationRef.current === actionGeneration &&
				refreshResults.some(
					(refreshResult) => refreshResult.status === "rejected",
				)
			) {
				setError(i18next.t("projectDetail.quality.coverageTaskRefreshFailed"));
			}
		} catch (taskError) {
			if (
				repositoryIdRef.current !== repositoryId ||
				actionGenerationRef.current !== actionGeneration
			)
				return;
			if (taskError instanceof ApiResponseError && taskError.status === 409) {
				setSelectedFileKeys([]);
				setNotice(i18next.t("projectDetail.quality.coverageTaskStale"));
				await load().catch(() => undefined);
			} else {
				setError(
					taskError instanceof Error ? taskError.message : String(taskError),
				);
			}
		} finally {
			if (actionGenerationRef.current === actionGeneration) {
				actionInFlightRef.current = false;
				setBusyAction(null);
			}
		}
	}, [
		input.onTasksCreated,
		input.repositoryId,
		load,
		quality?.latestCoverageRun?.id,
		selectedFileKeys,
	]);

	return {
		repositoryId: input.repositoryId,
		quality,
		coverageRows,
		e2eRows,
		coverageAxes,
		selectedFileKeys,
		busyAction,
		busy: busyAction !== null,
		error,
		notice,
		load,
		run,
		toggleFile,
		createTask,
	};
}

export type ProjectQualityController = ReturnType<
	typeof useProjectQualityController
>;
