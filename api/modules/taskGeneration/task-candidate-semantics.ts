import type { MissionGoal } from "../../../shared/schemas/task-generation.schema";
import { ValidationError } from "../../lib/errors";

export function selectMissionGoalsForGeneration(
	allGoals: MissionGoal[],
	input: { goalIds?: string[]; includeInactiveGoals?: boolean },
) {
	const requestedGoalIds = [...new Set(input.goalIds ?? [])];
	const knownGoalIds = new Set(allGoals.map((goal) => goal.id));
	const unknownGoalIds = requestedGoalIds.filter(
		(goalId) => !knownGoalIds.has(goalId),
	);
	if (unknownGoalIds.length > 0) {
		throw new ValidationError("Mission goal not found", { unknownGoalIds });
	}
	return allGoals.filter((goal) => {
		if (requestedGoalIds.length && !requestedGoalIds.includes(goal.id)) {
			return false;
		}
		return input.includeInactiveGoals || goal.active;
	});
}
