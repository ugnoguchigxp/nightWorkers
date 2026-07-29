import { enqueueActivityEvent } from "../../nightworkers/nightworkers.activity-persistence.repository";

export function enqueueTaskActivityEvent(
	input: Parameters<typeof enqueueActivityEvent>[0],
) {
	return enqueueActivityEvent(input);
}
