import type { TaskOperatorAvailableCommand } from "../../../../shared/modules/taskOperator";

const COMMAND_IDS = [
	"task.update",
	"task.message.send",
	"task.archive",
	"task.archive.restore",
	"task.complete",
	"questionnaire.create",
	"questionnaire.draft.update",
	"questionnaire.draft.save",
	"questionnaire.submit",
	"questionnaire.follow_up.generate",
	"questionnaire.additional.generate",
	"questionnaire.review.generate",
	"questionnaire.review.accept",
	"questionnaire.review.leave_unadopted",
	"plan.artifact.feature_plan.generate",
	"plan.artifact.blueprint.generate",
	"plan.artifact.data_model.generate",
	"plan.artifact.view.generate",
	"plan.routing.update",
	"task.queue.enqueue",
	"task.queue.update",
	"task.queue.cancel",
	"task.queue.requeue",
	"task.queue.recover",
	"task.queue.archive",
	"run.implementation.start",
	"run.todo.resume",
	"run.stop",
	"background_process.stop",
	"run.review.submit",
	"git.commit",
	"git.push",
	"git.merge.preview",
	"git.merge.defer",
	"git.merge.rework",
	"git.merge.target.update",
	"git.merge.execute",
] as const;

export function composeTaskOperatorCommandCatalog(input: {
	taskRevision: number;
	taskStatus: string;
	repositoryAvailable: boolean;
	hasActiveRun: boolean;
	hasTerminalRun: boolean;
	currentTodoStatus: string | null;
}) {
	const terminalTask = [
		"completed",
		"archived",
		"cancelled",
		"failed",
		"timed_out",
	].includes(input.taskStatus);
	return COMMAND_IDS.map((id): TaskOperatorAvailableCommand => {
		let unavailableReasonCode: string | null = null;
		if (id === "task.archive") {
			if (input.taskStatus !== "completed")
				unavailableReasonCode = "task_not_completed";
		} else if (id === "task.archive.restore") {
			if (input.taskStatus !== "archived")
				unavailableReasonCode = "task_not_archived";
		} else if (input.taskStatus === "archived") {
			unavailableReasonCode = "task_archived";
		} else if (id === "run.implementation.start") {
			if (!input.repositoryAvailable)
				unavailableReasonCode = "repository_unavailable";
			else if (input.hasActiveRun) unavailableReasonCode = "active_run_exists";
			else if (terminalTask) unavailableReasonCode = "task_terminal";
		} else if (id === "run.todo.resume") {
			if (input.currentTodoStatus !== "needs_human")
				unavailableReasonCode = "todo_not_waiting_for_human";
		} else if (id === "run.stop") {
			if (!input.hasActiveRun) unavailableReasonCode = "active_run_missing";
		} else if (id === "task.complete") {
			if (!input.hasTerminalRun) unavailableReasonCode = "terminal_run_missing";
		} else if (terminalTask) {
			unavailableReasonCode = "task_terminal";
		}
		return {
			id,
			availability: unavailableReasonCode ? "unavailable" : "available",
			unavailableReasonCode,
			expectedRevision: input.taskRevision,
		};
	});
}
