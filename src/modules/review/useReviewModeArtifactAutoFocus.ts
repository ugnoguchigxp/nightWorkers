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
		isReviewModeArtifact(input.routeState.artifact)
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
	const isReviewModeFocused =
		input.routeState.kind === "session" &&
		isReviewModeArtifact(input.routeState.artifact);
	const autoFocusKey =
		input.routeState.kind === "session" && !isReviewModeFocused
			? readyKey
			: null;

	useEffect(() => {
		const sessionId = input.activeSession?.id;
		if (!readyKey || !sessionId) {
			lastAutoFocusKeyRef.current = null;
			return;
		}
		if (isReviewModeFocused) {
			lastAutoFocusKeyRef.current = readyKey;
			return;
		}
		if (!autoFocusKey) return;
		if (lastAutoFocusKeyRef.current === autoFocusKey) return;
		lastAutoFocusKeyRef.current = autoFocusKey;
		input.onNavigate({
			kind: "session",
			sessionId,
			artifact: { kind: "review_status" },
		});
	}, [
		autoFocusKey,
		input.activeSession?.id,
		input.onNavigate,
		isReviewModeFocused,
		readyKey,
	]);
}

function isReviewModeArtifact(
	artifact:
		| Extract<WorkbenchRouteState, { kind: "session" }>["artifact"]
		| undefined,
) {
	return artifact?.kind === "review_status";
}
