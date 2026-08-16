import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { readJsonResponse } from "../../../lib/api-error";
import type { Task } from "../../nightworkers/types";
import {
	createProjectEvaluationTasks,
	fetchProjectEvaluationActivityEvents,
	fetchProjectEvaluationDetail,
	fetchProjectEvaluationHistory,
	generateProjectImprovements,
	startProjectEvaluation,
} from "../api/projectEvaluationCommands";
import type {
	ProjectEvaluationActivityEvent,
	ProjectEvaluationActivityReplay,
	ProjectEvaluationDetail,
	ProjectEvaluationDimensionKey,
	ProjectEvaluationRun,
	ProjectEvaluationTaskLink,
	StartProjectEvaluationResponse,
} from "../model/projectEvaluationTypes";

function mergeActivityEvents(
	current: ProjectEvaluationActivityEvent[],
	incoming: ProjectEvaluationActivityEvent[],
) {
	const byId = new Map(current.map((event) => [event.id, event]));
	for (const event of incoming) byId.set(event.id, event);
	return [...byId.values()].sort((a, b) => {
		if (a.seq !== b.seq) return a.seq - b.seq;
		return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
	});
}

function maxActivitySeq(events: ProjectEvaluationActivityEvent[]) {
	return events.reduce((max, event) => Math.max(max, event.seq), -1);
}

export function mergeCreatedProjectEvaluationTasks(
	current: Task[],
	createdTasks: Task[],
) {
	if (createdTasks.length === 0) return current;
	const createdIds = new Set(createdTasks.map((task) => task.id));
	return [
		...createdTasks,
		...current.filter((task) => !createdIds.has(task.id)),
	];
}

export function useProjectEvaluationController(
	repositoryId: string,
	options: { onTasksCreated?: (tasks: Task[]) => Promise<void> | void } = {},
) {
	const { onTasksCreated } = options;
	const queryClient = useQueryClient();
	const [history, setHistory] = useState<ProjectEvaluationRun[]>([]);
	const [detail, setDetail] = useState<ProjectEvaluationDetail | null>(null);
	const [runningEvaluationId, setRunningEvaluationId] = useState<string | null>(
		null,
	);
	const [selectedKeys, setSelectedKeys] = useState<
		Set<ProjectEvaluationDimensionKey>
	>(() => new Set());
	const [selectedIdeaIds, setSelectedIdeaIds] = useState<Set<string>>(
		() => new Set(),
	);
	const [isLoading, setIsLoading] = useState(true);
	const [isRunning, setIsRunning] = useState(false);
	const [isGenerating, setIsGenerating] = useState(false);
	const [isCreatingTasks, setIsCreatingTasks] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const activityCursorRef = useRef<{
		evaluationId: string | null;
		afterSeq: number;
	}>({ evaluationId: null, afterSeq: -1 });
	const pollGenerationRef = useRef(0);

	const resetActivityCursor = useCallback(
		(nextDetail: ProjectEvaluationDetail) => {
			activityCursorRef.current = {
				evaluationId: nextDetail.evaluation.id,
				afterSeq: maxActivitySeq(nextDetail.activityEvents),
			};
		},
		[],
	);

	const loadDetail = useCallback(
		async (evaluationId: string) => {
			const nextDetail = await readJsonResponse<ProjectEvaluationDetail>(
				await fetchProjectEvaluationDetail(evaluationId),
			);
			setDetail(nextDetail);
			resetActivityCursor(nextDetail);
			setSelectedKeys(new Set());
			setSelectedIdeaIds(new Set());
		},
		[resetActivityCursor],
	);

	const refresh = useCallback(async () => {
		setIsLoading(true);
		setError(null);
		try {
			const evaluations = await readJsonResponse<ProjectEvaluationRun[]>(
				await fetchProjectEvaluationHistory(repositoryId),
			);
			setHistory(evaluations);
			if (evaluations[0]) {
				await loadDetail(evaluations[0].id);
				if (evaluations[0].status === "running") {
					setIsRunning(true);
					setRunningEvaluationId(evaluations[0].id);
				}
			} else {
				setDetail(null);
				setIsRunning(false);
				setRunningEvaluationId(null);
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setIsLoading(false);
		}
	}, [loadDetail, repositoryId]);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	const runEvaluation = useCallback(async () => {
		setIsRunning(true);
		setError(null);
		try {
			const started = await readJsonResponse<StartProjectEvaluationResponse>(
				await startProjectEvaluation(repositoryId),
			);
			setDetail(started.detail);
			resetActivityCursor(started.detail);
			setRunningEvaluationId(started.evaluationId);
			const evaluations = await readJsonResponse<ProjectEvaluationRun[]>(
				await fetchProjectEvaluationHistory(repositoryId),
			);
			setHistory(evaluations);
			setSelectedKeys(new Set());
			setSelectedIdeaIds(new Set());
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			setError(message);
			setIsRunning(false);
			setRunningEvaluationId(null);
		}
	}, [repositoryId, resetActivityCursor]);

	useEffect(() => {
		if (!runningEvaluationId) return;
		const generation = pollGenerationRef.current + 1;
		pollGenerationRef.current = generation;
		const isCurrent = () =>
			pollGenerationRef.current === generation &&
			activityCursorRef.current.evaluationId === runningEvaluationId;
		if (activityCursorRef.current.evaluationId !== runningEvaluationId) {
			activityCursorRef.current = {
				evaluationId: runningEvaluationId,
				afterSeq: -1,
			};
		}

		const poll = async () => {
			try {
				const afterSeq = activityCursorRef.current.afterSeq;
				const replay = await readJsonResponse<ProjectEvaluationActivityReplay>(
					await fetchProjectEvaluationActivityEvents(
						runningEvaluationId,
						afterSeq >= 0 ? afterSeq : undefined,
					),
				);
				if (!isCurrent()) return;
				if (replay.events.length > 0) {
					activityCursorRef.current = {
						evaluationId: runningEvaluationId,
						afterSeq: Math.max(afterSeq, maxActivitySeq(replay.events)),
					};
					setDetail((current) =>
						current?.evaluation.id === runningEvaluationId
							? {
									...current,
									activityEvents: mergeActivityEvents(
										current.activityEvents,
										replay.events,
									),
									evaluation: { ...current.evaluation, status: replay.status },
								}
							: current,
					);
				} else {
					setDetail((current) =>
						current?.evaluation.id === runningEvaluationId
							? {
									...current,
									evaluation: { ...current.evaluation, status: replay.status },
								}
							: current,
					);
				}
				if (replay.status === "completed" || replay.status === "failed") {
					const [nextDetail, evaluations] = await Promise.all([
						readJsonResponse<ProjectEvaluationDetail>(
							await fetchProjectEvaluationDetail(runningEvaluationId),
						),
						readJsonResponse<ProjectEvaluationRun[]>(
							await fetchProjectEvaluationHistory(repositoryId),
						),
					]);
					if (!isCurrent()) return;
					setDetail(nextDetail);
					resetActivityCursor(nextDetail);
					setHistory(evaluations);
					setIsRunning(false);
					setRunningEvaluationId(null);
				}
			} catch (err) {
				if (!isCurrent()) return;
				setError(err instanceof Error ? err.message : String(err));
				setIsRunning(false);
				setRunningEvaluationId(null);
			}
		};

		void poll();
		const timer = window.setInterval(() => void poll(), 1000);
		return () => {
			if (pollGenerationRef.current === generation)
				pollGenerationRef.current += 1;
			window.clearInterval(timer);
		};
	}, [repositoryId, resetActivityCursor, runningEvaluationId]);

	const selectEvaluation = useCallback(
		async (evaluationId: string) => {
			setError(null);
			try {
				const nextDetail = await readJsonResponse<ProjectEvaluationDetail>(
					await fetchProjectEvaluationDetail(evaluationId),
				);
				setDetail(nextDetail);
				resetActivityCursor(nextDetail);
				setSelectedKeys(new Set());
				setSelectedIdeaIds(new Set());
				if (nextDetail.evaluation.status === "running") {
					setIsRunning(true);
					setRunningEvaluationId(nextDetail.evaluation.id);
				} else {
					setIsRunning(false);
					setRunningEvaluationId(null);
				}
			} catch (err) {
				setError(err instanceof Error ? err.message : String(err));
			}
		},
		[resetActivityCursor],
	);

	const generateIdeas = useCallback(async () => {
		if (!detail || selectedKeys.size === 0) return;
		setIsGenerating(true);
		setError(null);
		try {
			const result = await readJsonResponse<{
				ideas: ProjectEvaluationDetail["improvements"];
			}>(
				await generateProjectImprovements(detail.evaluation.id, {
					dimensionKeys: [...selectedKeys],
				}),
			);
			const nextDetail = await readJsonResponse<ProjectEvaluationDetail>(
				await fetchProjectEvaluationDetail(detail.evaluation.id),
			);
			setDetail({ ...nextDetail, improvements: result.ideas });
			resetActivityCursor(nextDetail);
			setSelectedIdeaIds(new Set());
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setIsGenerating(false);
		}
	}, [detail, resetActivityCursor, selectedKeys]);

	const createTasks = useCallback(async () => {
		if (!detail || selectedIdeaIds.size === 0) return;
		setIsCreatingTasks(true);
		setError(null);
		try {
			const result = await readJsonResponse<{
				tasks: Task[];
				taskLinks: ProjectEvaluationTaskLink[];
			}>(
				await createProjectEvaluationTasks(detail.evaluation.id, {
					ideaIds: [...selectedIdeaIds],
					mode: "draft",
				}),
			);
			queryClient.setQueryData<Task[]>(["sessions"], (current = []) =>
				mergeCreatedProjectEvaluationTasks(current, result.tasks),
			);
			void queryClient.invalidateQueries({ queryKey: ["sessions"] });
			void queryClient.invalidateQueries({ queryKey: ["implementationQueue"] });
			setDetail({ ...detail, taskLinks: result.taskLinks });
			setSelectedIdeaIds(new Set());
			await onTasksCreated?.(result.tasks);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setIsCreatingTasks(false);
		}
	}, [detail, onTasksCreated, queryClient, selectedIdeaIds]);

	const previousEvaluation = useMemo(() => {
		if (!detail) return null;
		const index = history.findIndex((item) => item.id === detail.evaluation.id);
		return index >= 0 ? (history[index + 1] ?? null) : null;
	}, [detail, history]);

	return {
		history,
		detail,
		previousEvaluation,
		selectedKeys,
		selectedIdeaIds,
		isLoading,
		isRunning,
		isViewingRunningEvaluation: Boolean(
			detail && detail.evaluation.id === runningEvaluationId,
		),
		isGenerating,
		isCreatingTasks,
		activityEvents: detail?.activityEvents ?? [],
		error,
		setSelectedKeys,
		runEvaluation,
		selectEvaluation,
		generateIdeas,
		createTasks,
		toggleIdea(id: string) {
			setSelectedIdeaIds((current) => {
				const next = new Set(current);
				if (next.has(id)) next.delete(id);
				else next.add(id);
				return next;
			});
		},
	};
}
