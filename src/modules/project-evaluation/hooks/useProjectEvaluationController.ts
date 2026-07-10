import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CreateMissionFromImprovementResponse } from "../../../../shared/schemas/mission-pilot.schema";
import type { Task } from "../../nightworkers/types";
import {
	createMissionFromProjectEvaluationImprovement,
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

async function parseJsonResponse<T>(response: Response): Promise<T> {
	if (!response.ok) {
		let message = response.statusText;
		try {
			const body = (await response.json()) as {
				error?: string;
				message?: string;
			};
			message = body.error || body.message || message;
		} catch {
			message = await response.text();
		}
		throw new Error(message);
	}
	return (await response.json()) as T;
}

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
	options: {
		onTasksCreated?: (tasks: Task[]) => Promise<void> | void;
		onMissionCreated?: (
			result: CreateMissionFromImprovementResponse,
		) => Promise<void> | void;
	} = {},
) {
	const { onMissionCreated, onTasksCreated } = options;
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
	const [creatingMissionIdeaId, setCreatingMissionIdeaId] = useState<
		string | null
	>(null);
	const missionCreationInFlightRef = useRef<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	const loadDetail = useCallback(async (evaluationId: string) => {
		const nextDetail = await parseJsonResponse<ProjectEvaluationDetail>(
			await fetchProjectEvaluationDetail(evaluationId),
		);
		setDetail(nextDetail);
		setSelectedKeys(new Set());
		setSelectedIdeaIds(new Set());
	}, []);

	const refresh = useCallback(async () => {
		setIsLoading(true);
		setError(null);
		try {
			const evaluations = await parseJsonResponse<ProjectEvaluationRun[]>(
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
			const started = await parseJsonResponse<StartProjectEvaluationResponse>(
				await startProjectEvaluation(repositoryId),
			);
			setDetail(started.detail);
			setRunningEvaluationId(started.evaluationId);
			const evaluations = await parseJsonResponse<ProjectEvaluationRun[]>(
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
	}, [repositoryId]);

	useEffect(() => {
		if (!runningEvaluationId) return;
		let cancelled = false;
		let afterSeq = maxActivitySeq(detail?.activityEvents ?? []);

		const poll = async () => {
			try {
				const replay = await parseJsonResponse<ProjectEvaluationActivityReplay>(
					await fetchProjectEvaluationActivityEvents(
						runningEvaluationId,
						afterSeq >= 0 ? afterSeq : undefined,
					),
				);
				if (cancelled) return;
				if (replay.events.length > 0) {
					afterSeq = Math.max(afterSeq, maxActivitySeq(replay.events));
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
						parseJsonResponse<ProjectEvaluationDetail>(
							await fetchProjectEvaluationDetail(runningEvaluationId),
						),
						parseJsonResponse<ProjectEvaluationRun[]>(
							await fetchProjectEvaluationHistory(repositoryId),
						),
					]);
					if (cancelled) return;
					setDetail(nextDetail);
					setHistory(evaluations);
					setIsRunning(false);
					setRunningEvaluationId(null);
				}
			} catch (err) {
				if (cancelled) return;
				setError(err instanceof Error ? err.message : String(err));
				setIsRunning(false);
				setRunningEvaluationId(null);
			}
		};

		void poll();
		const timer = window.setInterval(() => void poll(), 1000);
		return () => {
			cancelled = true;
			window.clearInterval(timer);
		};
	}, [detail?.activityEvents, repositoryId, runningEvaluationId]);

	const selectEvaluation = useCallback(async (evaluationId: string) => {
		setError(null);
		try {
			const nextDetail = await parseJsonResponse<ProjectEvaluationDetail>(
				await fetchProjectEvaluationDetail(evaluationId),
			);
			setDetail(nextDetail);
			setSelectedKeys(new Set());
			setSelectedIdeaIds(new Set());
			if (nextDetail.evaluation.status === "running") {
				setIsRunning(true);
				setRunningEvaluationId(nextDetail.evaluation.id);
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	}, []);

	const generateIdeas = useCallback(async () => {
		if (!detail || selectedKeys.size === 0) return;
		setIsGenerating(true);
		setError(null);
		try {
			const result = await parseJsonResponse<{
				ideas: ProjectEvaluationDetail["improvements"];
			}>(
				await generateProjectImprovements(detail.evaluation.id, {
					dimensionKeys: [...selectedKeys],
				}),
			);
			const nextDetail = await parseJsonResponse<ProjectEvaluationDetail>(
				await fetchProjectEvaluationDetail(detail.evaluation.id),
			);
			setDetail({ ...nextDetail, improvements: result.ideas });
			setSelectedIdeaIds(new Set());
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setIsGenerating(false);
		}
	}, [detail, selectedKeys]);

	const createTasks = useCallback(async () => {
		if (!detail || selectedIdeaIds.size === 0) return;
		setIsCreatingTasks(true);
		setError(null);
		try {
			const result = await parseJsonResponse<{
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

	const createMission = useCallback(
		async (ideaId: string) => {
			if (!detail || missionCreationInFlightRef.current) return;
			missionCreationInFlightRef.current = ideaId;
			setCreatingMissionIdeaId(ideaId);
			setError(null);
			try {
				const result =
					await parseJsonResponse<CreateMissionFromImprovementResponse>(
						await createMissionFromProjectEvaluationImprovement(repositoryId, {
							evaluationId: detail.evaluation.id,
							improvementIdeaId: ideaId,
							idempotencyKey: crypto.randomUUID(),
						}),
					);
				await onMissionCreated?.(result);
			} catch (err) {
				setError(err instanceof Error ? err.message : String(err));
			} finally {
				missionCreationInFlightRef.current = null;
				setCreatingMissionIdeaId(null);
			}
		},
		[detail, onMissionCreated, repositoryId],
	);

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
		creatingMissionIdeaId,
		activityEvents: detail?.activityEvents ?? [],
		error,
		setSelectedKeys,
		runEvaluation,
		selectEvaluation,
		generateIdeas,
		createTasks,
		createMission,
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
