import type { WorkerToolResult } from "../worker-tools/types";
import { digestJson } from "./action-identity";
import type {
	DomainOutcome,
	RunControlState,
	RunEffect,
	ToolOutcomeEnvelope,
	TransportStatus,
} from "./contracts";

const OBSERVATION_TOOLS = new Set([
	"read_current_specification",
	"list_recent_specifications",
	"read_file",
	"list_files",
	"git_diff",
	"list_modules",
	"get_module_ontology",
	"classify_goal",
	"compile_module_context",
	"check_boundary",
	"get_verification_plan",
]);
const VERIFICATION_TOOLS = new Set([
	"run_check",
	"completion_check",
	"reviewer_evaluation",
	"run_verification",
]);
const WORKSPACE_MUTATION_TOOLS = new Set([
	"apply_patch",
	"copy_directory",
	"create_file",
	"delete_file",
	"edit_file",
	"import_project",
	"move_file",
	"write_file",
]);

export function classifyRunEffect(toolName: string, args: unknown): RunEffect {
	const normalized = stripToolPrefix(toolName);
	if (normalized === "todo_list") {
		const operation = readStringField(args, "operation");
		return operation === "list" ? "observation" : "workflow_mutation";
	}
	if (OBSERVATION_TOOLS.has(normalized)) return "observation";
	if (VERIFICATION_TOOLS.has(normalized)) return "verification";
	if (WORKSPACE_MUTATION_TOOLS.has(normalized)) return "workspace_mutation";
	return "unknown";
}

export function deriveWorkerDomainOutcome(
	result: WorkerToolResult<unknown>,
): DomainOutcome {
	if (result.ok)
		return isNoChangePayload(result.payload) ? "no_change" : "succeeded";
	const code = result.error?.code?.toUpperCase() ?? "";
	if (
		code.includes("BLOCK") ||
		code.includes("DISABLED") ||
		code.includes("NOT_ALLOWED") ||
		code.includes("NEEDS_HUMAN")
	) {
		return "blocked";
	}
	return "failed";
}

export function buildToolOutcomeEnvelope(input: {
	runId: string;
	invocationId: string;
	toolName: string;
	actionKey: string;
	invocationDigest: string;
	stateBefore: RunControlState;
	stateAfter: RunControlState;
	effect: RunEffect;
	transportStatus?: TransportStatus;
	domainOutcome: DomainOutcome;
	result: unknown;
	modelView: unknown;
	evidenceRefs?: string[];
	artifactRefs?: string[];
}): ToolOutcomeEnvelope {
	const transportStatus = input.transportStatus ?? "completed";
	return {
		version: 1,
		runId: input.runId,
		toolName: input.toolName,
		invocationId: input.invocationId,
		actionKey: input.actionKey,
		transportStatus,
		domainOutcome: input.domainOutcome,
		effect: input.effect,
		effectConfidence: input.effect === "unknown" ? "unknown" : "declared",
		progressRevisionBefore: input.stateBefore.progressRevision,
		progressRevisionAfter: input.stateAfter.progressRevision,
		invocationDigest: input.invocationDigest,
		resultDigest: digestJson(input.result),
		evidenceRefs: input.evidenceRefs ?? [],
		artifactRefs: input.artifactRefs ?? [],
		retryPolicy: retryPolicyFor({
			transportStatus,
			domainOutcome: input.domainOutcome,
			effect: input.effect,
		}),
		modelView: input.modelView,
	};
}

function retryPolicyFor(input: {
	transportStatus: TransportStatus;
	domainOutcome: DomainOutcome;
	effect: RunEffect;
}): ToolOutcomeEnvelope["retryPolicy"] {
	if (input.transportStatus === "failed") return "immediate";
	if (input.effect === "external_mutation") return "never";
	if (input.domainOutcome === "failed" || input.domainOutcome === "blocked")
		return "after_progress";
	return "immediate";
}

function stripToolPrefix(toolName: string) {
	return toolName.includes(".")
		? (toolName.split(".").pop() ?? toolName)
		: toolName;
}

function readStringField(value: unknown, key: string) {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const field = (value as Record<string, unknown>)[key];
	return typeof field === "string" ? field : null;
}

function isNoChangePayload(value: unknown) {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const record = value as Record<string, unknown>;
	return record.changed === false || record.hasChanges === false;
}
