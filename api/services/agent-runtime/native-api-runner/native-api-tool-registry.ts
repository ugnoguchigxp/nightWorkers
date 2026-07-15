import type { ProviderToolDefinition } from "../../structured-llm/tool-calls";
import type { NativeApiExecutionMode } from "./native-api-mode";

export * from "./native-api-tool-manifest";

import {
	type NativeApiRuntimeToolName,
	type NativeApiToolProfileInput,
	type NativeApiToolProfileTodo,
	type NativeApiToolRegistration,
	nativeApiToolRegistrations,
} from "./native-api-tool-manifest";

const nativeApiToolNamesByMode: Record<
	NativeApiExecutionMode,
	Set<NativeApiRuntimeToolName>
> = {
	planning: new Set([
		"read_current_specification",
		"list_dir",
		"read_file",
		"search_files",
		"git_status",
		"git_diff",
		"list_mcp_tools",
		"context_initial_instructions",
		"context_compile",
		"context_decision",
		"new_context",
		"finalize_answer",
	]),
	implementation: new Set(
		nativeApiToolRegistrations.map((registration) => registration.name),
	),
	test: new Set([
		"read_current_specification",
		"list_dir",
		"read_file",
		"search_files",
		"apply_patch",
		"replace_content",
		"run_check",
		"run_verification",
		"completion_check",
		"git_status",
		"git_diff",
		"context_initial_instructions",
		"context_compile",
		"context_decision",
		"compile_eval",
		"todo_list",
		"new_context",
		"finalize_answer",
	]),
	review: new Set([
		"read_current_specification",
		"list_dir",
		"read_file",
		"search_files",
		"git_status",
		"git_diff",
		"run_check",
		"run_verification",
		"completion_check",
		"reviewer_evaluation",
		"list_mcp_tools",
		"context_initial_instructions",
		"context_compile",
		"context_decision",
		"compile_eval",
		"todo_list",
		"new_context",
		"finalize_answer",
	]),
	general_answer: new Set([
		"list_dir",
		"read_file",
		"search_files",
		"git_status",
		"context_compile",
		"new_context",
		"finalize_answer",
	]),
};

export function getNativeApiToolDefinitions(
	input: NativeApiToolProfileInput = {},
): ProviderToolDefinition[] {
	const allowed = modelVisibleNativeApiToolNames({
		mode: input.executionMode ?? "implementation",
		currentTodo: input.currentTodo,
		ontologyMcpEnabled: input.ontologyMcpEnabled,
		projectExplorationCatalogEnabled: input.projectExplorationCatalogEnabled,
	});
	return nativeApiToolRegistrations
		.filter((registration) => allowed.has(registration.name))
		.map((registration) => registration.definition);
}

export function getNativeApiToolRegistration(
	name: string,
): NativeApiToolRegistration | undefined {
	return nativeApiToolRegistrations.find(
		(registration) => registration.name === name,
	);
}

export function isNativeApiToolAllowedForMode(
	name: string,
	mode: NativeApiExecutionMode,
): boolean {
	return allowedNativeApiToolNames(mode).has(name as NativeApiRuntimeToolName);
}

function allowedNativeApiToolNames(mode: NativeApiExecutionMode) {
	return (
		nativeApiToolNamesByMode[mode] ?? nativeApiToolNamesByMode.implementation
	);
}

function modelVisibleNativeApiToolNames(input: {
	mode: NativeApiExecutionMode;
	currentTodo?: NativeApiToolProfileTodo | null;
	ontologyMcpEnabled?: boolean;
	projectExplorationCatalogEnabled?: boolean;
}) {
	if (input.mode !== "implementation")
		return allowedNativeApiToolNames(input.mode);
	const allowed = new Set<NativeApiRuntimeToolName>([
		"read_current_specification",
		"list_dir",
		"read_file",
		"search_files",
		"apply_patch",
		"replace_content",
		"run_verification",
		"run_check",
		"completion_check",
		"git_status",
		"git_diff",
		"context_decision",
		"todo_list",
		"new_context",
		"finalize_answer",
	]);
	for (const toolName of oneShotToolNamesForTodo(input.currentTodo)) {
		allowed.add(toolName);
	}
	if (input.projectExplorationCatalogEnabled) {
		allowed.add("project_exploration_catalog");
	}
	if (input.ontologyMcpEnabled) {
		allowed.add("list_mcp_tools");
		allowed.add("mcp_call_tool");
	}
	return allowed;
}

function oneShotToolNamesForTodo(
	todo?: NativeApiToolProfileTodo | null,
): NativeApiRuntimeToolName[] {
	const taskType = normalizeTodoSelector(todo?.taskType);
	const procedureId = normalizeTodoSelector(todo?.procedureId);
	const selectors = [taskType, procedureId].filter((value): value is string =>
		Boolean(value),
	);
	const tools = new Set<NativeApiRuntimeToolName>();
	if (
		procedureId === "coding_preparation" ||
		taskType === "coding_preparation"
	) {
		tools.add("context_initial_instructions");
		tools.add("context_compile");
		tools.add("import_project");
	}
	if (selectors.some(isImportSelector)) tools.add("import_project");
	if (
		procedureId === "contextstill.initial_instructions" ||
		taskType === "initial_instructions"
	) {
		tools.add("context_initial_instructions");
	}
	if (
		procedureId === "contextstill.context_compile" ||
		taskType === "context_compile"
	) {
		tools.add("context_compile");
	}
	if (
		procedureId === "contextstill.compile_eval" ||
		procedureId === "contextstill_closeout" ||
		taskType === "compile_eval"
	) {
		tools.add("compile_eval");
	}
	return Array.from(tools);
}

function normalizeTodoSelector(value: unknown) {
	return typeof value === "string" && value.trim().length > 0
		? value.trim().toLowerCase()
		: null;
}

function isImportSelector(value: string) {
	return (
		value === "import" ||
		value === "project_import" ||
		value === "import_project" ||
		value.startsWith("import.") ||
		value.startsWith("project_import.") ||
		value.startsWith("import_project.")
	);
}
