import * as repo from "../../../modules/nightworkers/nightworkers.repository";
import {
	type McpToolSummary,
	mcpClientManager,
} from "../../mcp/mcp-client-manager";
import {
	isContextStillTool,
	resolveStartupWorkTodo,
	type StartupWorkTodo,
} from "./native-api-startup-support";

export async function resolveStartupWorkTodoForRun(
	runId: string,
): Promise<StartupWorkTodo | null> {
	const todos = await repo.listTaskRunTodosForRun(runId);
	return resolveStartupWorkTodo(todos);
}

export async function resolveContextStillTool(
	input: {
		listAvailableMcpTools?: () => Promise<McpToolSummary[]>;
	},
	toolName: "initial_instructions" | "context_compile",
) {
	const tools = await (
		input.listAvailableMcpTools ?? (() => mcpClientManager.listAvailableTools())
	)();
	return (
		tools.find((tool) => tool.name === toolName && isContextStillTool(tool)) ??
		tools.find((tool) => tool.name === toolName) ??
		null
	);
}
