import { beforeEach, vi } from "vitest";
export const repoRoot = "/Users/y.noguchi/Code/nightWorkers";
export const implementationPhasePreamble = [
	"実装フェーズに移行しました。",
	"plan mode はこの時点で終了です。",
	"ここからは計画相談ではなく、実装・検証・必要な修正・closeout まで最後までやり切ってください。",
	"Todo を作成・更新する場合も、この実装フェーズ前提で進めてください。",
].join("\n");

vi.doMock("../../../api/modules/nightworkers/nightworkers.repository", () => ({
	getTask: vi.fn(),
	updateRepository: vi.fn(),
	countActiveTaskRuns: vi.fn(),
	claimNextQueuedTask: vi.fn(),
	listActiveTaskRunsForTask: vi.fn(),
	updateTaskStatus: vi.fn(),
	getRepository: vi.fn(),
	listTaskMessages: vi.fn(),
	createTaskRun: vi.fn(),
	getTaskRun: vi.fn(),
	createTaskRunTodo: vi.fn(),
	replaceTaskRunTodosForRun: vi.fn(),
	listTaskRunTodosForRun: vi.fn(),
	updateTaskRunTodo: vi.fn(),
	createRunEvent: vi.fn(),
	listTaskRunsForTask: vi.fn(),
	listTaskEventsForRun: vi.fn(),
	updateTaskCompiledPrompt: vi.fn(),
	updateTaskRun: vi.fn(),
	createTaskMessage: vi.fn(),
	getImplementationQueueEntryForRun: vi.fn(),
	updateImplementationQueueEntry: vi.fn(),
	refreshImplementationQueueLeaseForRun: vi.fn(),
	createTaskRunCommitRecord: vi.fn(),
	getTaskRunCommitRecord: vi.fn(),
}));

vi.doMock("../../../api/routes/settings", () => ({
	getCurrentSettings: vi.fn(() => {
		const activeProvider = process.env.ACTIVE_LLM_PROVIDER || "azure";
		const codexEnabled = process.env.CODEX_ENABLED === "true";
		return {
			ACTIVE_LLM_PROVIDER:
				activeProvider === "codex" ? "azure" : activeProvider,
			CODEX_ENABLED: codexEnabled,
			IMPLEMENTATION_RUNTIME_LANE:
				process.env.IMPLEMENTATION_RUNTIME_LANE || "",
		};
	}),
}));

vi.doMock("../../../api/services/agent-runtime/registry", () => {
	const resolveAgentRuntime = vi.fn();
	const buildRuntimeLaneInitialTodos = vi.fn((lane: string) =>
		lane === "codex-sdk"
			? [
					{ title: "対象変更を確認して実装する", taskType: "implementation" },
					{
						title: "必要最小限の動作確認を行う",
						taskType: "focused_verification",
					},
				]
			: [
					{ title: "仕様と既存構成を確認する", taskType: "inspection" },
					{
						title: "対象画面の実装準備を行う",
						taskType: "scaffold",
						dependsOn: [1],
					},
					{
						title: "対象画面を仕様に沿って実装する",
						taskType: "implementation",
						dependsOn: [2],
					},
					{
						title: "受け入れ条件を検証する",
						taskType: "verification",
						dependsOn: [3],
					},
				],
	);
	return {
		buildRuntimeLaneInitialTodos,
		resolveAgentRuntime,
		resolveRuntimeLaneDefinition: vi.fn(
			(lane: "native-api-runner" | "codex-sdk") => ({
				kind: lane,
				aliases: [],
				buildInitialTodos: (input: { compiledPromptText: string }) =>
					buildRuntimeLaneInitialTodos(lane, input),
				buildRuntimeOptions: (input: {
					runtimeLaneResolution?: unknown;
					executionMode?: string;
				}) => ({
					executionMode: input.executionMode ?? "implementation",
					runtimeLane: lane,
					runtimeLaneResolution: input.runtimeLaneResolution ?? null,
				}),
				createAdapter: () =>
					resolveAgentRuntime(
						lane === "codex-sdk" ? "codex-agent" : "native-local",
					),
			}),
		),
	};
});

vi.doMock("../../../api/services/conversation-context", () => ({
	buildPromptWithStateCard: vi.fn(
		(input: { latestUserMessage: string; stateCardText?: string | null }) => {
			const request = input.latestUserMessage.trim();
			const card = input.stateCardText?.trim();
			return card
				? `<USER_REQUEST>\n${request}\n</USER_REQUEST>\n\n${card}`
				: request;
		},
	),
	buildPromptWithStateCardParts: vi.fn(
		(input: { latestUserMessage: string; stateCardText?: string | null }) => {
			const request = input.latestUserMessage.trim();
			const card = input.stateCardText?.trim();
			const promptText = card
				? `<USER_REQUEST>\n${request}\n</USER_REQUEST>\n\n${card}`
				: request;
			return {
				latestUserMessage: request,
				stateCardText: card || null,
				promptText,
				estimates: {
					latestUserMessageTokens: Math.ceil(request.length / 4),
					stateCardTokens: card ? Math.ceil(card.length / 4) : 0,
					promptTokens: Math.ceil(promptText.length / 4),
				},
			};
		},
	),
	getLatestConversationContextForTask: vi.fn(),
	refreshConversationContextSnapshot: vi.fn(),
}));

beforeEach(() => {
	vi.clearAllMocks();
	delete process.env.ACTIVE_LLM_PROVIDER;
	delete process.env.CODEX_ENABLED;
	delete process.env.IMPLEMENTATION_RUNTIME_LANE;
	process.env.NIGHTWORKERS_LLM_SETTINGS_PATH =
		"/tmp/nightworkers-service-02-empty-llm-settings.json";
	process.env.NIGHTWORKERS_RUNTIME_LANE = "native-api-runner";
});
