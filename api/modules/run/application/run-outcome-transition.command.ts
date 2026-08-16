import { AppError } from "../../../lib/errors";
import {
	type RunOutcomeTransitionInput,
	transitionRunOutcome,
} from "../run-outcome-transition.repository";

export async function applyRunOutcomeTransition(
	input: RunOutcomeTransitionInput,
) {
	const result = await transitionRunOutcome(input);
	if (result.kind === "not_found") {
		throw new AppError(404, "RUN_OUTCOME_NOT_FOUND", "Run not found");
	}
	if (result.kind === "conflict") {
		throw new AppError(
			409,
			"RUN_OUTCOME_CONFLICT",
			"Run, Task, or Queue state changed; re-read the current state.",
			{
				currentRunId: result.run?.id ?? null,
				currentTaskId: result.task?.id ?? null,
				currentQueueEntryId: result.queueEntry?.id ?? null,
			},
		);
	}
	return result;
}
