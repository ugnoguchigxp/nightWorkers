export const CODING_AGENT_IMPLEMENTATION_HANDOFF_INSTRUCTIONS_JA = [
	"以下の IMPLEMENTATION_HANDOFF は、確定済みの実装計画です。",
	"確定済みの技術選定、実装範囲、受け入れ条件を、補助資料や既定構成より優先してください。",
	"未達項目や失敗した必須検証が残る場合は、解決可能な限り調査・実装・検証を続けてください。解決できない場合は完了を表明せず、残件と理由を具体的に報告してください。",
].join("\n");

export function buildCodingAgentImplementationHandoffPrompt(input: {
	userRequest?: string | null;
	implementationHandoff?: string | null;
	omitDuplicatedUserRequest?: boolean;
}) {
	const userRequest = input.userRequest?.trim() ?? "";
	const handoff = input.implementationHandoff?.trim() ?? "";
	if (!handoff) return userRequest;

	const includeUserRequest =
		Boolean(userRequest) &&
		(!input.omitDuplicatedUserRequest || userRequest !== handoff);
	return [
		...(includeUserRequest
			? ["<USER_REQUEST>", userRequest, "</USER_REQUEST>", ""]
			: []),
		"<IMPLEMENTATION_HANDOFF>",
		CODING_AGENT_IMPLEMENTATION_HANDOFF_INSTRUCTIONS_JA,
		"",
		"<ADOPTED_PLAN>",
		handoff,
		"</ADOPTED_PLAN>",
		"</IMPLEMENTATION_HANDOFF>",
	].join("\n");
}

export function buildCodingAgentImplementationHandoffSnapshot(input: {
	sourceMessageId: string;
	userRequest: string;
	adoptedPlan: string;
	designArtifacts: Array<{
		kind: string;
		sourceMessageId: string;
		content: string;
	}>;
}) {
	return {
		version: 1 as const,
		sourceMessageId: input.sourceMessageId,
		instructions: CODING_AGENT_IMPLEMENTATION_HANDOFF_INSTRUCTIONS_JA,
		userRequest: input.userRequest,
		adoptedPlan: input.adoptedPlan,
		designArtifacts: input.designArtifacts,
	};
}

export function buildCodexRuntimePromptSnapshot(input: {
	runtimeLane: string;
	request: string;
	stateCardText?: string | null;
}) {
	return input.runtimeLane === "codex-sdk"
		? {
				request: input.request,
				stateCardText: input.stateCardText?.trim() || null,
			}
		: undefined;
}
