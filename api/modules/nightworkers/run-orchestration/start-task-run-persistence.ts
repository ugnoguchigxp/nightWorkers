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

export async function recordRuntimePromptPrepared(input: {
	taskId: string;
	runId: string;
	source: string;
	digest: string;
	charCount: number;
	runtimeLaneResolution: {
		lane: string;
		workerKind: string;
		[key: string]: unknown;
	};
	effectiveLlmRouting: unknown;
	executionMode: string;
	executionModeSource: string;
	runtimeRole: string;
	systemContextBinding: unknown;
}) {
	await repo.createRunEvent({
		version: 1,
		runId: input.runId,
		taskId: input.taskId,
		timestamp: new Date().toISOString(),
		type: "run.prompt_prepared",
		severity: "info",
		actor: "system",
		message: "Runtime prompt prepared.",
		data: {
			source: input.source,
			degraded: false,
			digest: input.digest,
			charCount: input.charCount,
			runtimeLane: input.runtimeLaneResolution.lane,
			workerKind: input.runtimeLaneResolution.workerKind,
			runtimeLaneResolution: input.runtimeLaneResolution,
			effectiveLlmRouting: input.effectiveLlmRouting,
			executionMode: input.executionMode,
			executionModeSource: input.executionModeSource,
			runtimeRole: input.runtimeRole,
			systemContextBinding: input.systemContextBinding,
		},
	});
}
