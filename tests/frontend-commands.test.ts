import { afterEach, describe, expect, it, vi } from "vitest";
import {
	fetchBlueprintAdoption,
	fetchBlueprintDesignSettings,
	fetchBlueprintDesignTokenAdoption,
	generateBlueprintArtifact,
	saveBlueprintAdoption,
	saveBlueprintDesignSettings,
	saveBlueprintDesignTokenAdoption,
} from "../src/modules/blueprint/blueprintCommands";
import { generateDataModelArtifact } from "../src/modules/dataModel/dataModelCommands";
import {
	createAgentHook,
	deleteAgentHook,
	fetchAgentHooks,
	testAgentHook,
	updateAgentHook,
} from "../src/modules/hooks/hooksCommands";
import {
	createMcpServer,
	deleteMcpServer,
	fetchMcpServers,
	importMcpServers,
	testMcpServer,
	updateMcpServer,
} from "../src/modules/mcp/mcpCommands";
import { generatePlanViewArtifact } from "../src/modules/planMode/planViewCommands";
import {
	createProjectEvaluationTasks,
	fetchLatestProjectEvaluation,
	fetchProjectEvaluationActivityEvents,
	fetchProjectEvaluationDetail,
	fetchProjectEvaluationHistory,
	generateProjectImprovements,
	runProjectEvaluation,
	startProjectEvaluation,
} from "../src/modules/project-evaluation/api/projectEvaluationCommands";
import {
	fetchDesignQuestionnaireSession,
	fetchDesignQuestionnaireSessions,
	generateAdditionalDesignQuestionnaireQuestions,
	startDesignQuestionnaire,
	submitDesignQuestionnaireAnswers,
} from "../src/modules/questionnaire/questionnaireCommands";
import {
	archiveImplementationQueueEntry,
	cancelImplementationQueueEntry,
	createImplementationQueueEntry,
	fetchImplementationQueue,
	fetchImplementationQueueHealth,
	recoverImplementationQueueEntry,
	requeueImplementationQueueEntry,
	updateImplementationQueueEntry,
	updateImplementationQueueSettings,
} from "../src/modules/queue/queueCommands";
import {
	fetchPlanModeWorkspace,
	generateFeaturePlanArtifact,
} from "../src/modules/specification/specificationCommands";
import {
	fetchTodoWorkflowSettings,
	updateTodoWorkflowSettings,
} from "../src/modules/todo/todoCommands";

function stubFetch() {
	const fetchMock = vi.fn<typeof fetch>(() =>
		Promise.resolve(new Response("{}")),
	);
	vi.stubGlobal("fetch", fetchMock);
	return fetchMock;
}

describe("frontend command wrappers", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("routes blueprint commands to their task-scoped endpoints", async () => {
		const fetchMock = stubFetch();
		const init = { signal: AbortSignal.timeout(1000) };

		await generateBlueprintArtifact("task-1", { prompt: "Build a CRM" });
		await fetchBlueprintDesignSettings("task-1", init);
		await saveBlueprintDesignSettings("task-1", { accent: "blue" });
		await fetchBlueprintAdoption("task-1", "msg 1", init);
		await saveBlueprintAdoption("task-1", {
			messageId: "msg 1",
			adopted: true,
		});
		await fetchBlueprintDesignTokenAdoption("task-1", "msg 1", init);
		await saveBlueprintDesignTokenAdoption("task-1", {
			messageId: "msg 1",
			adopted: false,
		});

		expect(fetchMock).toHaveBeenNthCalledWith(
			1,
			"/api/tasks/task-1/plan-mode/blueprint",
			expect.objectContaining({ method: "POST" }),
		);
		expect(fetchMock).toHaveBeenNthCalledWith(
			2,
			"/api/tasks/task-1/blueprint-design-settings",
			init,
		);
		expect(fetchMock).toHaveBeenNthCalledWith(
			3,
			"/api/tasks/task-1/blueprint-design-settings",
			expect.objectContaining({ method: "PUT" }),
		);
		expect(fetchMock).toHaveBeenNthCalledWith(
			4,
			"/api/tasks/task-1/blueprint-adoption?messageId=msg%201",
			init,
		);
		expect(fetchMock).toHaveBeenNthCalledWith(
			5,
			"/api/tasks/task-1/blueprint-adoption",
			expect.objectContaining({ method: "PUT" }),
		);
		expect(fetchMock).toHaveBeenNthCalledWith(
			6,
			"/api/tasks/task-1/blueprint-design-token-adoption?messageId=msg%201",
			init,
		);
		expect(fetchMock).toHaveBeenNthCalledWith(
			7,
			"/api/tasks/task-1/blueprint-design-token-adoption",
			expect.objectContaining({ method: "PUT" }),
		);
	});

	it("routes implementation queue commands to queue endpoints", async () => {
		const fetchMock = stubFetch();

		await fetchImplementationQueue();
		await fetchImplementationQueueHealth();
		await createImplementationQueueEntry("task-2", {
			approveMissionProposal: true,
		});
		await archiveImplementationQueueEntry("entry-1");
		await cancelImplementationQueueEntry("entry-1");
		await updateImplementationQueueEntry("entry-1", { priority: 3 });
		await requeueImplementationQueueEntry("entry-1", { note: "retry" });
		await recoverImplementationQueueEntry("entry-1", {
			action: "mark_needs_human",
		});
		await updateImplementationQueueSettings({ processorCount: 2 });

		expect(fetchMock).toHaveBeenNthCalledWith(
			1,
			"/api/implementation-queue",
			undefined,
		);
		expect(fetchMock).toHaveBeenNthCalledWith(
			2,
			"/api/implementation-queue/health",
			undefined,
		);
		expect(fetchMock).toHaveBeenNthCalledWith(
			3,
			"/api/implementation-queue/entries",
			expect.objectContaining({ method: "POST" }),
		);
		expect(fetchMock).toHaveBeenNthCalledWith(
			4,
			"/api/implementation-queue/entries/entry-1/archive",
			{ method: "POST" },
		);
		expect(fetchMock).toHaveBeenNthCalledWith(
			5,
			"/api/implementation-queue/entries/entry-1",
			expect.objectContaining({ method: "PATCH" }),
		);
		expect(fetchMock).toHaveBeenNthCalledWith(
			6,
			"/api/implementation-queue/entries/entry-1",
			expect.objectContaining({ method: "PATCH" }),
		);
		expect(fetchMock).toHaveBeenNthCalledWith(
			7,
			"/api/implementation-queue/entries/entry-1/requeue",
			expect.objectContaining({ method: "POST" }),
		);
		expect(fetchMock).toHaveBeenNthCalledWith(
			8,
			"/api/implementation-queue/entries/entry-1/recover",
			expect.objectContaining({ method: "POST" }),
		);
		expect(fetchMock).toHaveBeenNthCalledWith(
			9,
			"/api/implementation-queue/settings",
			expect.objectContaining({ method: "PATCH" }),
		);
	});

	it("routes specification commands to plan-mode endpoints", async () => {
		const fetchMock = stubFetch();
		const init = { signal: AbortSignal.timeout(1000) };

		await fetchPlanModeWorkspace("task-3", init);
		await generateFeaturePlanArtifact("task-3", {
			prompt: "Write the import plan",
			proceedWithUnansweredBlocking: true,
		});

		expect(fetchMock).toHaveBeenNthCalledWith(
			1,
			"/api/tasks/task-3/plan-mode/workspace",
			init,
		);
		expect(fetchMock).toHaveBeenNthCalledWith(
			2,
			"/api/tasks/task-3/plan-mode/feature-plan",
			expect.objectContaining({ method: "POST" }),
		);
	});

	it("routes plan artifact and questionnaire commands", async () => {
		const fetchMock = stubFetch();
		const init = { signal: AbortSignal.timeout(1000) };

		await generateDataModelArtifact("task-4", {
			prompt: "model orders",
			sourceBlueprintMessageId: "blueprint-1",
		});
		await generatePlanViewArtifact("task-4", "api_io_contract", {
			featurePlanMessageId: "feature-1",
		});
		await fetchDesignQuestionnaireSessions("task-4", init);
		await fetchDesignQuestionnaireSession("task-4", "questionnaire-1", init);
		await startDesignQuestionnaire("task-4", {
			sourceBlueprintMessageId: "blueprint-1",
		});
		await generateAdditionalDesignQuestionnaireQuestions("task-4", {
			source: "user_requested",
			maxQuestions: 3,
		});
		await submitDesignQuestionnaireAnswers("task-4", "questionnaire-1", {
			answers: [{ id: "q1", answer: "dense" }],
		});

		expect(fetchMock).toHaveBeenNthCalledWith(
			1,
			"/api/tasks/task-4/plan-mode/data-model",
			expect.objectContaining({ method: "POST" }),
		);
		expect(fetchMock).toHaveBeenNthCalledWith(
			2,
			"/api/tasks/task-4/plan-mode/views/api_io_contract/generate",
			expect.objectContaining({ method: "POST" }),
		);
		expect(fetchMock).toHaveBeenNthCalledWith(
			3,
			"/api/tasks/task-4/design-questionnaire",
			init,
		);
		expect(fetchMock).toHaveBeenNthCalledWith(
			4,
			"/api/tasks/task-4/design-questionnaire/questionnaire-1",
			init,
		);
		expect(fetchMock).toHaveBeenNthCalledWith(
			7,
			"/api/tasks/task-4/design-questionnaire/questionnaire-1/answers",
			expect.objectContaining({ method: "POST" }),
		);
	});

	it("routes hook, MCP, todo, and project evaluation commands", async () => {
		const fetchMock = stubFetch();

		await fetchAgentHooks();
		await createAgentHook({
			name: "Format",
			event: "pre_tool_use",
			enabled: true,
			failClosed: false,
			timeoutSeconds: 30,
			matcher: "",
			handler: { type: "command", command: "bun", args: ["format"] },
		});
		await updateAgentHook("hook-1", { enabled: false });
		await deleteAgentHook("hook-1");
		await testAgentHook("hook-1");
		await fetchMcpServers();
		await createMcpServer({
			name: "Docs",
			transport: "stdio",
			enabled: true,
			command: "node",
			args: ["server.js"],
			env: {},
			toolPrefix: "docs",
		});
		await importMcpServers({ text: "{}", testAfterImport: true });
		await updateMcpServer("mcp-1", { enabled: false });
		await deleteMcpServer("mcp-1");
		await testMcpServer("mcp-1");
		await fetchTodoWorkflowSettings();
		await updateTodoWorkflowSettings({ workflowPanelEnabled: true });
		await fetchProjectEvaluationHistory("repo-1");
		await fetchLatestProjectEvaluation("repo-1");
		await fetchProjectEvaluationDetail("evaluation-1");
		await runProjectEvaluation("repo-1");
		await startProjectEvaluation("repo-1");
		await fetchProjectEvaluationActivityEvents("evaluation-1", 42);
		await generateProjectImprovements("evaluation-1", {
			instructions: "focus on tests",
		});
		await createProjectEvaluationTasks("evaluation-1", {
			improvementIds: ["idea-1"],
		});

		expect(fetchMock).toHaveBeenNthCalledWith(
			1,
			"/api/settings/hooks",
			undefined,
		);
		expect(fetchMock).toHaveBeenNthCalledWith(
			5,
			"/api/settings/hooks/hook-1/test",
			{ method: "POST" },
		);
		expect(fetchMock).toHaveBeenNthCalledWith(
			8,
			"/api/settings/mcp/servers/import",
			expect.objectContaining({ method: "POST" }),
		);
		expect(fetchMock).toHaveBeenNthCalledWith(
			13,
			"/api/todo-workflow/settings",
			expect.objectContaining({ method: "PATCH" }),
		);
		expect(fetchMock).toHaveBeenNthCalledWith(
			19,
			"/api/project-evaluations/evaluation-1/activity-events?afterSeq=42",
			undefined,
		);
		expect(fetchMock).toHaveBeenNthCalledWith(
			21,
			"/api/project-evaluations/evaluation-1/tasks",
			expect.objectContaining({ method: "POST" }),
		);
	});
});
