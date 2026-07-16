import type { MissionPilotTaskEventType } from "../../../../shared/schemas/mission-pilot-agent.schema";

export type MissionPilotActionExecutionMetadata = {
	effect: "read" | "mutation";
	completion: "immediate" | "wait_for_event" | "finish_candidate";
	expectedEventTypes: MissionPilotTaskEventType[];
	reconciliation: "none" | "query_receipt" | "query_resource";
};

export function missionPilotActionExecutionMetadata(
	actionId: string,
): MissionPilotActionExecutionMetadata {
	const eventDrivenActions = new Set([
		"questionnaire.draft.update",
		"questionnaire.draft.save",
		"questionnaire.submit",
		"questionnaire.follow_up.generate",
		"questionnaire.review.generate",
		"questionnaire.review.accept",
		"questionnaire.review.leave_unadopted",
		"task.queue.enqueue",
		"run.implementation.start",
		"run.test.start",
		"review.run.start",
	]);
	const completion =
		actionId === "task.complete" || actionId === "task.archive"
			? "finish_candidate"
			: eventDrivenActions.has(actionId)
				? "wait_for_event"
				: "immediate";
	const expectedEventTypes: MissionPilotTaskEventType[] =
		completion !== "wait_for_event"
			? []
			: actionId.startsWith("questionnaire.")
				? [
						"questionnaire.state_changed",
						"questionnaire.submission_failed",
						"questionnaire.follow_up_failed",
					]
				: actionId.startsWith("run.") ||
						actionId.startsWith("review.") ||
						actionId === "task.queue.enqueue"
					? [
							"task_run.started",
							"task_run.terminal",
							"task_run.failed",
							"task_queue.failed",
						]
					: [];
	return {
		effect: "mutation",
		completion,
		expectedEventTypes,
		reconciliation:
			completion === "wait_for_event" ? "query_resource" : "query_receipt",
	};
}
