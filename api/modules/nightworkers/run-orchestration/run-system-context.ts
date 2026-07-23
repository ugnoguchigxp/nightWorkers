import type { RuntimePromptSnapshot } from "../../../services/todo-context";
import {
	bindSystemContextTextCatalog,
	createSystemContextBindingSnapshot,
	readSystemContextBindingSnapshot,
} from "../../../systemContexts/catalog";
import {
	buildCodingAgentSystemContext,
	readCodingAgentPlanModeRequested,
} from "../../codingAgent";

export function resolveRunSystemContextBinding(contextSnapshot: unknown) {
	return (
		readSystemContextBindingSnapshot(contextSnapshot) ??
		createSystemContextBindingSnapshot()
	);
}

export function buildRunCodingAgentSystemContext(input: {
	taskGoal: string;
	registeredRepositoryRoot: string;
	runtimeContextSnapshot: RuntimePromptSnapshot;
}) {
	const systemContexts = bindSystemContextTextCatalog(
		input.runtimeContextSnapshot.systemContextBinding,
	);
	return buildCodingAgentSystemContext(
		{
			taskGoal: input.taskGoal,
			registeredRepositoryRoot: input.registeredRepositoryRoot,
			planModeRequested: readCodingAgentPlanModeRequested(
				input.runtimeContextSnapshot,
			),
		},
		systemContexts.p,
	);
}
