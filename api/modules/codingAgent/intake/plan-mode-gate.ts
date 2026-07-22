import { z } from "zod";
import type { TraceProvenance } from "../../../../shared/schemas/trace-provenance.schema";
import { RuntimeSessionStateStore } from "../../../services/runtime-session-state";
import { callStructuredOutputWithRepair } from "../../../services/structured-generation/structured-output-repair.service";
import {
	createStructuredOutputContract,
	type SupervisorLlmDebugEvent,
} from "../../../services/structured-llm";
import { resolveCodexAuthScopeFingerprint } from "../../../services/structured-llm/codex-auth-scope";
import type { normalizeStructuredLlmModelTarget } from "../../../services/structured-llm/selection";
import type { StructuredLlmRole } from "../../../services/structured-llm/settings";
import { digestText } from "../../../services/text-digest";
import { p } from "../../../systemContexts/catalog";

const INTAKE_GATE_RUNTIME_LANE = "codex-sdk-intake";
const INTAKE_GATE_EXECUTION_MODE = "plan_mode_gate";

const codingAgentPlanModeGateSchema = z
	.object({
		shouldStartPlanMode: z.boolean(),
		action: z.enum(["plan_mode", "coding_agent"]),
		reason: z.string().min(1),
	})
	.strict()
	.superRefine((value, context) => {
		if (value.shouldStartPlanMode === (value.action === "plan_mode")) return;
		context.addIssue({
			code: "custom",
			path: ["action"],
			message:
				"shouldStartPlanMode and action must describe the same decision.",
		});
	});

export type CodingAgentPlanModeRuntimeThreadHandoff = {
	kind: "codex_thread";
	provider: "codex";
	providerThreadId: string;
	providerEndpointId: string | null;
	model: string | null;
	authScopeFingerprint: string;
	stateId?: string | null;
	source: "plan_mode_gate";
};

export type CodingAgentPlanModeGate = z.infer<
	typeof codingAgentPlanModeGateSchema
> & {
	runtimeThreadHandoff?: CodingAgentPlanModeRuntimeThreadHandoff;
};

export type CodingAgentPlanModeGateTask = {
	status: string;
	title: string;
	objective?: string | null;
	description?: string | null;
	acceptanceCriteria?: string | null;
	createdBy?: string | null;
};

export type CodingAgentPlanModeGateMessage = {
	role: string;
	content: string;
	metadataJson?: unknown;
};

export type CodingAgentPlanModeGateRun = {
	status: string;
	summary?: string | null;
	contextSnapshot?: unknown;
};

export async function decideCodingAgentPlanModeGate(input: {
	projectRoot: string;
	prompt: string;
	task: CodingAgentPlanModeGateTask;
	messages: CodingAgentPlanModeGateMessage[];
	runs: CodingAgentPlanModeGateRun[];
	routeOverride: ReturnType<typeof normalizeStructuredLlmModelTarget> | null;
	emitEvent: (event: SupervisorLlmDebugEvent) => void | Promise<void>;
	taskId: string;
	repositoryId: string;
	role?: StructuredLlmRole;
	usageTrace?: TraceProvenance;
}): Promise<CodingAgentPlanModeGate> {
	let runtimeThreadHandoff: CodingAgentPlanModeRuntimeThreadHandoff | null =
		null;
	const generated = await callStructuredOutputWithRepair({
		systemPrompt: buildCodingAgentPlanModeGatePrompt(input.projectRoot),
		userPrompt: buildCodingAgentPlanModeGateUserPrompt(input),
		options: {
			contract: createStructuredOutputContract({
				name: "workbench_plan_mode_gate",
				runtimeSchema: codingAgentPlanModeGateSchema,
			}),
			role: input.role ?? "evaluation",
			usageTrace: input.usageTrace,
			routeOverride: input.routeOverride,
			tolerateSchemaFailure: false,
			emitEvent: async (event) => {
				runtimeThreadHandoff = updateCodingAgentPlanModeRuntimeThreadHandoff(
					runtimeThreadHandoff,
					event,
				);
				await input.emitEvent(event);
			},
			workingDirectory: input.projectRoot,
			taskId: input.taskId,
			runId: null,
		},
	});
	const result = {
		...generated.value,
		...(runtimeThreadHandoff ? { runtimeThreadHandoff } : {}),
	};
	return runtimeThreadHandoff
		? persistCodingAgentPlanModeGateResult({
				taskId: input.taskId,
				repositoryId: input.repositoryId,
				prompt: input.prompt,
				result,
			})
		: result;
}

export function updateCodingAgentPlanModeRuntimeThreadHandoff(
	current: CodingAgentPlanModeRuntimeThreadHandoff | null,
	event: SupervisorLlmDebugEvent,
) {
	return readCodingAgentPlanModeRuntimeThreadHandoff(event) ?? current;
}

export function readCodingAgentPlanModeRuntimeThreadHandoff(
	event: SupervisorLlmDebugEvent,
	options: {
		resolveAuthScopeFingerprint?: (providerEndpointId: string | null) => string;
	} = {},
): CodingAgentPlanModeRuntimeThreadHandoff | null {
	if (event.type !== "model.response_finished") return null;
	const providerDebug = toRecord(toRecord(event.data)?.providerDebug);
	if (providerDebug?.provider !== "codex") return null;
	if (providerDebug.isolatedCodexHome !== false) return null;
	const providerThreadId = readNonEmptyString(providerDebug.providerThreadId);
	if (!providerThreadId) return null;
	const providerEndpointId = readNonEmptyString(
		providerDebug.providerEndpointId,
	);
	return {
		kind: "codex_thread",
		provider: "codex",
		providerThreadId,
		providerEndpointId,
		model: readNonEmptyString(providerDebug.model),
		authScopeFingerprint: (
			options.resolveAuthScopeFingerprint ?? resolveCodexAuthScopeFingerprint
		)(providerEndpointId),
		source: "plan_mode_gate",
	};
}

export async function loadPersistedCodingAgentPlanModeGateResult(input: {
	taskId: string;
	repositoryId: string;
	prompt: string;
	store?: RuntimeSessionStateStore;
}): Promise<CodingAgentPlanModeGate | null> {
	const store = input.store ?? new RuntimeSessionStateStore();
	const state = await store.getLatestRuntimeSessionStateForTask({
		taskId: input.taskId,
		agentModeSessionId: null,
		repositoryId: input.repositoryId,
		runtimeLane: INTAKE_GATE_RUNTIME_LANE,
		provider: "codex",
		executionMode: INTAKE_GATE_EXECUTION_MODE,
	});
	if (!state?.providerSessionId) return null;
	const metadata = toRecord(state.metadataJson);
	if (metadata?.promptDigest !== digestText(input.prompt)) return null;
	if (metadata?.handoffResumable !== true) return null;
	const decision = codingAgentPlanModeGateSchema.safeParse(metadata.decision);
	const providerEndpointId = readNonEmptyString(metadata.providerEndpointId);
	const authScopeFingerprint = readNonEmptyString(
		metadata.authScopeFingerprint,
	);
	if (!decision.success || !authScopeFingerprint) return null;
	return {
		...decision.data,
		runtimeThreadHandoff: {
			kind: "codex_thread",
			provider: "codex",
			providerThreadId: state.providerSessionId,
			providerEndpointId,
			model: state.model,
			authScopeFingerprint,
			stateId: state.id,
			source: "plan_mode_gate",
		},
	};
}

async function persistCodingAgentPlanModeGateResult(input: {
	taskId: string;
	repositoryId: string;
	prompt: string;
	result: CodingAgentPlanModeGate;
	store?: RuntimeSessionStateStore;
}): Promise<CodingAgentPlanModeGate> {
	const handoff = input.result.runtimeThreadHandoff;
	if (!handoff) return input.result;
	const store = input.store ?? new RuntimeSessionStateStore();
	const state = await store.upsertRuntimeSessionState({
		taskId: input.taskId,
		agentModeSessionId: null,
		repositoryId: input.repositoryId,
		runtimeLane: INTAKE_GATE_RUNTIME_LANE,
		provider: "codex",
		providerSessionId: handoff.providerThreadId,
		executionMode: INTAKE_GATE_EXECUTION_MODE,
		model: handoff.model,
		metadata: {
			version: 2,
			handoffResumable: true,
			promptDigest: digestText(input.prompt),
			decision: {
				shouldStartPlanMode: input.result.shouldStartPlanMode,
				action: input.result.action,
				reason: input.result.reason,
			},
			providerEndpointId: handoff.providerEndpointId,
			authScopeFingerprint: handoff.authScopeFingerprint,
		},
	});
	return {
		...input.result,
		runtimeThreadHandoff: { ...handoff, stateId: state.id },
	};
}

export function buildCodingAgentPlanModeGatePrompt(projectRoot: string) {
	return p("codingAgent.plan-mode-gate", {
		projectRoot,
	});
}

export function buildCodingAgentPlanModeGateUserPrompt(input: {
	prompt: string;
	task: CodingAgentPlanModeGateTask;
	messages: CodingAgentPlanModeGateMessage[];
	runs: CodingAgentPlanModeGateRun[];
}) {
	const existingPlans = input.messages
		.filter((message) => {
			const intent = toRecord(message.metadataJson)?.intent;
			return intent === "implementation_plan" || intent === "feature_plan";
		})
		.slice(-3)
		.map((message) => {
			const intent = String(toRecord(message.metadataJson)?.intent ?? "plan");
			return `- intent=${intent}: ${compactForGatePrompt(message.content, 300)}`;
		});
	const recentMessages = input.messages.slice(-6).map((message) => {
		const metadata = toRecord(message.metadataJson);
		const intent =
			typeof metadata?.intent === "string" ? ` intent=${metadata.intent}` : "";
		return `- ${message.role}${intent}: ${compactForGatePrompt(message.content, 360)}`;
	});
	const latestRuns = input.runs.slice(0, 3).map((run) => {
		const context = toRecord(run.contextSnapshot);
		const planModeRequested = context?.planModeRequested === true;
		return [
			`- status=${run.status}`,
			planModeRequested ? "planModeRequested=true" : null,
			run.summary ? `summary=${compactForGatePrompt(run.summary, 180)}` : null,
		]
			.filter((value): value is string => Boolean(value))
			.join(" ");
	});

	return [
		"[Task Context]",
		`Task status: ${input.task.status}`,
		`Task title: ${compactForGatePrompt(input.task.title, 180)}`,
		input.task.objective
			? `Task objective: ${compactForGatePrompt(input.task.objective, 240)}`
			: null,
		input.task.description
			? `Task description: ${compactForGatePrompt(input.task.description, 240)}`
			: null,
		input.task.acceptanceCriteria
			? `Task acceptance criteria: ${compactForGatePrompt(input.task.acceptanceCriteria, 240)}`
			: null,
		input.task.createdBy ? `Task created by: ${input.task.createdBy}` : null,
		"",
		"[Existing Plan Evidence]",
		existingPlans.length ? existingPlans.join("\n") : "- none",
		"",
		"[Latest Runs]",
		latestRuns.length ? latestRuns.join("\n") : "- none",
		"",
		"[Recent Conversation]",
		recentMessages.length ? recentMessages.join("\n") : "- none",
		"",
		"[Current User Message]",
		input.prompt,
	]
		.filter((line): line is string => line !== null)
		.join("\n");
}

function compactForGatePrompt(value: string, maxLength: number) {
	const compacted = value.replace(/\s+/g, " ").trim();
	if (compacted.length <= maxLength) return compacted;
	return `${compacted.slice(0, maxLength - 1)}…`;
}

function toRecord(value: unknown) {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function readNonEmptyString(value: unknown) {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}
