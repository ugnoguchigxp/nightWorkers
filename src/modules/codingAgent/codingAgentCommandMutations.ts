import { useMutation } from "@tanstack/react-query";
import { taskRunSchema } from "../../../shared/schemas/nightworkers/run.schema";
import { apiFetch } from "../../lib/api-base";
import {
	type CodingAgentCommandClient,
	createCodingAgentCommandRequest,
} from "./codingAgentCommandClient";

type StartInput = { taskId: string; expectedTaskRevision: number };
type StopInput = StartInput & { runId: string };
type ResumeInput = StopInput & {
	todoId: string;
	expectedTodoRevision: number;
	userContext: string;
};
type CommandRun = ReturnType<typeof taskRunSchema.parse>;

export function useCodingAgentCommandMutations(input: {
	client: CodingAgentCommandClient;
	onFailure?: (taskId: string, error: unknown) => unknown;
	onStartSuccess?: (run: CommandRun) => Promise<void> | void;
	onStopSuccess?: (run: CommandRun) => Promise<void> | void;
	onResumeSuccess?: (run: CommandRun) => Promise<void> | void;
}) {
	const startRunMutation = useMutation({
		mutationFn: async (command: StartInput) =>
			executeAndLoadRun(input, command.taskId, {
				taskId: command.taskId,
				actionId: "run.implementation.start",
				expectedTaskRevision: command.expectedTaskRevision,
				arguments: {},
			}),
		onSuccess: input.onStartSuccess,
		retry: false,
	});
	const stopRunMutation = useMutation({
		mutationFn: async (command: StopInput) =>
			executeAndLoadRun(input, command.taskId, {
				taskId: command.taskId,
				actionId: "run.stop",
				expectedTaskRevision: command.expectedTaskRevision,
				arguments: { runId: command.runId },
			}),
		onSuccess: input.onStopSuccess,
		retry: false,
	});
	const resumeTodoMutation = useMutation({
		mutationFn: async (command: ResumeInput) =>
			executeAndLoadRun(input, command.taskId, {
				taskId: command.taskId,
				actionId: "run.todo.resume",
				expectedTaskRevision: command.expectedTaskRevision,
				arguments: {
					runId: command.runId,
					todoId: command.todoId,
					expectedTodoRevision: command.expectedTodoRevision,
					userContext: command.userContext,
				},
			}),
		onSuccess: input.onResumeSuccess,
		retry: false,
	});
	return { startRunMutation, stopRunMutation, resumeTodoMutation };
}

async function executeAndLoadRun(
	input: Parameters<typeof useCodingAgentCommandMutations>[0],
	taskId: string,
	command: Parameters<typeof createCodingAgentCommandRequest>[0],
) {
	try {
		const result = await input.client.execute(
			createCodingAgentCommandRequest(command),
		);
		const response = await apiFetch(`/api/runs/${result.data.runId}`);
		if (!response.ok) throw new Error("Failed to load Coding Agent run");
		return taskRunSchema.parse(await response.json());
	} catch (error) {
		await input.onFailure?.(taskId, error);
		throw error;
	}
}
