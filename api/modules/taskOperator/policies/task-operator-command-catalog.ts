import type { TaskOperatorAvailableCommand } from "../../../../shared/modules/taskOperator";
import { TASK_OPERATOR_ACTION_DEFINITIONS } from "./task-operator-action.registry";

export const TASK_OPERATOR_COMMAND_IDS = Object.freeze(
	TASK_OPERATOR_ACTION_DEFINITIONS.map((definition) => definition.actionId),
);

export function composeTaskOperatorCommandCatalog(input: {
	taskRevision: number;
	taskStatus: string;
	repositoryAvailable: boolean;
	hasActiveRun: boolean;
	activeRunStatus?: string | null;
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
	return TASK_OPERATOR_COMMAND_IDS.map((id): TaskOperatorAvailableCommand => {
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
			else if (
				input.hasActiveRun &&
				(input.activeRunStatus !== "needs_human" ||
					input.currentTodoStatus === "needs_human")
			)
				unavailableReasonCode = "active_run_exists";
			else if (terminalTask && input.taskStatus !== "failed")
				unavailableReasonCode = "task_terminal";
		} else if (id === "run.todo.resume") {
			if (input.currentTodoStatus !== "needs_human")
				unavailableReasonCode = "todo_not_waiting_for_human";
		} else if (id === "run.stop") {
			if (!input.hasActiveRun) unavailableReasonCode = "active_run_missing";
		} else if (id === "run.review.submit") {
			if (!input.hasTerminalRun) unavailableReasonCode = "terminal_run_missing";
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
