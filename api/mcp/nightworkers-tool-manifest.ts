import { z } from "zod";
import { TEST_EVIDENCE_MAPPING_TOOL_DESCRIPTION_JA } from "../../shared/modules/codingAgent";

export * from "./nightworkers-tool-schemas";

import {
	nightWorkersCheckBoundaryInputSchema,
	nightWorkersClassifyGoalInputSchema,
	nightWorkersCollectTestInventoryInputSchema,
	nightWorkersCompileModuleContextInputSchema,
	nightWorkersCompletionCheckInputSchema,
	nightWorkersGetModuleOntologyInputSchema,
	nightWorkersGetVerificationPlanInputSchema,
	nightWorkersImportProjectInputSchema,
	nightWorkersListOntologyModulesInputSchema,
	nightWorkersListRecentSpecificationsInputSchema,
	nightWorkersReadCurrentSpecificationInputSchema,
	nightWorkersRecordTestConditionMappingInputSchema,
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
			"Planが未採用の直接Runではplanで工程を作成し、以後はcurrent Todoをcomplete_currentまたはblock_currentで明示更新します。生成するstep fieldはtitleとsystemContextだけです。",
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
			"Run a check command in the registered repository and return a typed result with raw stdout/stderr. Stored verification data is an observable fact, not an automatic Todo or Run completion gate.",
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
			"Read the current verification checklist projection and return a typed status. The Coding Agent decides how to use the result.",
		annotations: {
			readOnlyHint: true,
			destructiveHint: false,
			openWorldHint: false,
		},
		approvalMode: "approve",
		inputSchema: nightWorkersCompletionCheckInputSchema,
	},
	collect_test_inventory: {
		title: "Collect Test Inventory",
		description:
			"Discover test definitions in the registered repository. Active discovery and filename candidates are reported separately; this does not execute tests or update Todo state.",
		annotations: {
			readOnlyHint: false,
			destructiveHint: false,
			openWorldHint: false,
		},
		approvalMode: "approve",
		inputSchema: nightWorkersCollectTestInventoryInputSchema,
	},
	record_test_condition_mapping: {
		title: "Record Test Condition Mapping",
		description: TEST_EVIDENCE_MAPPING_TOOL_DESCRIPTION_JA,
		annotations: {
			readOnlyHint: false,
			destructiveHint: false,
			openWorldHint: false,
		},
		approvalMode: "approve",
		inputSchema: nightWorkersRecordTestConditionMappingInputSchema,
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
const ONTOLOGY_CODEX_TOOLS = new Set<NightWorkersCodexToolName>([
	"list_modules",
	"get_module_ontology",
	"classify_goal",
	"compile_module_context",
	"check_boundary",
	"get_verification_plan",
]);

export function getNightWorkersCodexToolNames(
	input: { ontologyMcpEnabled?: boolean } = {},
) {
	return Object.keys(nightWorkersCodexToolManifest)
		.filter((tool): tool is NightWorkersCodexToolName =>
			isNightWorkersCodexToolAllowedForMode(
				tool as NightWorkersCodexToolName,
				input.ontologyMcpEnabled,
			),
		)
		.map((tool) => `nightworkers.${tool}`);
}

export function buildNightWorkersCodexToolApprovalConfig(
	input: { ontologyMcpEnabled?: boolean } = {},
) {
	return Object.fromEntries(
		Object.entries(nightWorkersCodexToolManifest)
			.filter(([name]) =>
				isNightWorkersCodexToolAllowedForMode(
					name as NightWorkersCodexToolName,
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
	input: { ontologyMcpEnabled?: boolean } = {},
) {
	return Object.entries(nightWorkersCodexToolManifest)
		.filter(([name]) =>
			isNightWorkersCodexToolAllowedForMode(
				name as NightWorkersCodexToolName,
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
	ontologyMcpEnabled = false,
) {
	if (!ontologyMcpEnabled && ONTOLOGY_CODEX_TOOLS.has(tool)) return false;
	return true;
}

export function toNightWorkersJsonSchema(schema: z.ZodTypeAny) {
	const jsonSchema = z.toJSONSchema(schema) as Record<string, unknown>;
	const { $schema: _ignored, ...rest } = jsonSchema;
	return rest;
}
