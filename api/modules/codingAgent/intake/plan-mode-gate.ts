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
			version: 1,
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
	return [
		"ユーザー直結のCoding Agentを開始する前に、Plan Modeを先に1回実行すべきか判断してください。",
		"これは作業種別の分類ではありません。同じCoding Agent runtimeを直ちに開始できるか、repositoryを変更する前に実装計画を確定すべきかの2択です。",
		"Current User Messageだけでなく、Task Context、Recent Conversation、Latest Runsを一つの依頼履歴として読み、現在の依頼に対して判断してください。",
		"Current User Messageは現在の依頼範囲を示す最新の正本です。Current User Messageが過去のTask Contextや会話より対象を縮小・単純化している場合、矛盾する過去の広い計画指示を優先してPlan Modeを選ばないでください。過去の情報は、現在の依頼と矛盾しない制約や既に確定した判断の補助として使ってください。",
		"ユーザーが実装前の計画作成を求めている場合はPlan Modeを選んでください。また、実装依頼であっても、目的・対象範囲・非対象・責務境界・互換性・移行・データ・権限・失敗時の扱い・受け入れ条件・検証方針などに、実装開始前に整合させるべき重要な判断が残る場合はPlan Modeを選んでください。",
		"複数の実現方法があり、その選択が公開契約、既存利用者、データ、運用、ロールバック、または完了条件を実質的に変える場合もPlan Modeを選べます。reasonには、先に確定すべき具体的な判断を記載してください。",
		"依頼文に『修正』『実装』『リファクタ』『調査』『テスト』『レビュー』等が含まれることを理由にPlan Modeを除外しないでください。反対に、『大規模』『複雑』等の表現、想定ファイル数、作業量だけを理由にPlan Modeを選ばないでください。keywordや固定の規模閾値ではなく、提示されたcontextの意味から判断してください。",
		"対象、期待動作、重要な制約、完了条件が実装を安全に開始できる程度に確定している場合はaction=coding_agentにしてください。Coding Agentは同じrun内でTodo作成、repository調査、編集、command実行、検証、回答を行えます。通常のrepository調査で解消できる未知だけなら、Plan Modeを挟む必要はありません。",
		"現在の依頼が最小構成や限定的な変更を求めており、repositoryの既存規約や既定値に沿った可逆的な実装で満たせる場合はaction=coding_agentにしてください。UIの細部、任意機能の追加範囲、一般的な保存方法などを完全なプロダクト仕様として先に確定できるという理由だけでPlan Modeを選ばないでください。",
		"不確実さが重要な設計判断に関するもので、計画を先に作ることで実装の手戻りや契約破壊を避けられるならPlan Modeを選んでください。単なる情報不足で現在の依頼が質問・説明・状態確認に留まる場合も、Coding Agentがそのまま回答できます。",
		"既存のimplementation_planまたはfeature_planが現在の依頼を十分に覆う場合は再利用し、Plan Modeを再起動しないでください。ただし、対象範囲や前提が実質的に変わり、既存計画が適用できない場合は新しいPlan Modeを選べます。",
		"このgateはPlan Modeへ入るかだけを判断します。Questionnaire、Blueprint、Data Model、Dedicated Viewの必要性やArtifact routingは判断せず、出力にも含めないでください。",
		"shouldStartPlanMode=trueならaction=plan_mode、falseならaction=coding_agentにしてください。reasonは依頼文の言い換えではなく、この依頼を今すぐ安全に開始できるかの根拠を短く示してください。",
		"JSONのみを返してください。",
		"",
		`プロジェクトルート: ${projectRoot}`,
		"",
		"[Output Schema]",
		'{ "shouldStartPlanMode": boolean, "action": "plan_mode" | "coding_agent", "reason": "short concrete reason" }',
	].join("\n");
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
