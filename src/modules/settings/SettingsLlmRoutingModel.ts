import type {
	CodexSdkStatus,
	LlmModelTarget,
	LlmProviderEndpoint,
	LlmRole,
	ModelOption,
	ThinkingDepth,
} from "../nightworkers/types";

export const roleLabelKeys: Record<LlmRole, string> = {
	plan: "settings.llm.role.plan",
	evaluation: "settings.llm.role.evaluation",
	implementation: "settings.llm.role.implementation",
	test: "settings.llm.role.test",
	review: "settings.llm.role.review",
	mission_pilot: "settings.llm.role.missionPilot",
	mission_task_generation: "settings.llm.role.missionTaskGeneration",
};

export const emptyModelTarget: LlmModelTarget = {
	providerEndpointId: "",
	model: "",
};

export const thinkingDepthValues: Array<"" | ThinkingDepth> = [
	"",
	"low",
	"medium",
	"high",
	"very_high",
];

export function modelTargetKey(target: LlmModelTarget) {
	return JSON.stringify({
		providerEndpointId: target.providerEndpointId,
		model: target.model,
	});
}

export function modelTargetFromKey(value: string): LlmModelTarget {
	try {
		const parsed = JSON.parse(value) as Partial<LlmModelTarget>;
		if (
			typeof parsed.providerEndpointId === "string" &&
			typeof parsed.model === "string"
		) {
			return {
				providerEndpointId: parsed.providerEndpointId,
				model: parsed.model,
			};
		}
	} catch {
		// Invalid select values fall through to an empty target.
	}
	return emptyModelTarget;
}

export function uniqueModelOptions(options: ModelOption[]) {
	const seen = new Set<string>();
	return options.filter((option) => {
		if (!option.value || seen.has(option.value)) return false;
		seen.add(option.value);
		return true;
	});
}

export function formatModelTargetLabel(
	endpoint: LlmProviderEndpoint,
	model: string,
	codexModelOptions: ModelOption[],
) {
	if (endpoint.kind === "codex") {
		const codexLabel =
			codexModelOptions.find((option) => option.value === model)?.label ||
			model;
		return `${codexLabel} (Codex SDK)`;
	}
	return (
		endpoint.modelDisplayNames?.[model]?.trim() ||
		`${model} (${endpoint.name} / ${endpoint.kind})`
	);
}

export function codexAuthSourceKey(status: CodexSdkStatus | null) {
	if (!status) return "settings.llm.codex.auth.unchecked";
	if (status.authSource === "settings-token")
		return "settings.llm.codex.auth.settingsToken";
	if (status.authSource === "environment-token")
		return "settings.llm.codex.auth.environmentToken";
	if (status.authSource === "codex-auth-json")
		return "settings.llm.codex.auth.login";
	return "settings.llm.codex.auth.notLoggedIn";
}

export function isThinkingModel(model: string) {
	const normalized = model.toLowerCase();
	return (
		/^gpt-5(\b|[.-])/.test(normalized) ||
		/^o[134](\b|[.-])/.test(normalized) ||
		normalized.includes("codex") ||
		normalized.includes("reasoning") ||
		normalized.includes("thinking") ||
		normalized.includes("deepseek-r1") ||
		normalized.includes("qwen3")
	);
}

export function withThinkingDepth(
	target: LlmModelTarget,
	thinkingDepth: string,
): LlmModelTarget {
	return {
		...target,
		thinkingDepth: isThinkingModel(target.model)
			? (thinkingDepth as ThinkingDepth | "")
			: "",
	};
}
