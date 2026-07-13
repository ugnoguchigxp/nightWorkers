import { z } from "zod";

export * from "./nightworkers-tool-schemas";

import {
	nightWorkersCheckBoundaryInputSchema,
	nightWorkersClassifyGoalInputSchema,
	nightWorkersCompileModuleContextInputSchema,
	nightWorkersCompletionCheckInputSchema,
	nightWorkersGetModuleOntologyInputSchema,
	nightWorkersGetVerificationPlanInputSchema,
	nightWorkersImportProjectInputSchema,
	nightWorkersListOntologyModulesInputSchema,
	nightWorkersListRecentSpecificationsInputSchema,
	nightWorkersReadCurrentSpecificationInputSchema,
	nightWorkersReviewerEvaluationInputSchema,
	nightWorkersRunCheckInputSchema,
	nightWorkersTodoListInputSchema,
} from "./nightworkers-tool-schemas";

export const nightWorkersCodexToolManifest = {
	read_current_specification: {
		title: "Read Current Specification",
		description:
			"Read the latest NightWorkers draft specification markdown for a task. Defaults to view=compact; use view=full only when the complete markdown is necessary. Pass includeDesignContext=true to include assembled Plan Mode artifact contracts. This is read-only and does not edit project files.",
		annotations: {
			readOnlyHint: true,
			destructiveHint: false,
			openWorldHint: false,
		},
		approvalMode: "approve",
		inputSchema: nightWorkersReadCurrentSpecificationInputSchema,
	},
	list_recent_specifications: {
		title: "List Recent Specifications",
		description:
			"List recent NightWorkers draft specifications with task ids so Codex can choose the right task before reading the full specification.",
		annotations: {
			readOnlyHint: true,
			destructiveHint: false,
			openWorldHint: false,
		},
		approvalMode: "approve",
		inputSchema: nightWorkersListRecentSpecificationsInputSchema,
	},
	todo_list: {
		title: "Todo List",
		description:
			"Maintain the current run TodoList with one JSON operation. todo_list operation=replace structurally replans the TodoList and requires todoListReplaceReason when a Todo is already running. todo_list operation=start/done/block/fail transitions existing Todo state. todo_list operation=done automatically starts the next pending Todo.",
		annotations: {
			readOnlyHint: false,
			destructiveHint: false,
			openWorldHint: false,
		},
		approvalMode: "approve",
		inputSchema: nightWorkersTodoListInputSchema,
	},
	run_check: {
		title: "Run Check",
		description:
			"Run a NightWorkers-managed check command and store raw stdout/stderr as formal verification evidence. Use conditionIds to link the command to the AC-xxx completion conditions it directly verifies. An unmapped broad gate is supplemental evidence only.",
		annotations: {
			readOnlyHint: false,
			destructiveHint: false,
			openWorldHint: false,
		},
		approvalMode: "approve",
		inputSchema: nightWorkersRunCheckInputSchema,
	},
	completion_check: {
		title: "Completion Check",
		description:
			"Check required Verification Checklist items against managed NightWorkers test evidence before closeout.",
		annotations: {
			readOnlyHint: true,
			destructiveHint: false,
			openWorldHint: false,
		},
		approvalMode: "approve",
		inputSchema: nightWorkersCompletionCheckInputSchema,
	},
	reviewer_evaluation: {
		title: "Reviewer Evaluation",
		description:
			"Run the final NightWorkers reviewer evaluation for a Review Mode run. changes_requested is actionable review feedback, not a tool error: fix the findings, rerun required checks, and rerun reviewer_evaluation until approved.",
		annotations: {
			readOnlyHint: false,
			destructiveHint: false,
			openWorldHint: false,
		},
		approvalMode: "approve",
		inputSchema: nightWorkersReviewerEvaluationInputSchema,
	},
	import_project: {
		title: "Import Project",
		description:
			"Single import entrypoint for NightWorkers projects. Use source=starter with stack/variant for new scaffolds, or source=git with repoUrl for arbitrary Git repositories.",
		annotations: {
			readOnlyHint: false,
			destructiveHint: true,
			openWorldHint: false,
		},
		approvalMode: "approve",
		inputSchema: nightWorkersImportProjectInputSchema,
	},
	list_modules: {
		title: "List Ontology Modules",
		description:
			"List coding-agent module ontology entries from .agent-ontology/modules.yaml. This is read-only.",
		annotations: {
			readOnlyHint: true,
			destructiveHint: false,
			openWorldHint: false,
		},
		approvalMode: "approve",
		inputSchema: nightWorkersListOntologyModulesInputSchema,
	},
	get_module_ontology: {
		title: "Get Module Ontology",
		description:
			"Read one module ontology manifest, including owned paths, invariants, boundaries, and verification plan. This is read-only.",
		annotations: {
			readOnlyHint: true,
			destructiveHint: false,
			openWorldHint: false,
		},
		approvalMode: "approve",
		inputSchema: nightWorkersGetModuleOntologyInputSchema,
	},
	classify_goal: {
		title: "Classify Goal",
		description:
			"Classify a user goal into primaryModule, secondaryModules, changeTypes, risk, confidence, and reason using module ontology evidence. This is read-only.",
		annotations: {
			readOnlyHint: true,
			destructiveHint: false,
			openWorldHint: false,
		},
		approvalMode: "approve",
		inputSchema: nightWorkersClassifyGoalInputSchema,
	},
	compile_module_context: {
		title: "Compile Module Context",
		description:
			"Compile canonical or task-scoped module context from ontology manifest, code evidence, task generation evidence, and memory hints. This is read-only.",
		annotations: {
			readOnlyHint: true,
			destructiveHint: false,
			openWorldHint: false,
		},
		approvalMode: "approve",
		inputSchema: nightWorkersCompileModuleContextInputSchema,
	},
	check_boundary: {
		title: "Check Boundary",
		description:
			"Check planned or touched files against module owned paths, allowed crossings, read-mostly paths, and unknown paths. This is read-only.",
		annotations: {
			readOnlyHint: true,
			destructiveHint: false,
			openWorldHint: false,
		},
		approvalMode: "approve",
		inputSchema: nightWorkersCheckBoundaryInputSchema,
	},
	get_verification_plan: {
		title: "Get Verification Plan",
		description:
			"Return baseline, focused, and full verification commands for a primary module and optional secondary modules. This is read-only.",
		annotations: {
			readOnlyHint: true,
			destructiveHint: false,
			openWorldHint: false,
		},
		approvalMode: "approve",
		inputSchema: nightWorkersGetVerificationPlanInputSchema,
	},
} as const;

export type NightWorkersCodexToolName =
	keyof typeof nightWorkersCodexToolManifest;
export type NightWorkersCodexToolExecutionMode =
	| "planning"
	| "implementation"
	| "test"
	| "review"
	| "general_answer";

const PLAN_MODE_READ_ONLY_CODEX_TOOLS = new Set<NightWorkersCodexToolName>([
	"read_current_specification",
	"list_recent_specifications",
	"list_modules",
	"get_module_ontology",
	"classify_goal",
	"compile_module_context",
	"check_boundary",
	"get_verification_plan",
]);

const ONTOLOGY_CODEX_TOOLS = new Set<NightWorkersCodexToolName>([
	"list_modules",
	"get_module_ontology",
	"classify_goal",
	"compile_module_context",
	"check_boundary",
	"get_verification_plan",
]);

export function getNightWorkersCodexToolNames(
	input: { executionMode?: string; ontologyMcpEnabled?: boolean } = {},
) {
	return Object.keys(nightWorkersCodexToolManifest)
		.filter((tool): tool is NightWorkersCodexToolName =>
			isNightWorkersCodexToolAllowedForMode(
				tool as NightWorkersCodexToolName,
				input.executionMode,
				input.ontologyMcpEnabled,
			),
		)
		.map((tool) => `nightworkers.${tool}`);
}

export function buildNightWorkersCodexToolApprovalConfig(
	input: { executionMode?: string; ontologyMcpEnabled?: boolean } = {},
) {
	return Object.fromEntries(
		Object.entries(nightWorkersCodexToolManifest)
			.filter(([name]) =>
				isNightWorkersCodexToolAllowedForMode(
					name as NightWorkersCodexToolName,
					input.executionMode,
					input.ontologyMcpEnabled,
				),
			)
			.map(([name, definition]) => [
				name,
				{ approval_mode: definition.approvalMode },
			]),
	);
}

export function buildNightWorkersCodexToolConfigLines(
	input: { executionMode?: string; ontologyMcpEnabled?: boolean } = {},
) {
	return Object.entries(nightWorkersCodexToolManifest)
		.filter(([name]) =>
			isNightWorkersCodexToolAllowedForMode(
				name as NightWorkersCodexToolName,
				input.executionMode,
				input.ontologyMcpEnabled,
			),
		)
		.flatMap(([name, definition]) => [
			"",
			`[mcp_servers.nightworkers.tools.${name}]`,
			`approval_mode = "${definition.approvalMode}"`,
		]);
}

export function isNightWorkersCodexToolAllowedForMode(
	tool: NightWorkersCodexToolName,
	executionMode?: string,
	ontologyMcpEnabled = false,
) {
	if (!ontologyMcpEnabled && ONTOLOGY_CODEX_TOOLS.has(tool)) return false;
	if (executionMode === "test" && tool === "reviewer_evaluation") return false;
	if (executionMode !== "planning") return true;
	return PLAN_MODE_READ_ONLY_CODEX_TOOLS.has(tool);
}

export function toNightWorkersJsonSchema(schema: z.ZodTypeAny) {
	const jsonSchema = z.toJSONSchema(schema) as Record<string, unknown>;
	const { $schema: _ignored, ...rest } = jsonSchema;
	return rest;
}
