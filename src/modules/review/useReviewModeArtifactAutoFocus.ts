import { useEffect, useRef } from "react";
import type { WorkbenchRouteState } from "../nightworkers/routing/workbench-route-state";
import type { Task, TaskRun, TaskRunTodo } from "../nightworkers/types";
import { isPostImplementationReviewReady } from "./reviewModeLauncher";

export function resolveReviewModeArtifactAutoFocus(input: {
	activeSession: Task | null;
	latestRun?: TaskRun;
	latestRunTodos: TaskRunTodo[];
	routeState: WorkbenchRouteState;
}) {
	const readyKey = resolveReviewModeReadyKey(input);
	if (
		input.routeState.kind !== "session" ||
		input.routeState.artifact !== null
	) {
		return null;
	}
	return readyKey;
}

function resolveReviewModeReadyKey(input: {
	activeSession: Task | null;
	latestRun?: TaskRun;
	latestRunTodos: TaskRunTodo[];
	routeState: WorkbenchRouteState;
}) {
	const task = input.activeSession;
	if (
		!task ||
		input.routeState.kind !== "session" ||
		input.routeState.sessionId !== task.id ||
		!isPostImplementationReviewReady({
			task,
			run: input.latestRun,
			todos: input.latestRunTodos,
		})
	) {
		return null;
	}
	return `${task.id}:${input.latestRun?.id}:review-mode`;
}

export function useReviewModeArtifactAutoFocus(input: {
	activeSession: Task | null;
	latestRun?: TaskRun;
	latestRunTodos: TaskRunTodo[];
	routeState: WorkbenchRouteState;
	onNavigate: (routeState: WorkbenchRouteState) => void;
}) {
	const lastAutoFocusKeyRef = useRef<string | null>(null);
	const readyKey = resolveReviewModeReadyKey(input);
	const autoFocusKey =
		input.routeState.kind === "session" && input.routeState.artifact === null
			? readyKey
			: null;

	useEffect(() => {
		const sessionId = input.activeSession?.id;
		if (!readyKey || !sessionId) {
			lastAutoFocusKeyRef.current = null;
			return;
		}
		if (lastAutoFocusKeyRef.current === readyKey) return;
		lastAutoFocusKeyRef.current = readyKey;
		if (!autoFocusKey) return;
		input.onNavigate({
			kind: "session",
			sessionId,
			artifact: { kind: "review_status" },
		});
	}, [autoFocusKey, input.activeSession?.id, input.onNavigate, readyKey]);
}
