import { AppError } from "../../../lib/errors";
import * as repo from "../nightworkers.repository";

type TaskRun = NonNullable<Awaited<ReturnType<typeof repo.getTaskRun>>>;

export async function persistPreparedRuntimePrompt(input: {
	taskId: string;
	run: TaskRun;
	resuming: boolean;
	compiledPromptText: string;
	runtimeContextSnapshot: unknown;
}) {
	if (!input.resuming) {
		await repo.updateTaskCompiledPrompt(input.taskId, input.compiledPromptText);
		return (
			(await repo.updateTaskRun(input.run.id, {
				status: "running",
				contextSnapshot: input.runtimeContextSnapshot,
			})) ?? input.run
		);
	}
	const updated = await repo.updateTaskRunResumePreparation({
		runId: input.run.id,
		taskId: input.taskId,
		expectedUpdatedAt: input.run.updatedAt,
		expectedContextSnapshot: input.run.contextSnapshot,
		compiledPromptText: input.compiledPromptText,
		contextSnapshot: input.runtimeContextSnapshot,
	});
	if (!updated) {
		throw new AppError(
			409,
			"RUN_RESUME_PREPARATION_CONFLICT",
			"Run changed while resume was being prepared; reload the latest Task state.",
		);
	}
	return updated;
}
