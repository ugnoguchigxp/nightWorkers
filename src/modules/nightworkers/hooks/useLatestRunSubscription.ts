import { type MutableRefObject, useEffect } from "react";
import type { TaskEvent, TaskRun } from "../types";

type LatestRunSubscription = {
	runId: string | null;
	afterSeq?: number;
};

export function useLatestRunSubscription(input: {
	activeSessionId: string | null;
	latestRun: TaskRun | undefined;
	latestRunEvents: TaskEvent[];
	subscriptionRef: MutableRefObject<LatestRunSubscription>;
}) {
	useEffect(() => {
		const runBelongsToActiveSession = Boolean(
			input.activeSessionId &&
				input.latestRun?.id &&
				input.latestRun.taskId === input.activeSessionId,
		);
		const maxSeq = input.latestRunEvents.reduce<number | undefined>(
			(currentMax, event) => {
				if (typeof event.seq !== "number") return currentMax;
				if (currentMax === undefined) return event.seq;
				return Math.max(currentMax, event.seq);
			},
			undefined,
		);
		input.subscriptionRef.current = {
			runId: runBelongsToActiveSession ? input.latestRun?.id || null : null,
			afterSeq: runBelongsToActiveSession ? maxSeq : undefined,
		};
	}, [
		input.activeSessionId,
		input.latestRun,
		input.latestRunEvents,
		input.subscriptionRef,
	]);
}
