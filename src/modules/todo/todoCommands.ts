import { apiFetch } from "../../lib/api-base";
import { jsonRequest } from "../../lib/api-request";
import type { TodoWorkflowSettings } from "../nightworkers/types";

export function fetchTodoWorkflowSettings() {
	return apiFetch("/api/todo-workflow/settings");
}

export function updateTodoWorkflowSettings(
	input: Partial<TodoWorkflowSettings>,
) {
	return apiFetch("/api/todo-workflow/settings", jsonRequest("PATCH", input));
}
