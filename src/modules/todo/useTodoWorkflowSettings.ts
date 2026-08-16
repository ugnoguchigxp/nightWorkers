import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { readJsonResponse } from "../../lib/api-error";
import type { TodoWorkflowSettings } from "../nightworkers/types";
import {
	fetchTodoWorkflowSettings,
	updateTodoWorkflowSettings,
} from "./todoCommands";

export function useTodoWorkflowSettings() {
	const queryClient = useQueryClient();
	const { data: todoWorkflowSettings = null } = useQuery({
		queryKey: ["todoWorkflowSettings"],
		queryFn: async () => {
			return readJsonResponse<TodoWorkflowSettings>(
				await fetchTodoWorkflowSettings(),
			);
		},
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
	});

	const updateTodoWorkflowSettingsMutation = useMutation({
		mutationFn: async (input: Partial<TodoWorkflowSettings>) => {
			return readJsonResponse<TodoWorkflowSettings>(
				await updateTodoWorkflowSettings(input),
			);
		},
		onSuccess: (settings) => {
			queryClient.setQueryData(["todoWorkflowSettings"], settings);
			queryClient.invalidateQueries({ queryKey: ["todoWorkflowSettings"] });
		},
	});

	return {
		todoWorkflowSettings,
		updateTodoWorkflowSettings: (input: Partial<TodoWorkflowSettings>) =>
			updateTodoWorkflowSettingsMutation.mutateAsync(input),
	};
}
