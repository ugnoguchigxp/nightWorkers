import type { PromptImageAttachment } from "../../../../shared/prompt-image";
import type { resolveRuntimeLaneDefinition } from "../../../services/agent-runtime/registry";
import type { RuntimeLaneResolution } from "../../../services/agent-runtime/runtime-lane";
import type { RuntimePromptSnapshot } from "../../../services/todo-context";
import type * as repo from "../nightworkers.repository";

type RuntimeLaneDefinition = ReturnType<typeof resolveRuntimeLaneDefinition>;

type RuntimeOptions = Parameters<
	ReturnType<RuntimeLaneDefinition["createAdapter"]>["start"]
>[0]["runtimeOptions"];

export type LaunchRuntimeExecutionInput = {
	taskId: string;
	task: NonNullable<Awaited<ReturnType<typeof repo.getTask>>>;
	run: NonNullable<Awaited<ReturnType<typeof repo.getTaskRun>>>;
	repoInfo: NonNullable<Awaited<ReturnType<typeof repo.getRepository>>>;
	compiledPromptText: string;
	runtimeLatestUserMessage: string;
	runtimeImageAttachments: PromptImageAttachment[];
	runtimeContextSnapshot: RuntimePromptSnapshot;
	runtimeOptions: RuntimeOptions;
	runtimeLaneDefinition: RuntimeLaneDefinition;
	runtimeLaneResolution: RuntimeLaneResolution;
	agentModeSessionId?: string | null;
};
