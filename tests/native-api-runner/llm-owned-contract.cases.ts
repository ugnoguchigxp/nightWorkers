import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createRepository,
	createTask,
	createTaskRun,
	deleteRepository,
} from "../../api/modules/nightworkers/nightworkers.repository";
import { compactNativeApiHistoryToBaseline } from "../../api/services/agent-runtime/native-api-runner/native-api-context-compaction";
import { dispatchNativeApiToolCall } from "../../api/services/agent-runtime/native-api-runner/native-api-tool-dispatcher";
import { buildInitialNativeApiHistory } from "../../api/services/agent-runtime/native-api-runner/native-api-tool-history";
import { getNativeApiToolDefinitions } from "../../api/services/agent-runtime/native-api-runner/native-api-tool-registry";
import type { AgentRunContext } from "../../api/services/agent-runtime/types";
import { buildCodingAgentSystemContext } from "../../api/services/coding-agent-context";

const repositoryIds: string[] = [];

afterEach(async () => {
	for (const id of repositoryIds.splice(0)) await deleteRepository(id);
});

function context(overrides: Partial<AgentRunContext> = {}): AgentRunContext {
	const systemContext = buildCodingAgentSystemContext({
		taskGoal: "単一Coding Agentとして実装する。",
		registeredRepositoryRoot: "/tmp/native-llm-owned",
	});
	return {
		runId: "run-native-contract",
		taskId: "task-native-contract",
		repositoryId: "repo-native-contract",
		repoRoot: "/tmp/native-llm-owned",
		compiledPrompt: systemContext.taskGoal,
		latestUserMessage: systemContext.taskGoal,
		timeoutSeconds: 30,
		contextSnapshot: {
			compiledPrompt: systemContext.taskGoal,
			source: "task_prompt",
		},
		codingAgentSystemContext: systemContext,
		...overrides,
	};
}

describe("Native API LLM-owned Todo contract", () => {
	it("publishes one capability-based catalog independent of legacy mode and Todo metadata", () => {
		const base = getNativeApiToolDefinitions().map((tool) => tool.name);
		const legacyInputs = getNativeApiToolDefinitions({
			ontologyMcpEnabled: false,
		}).map((tool) => tool.name);
		expect(legacyInputs).toEqual(base);
		expect(base).toContain("todo_list");
		expect(base).toContain("apply_patch");
		expect(base).not.toContain("finalize_answer");
		expect(base).not.toContain("new_context");
		expect(base).not.toContain("reviewer_evaluation");
	});

	it("injects the versioned Japanese system context", () => {
		const history = buildInitialNativeApiHistory(context());
		const system = history.find((item) => item.type === "system");
		expect(system?.content).toContain("NightWorkers Coding Agent Runtime");
		expect(system?.content).toContain("current Todo");
		expect(system?.content).toContain("単一Coding Agentとして実装する");
		expect(system?.content).not.toContain("executionMode:");
	});

	it("keeps a conversation summary and Todo context during compaction", () => {
		const result = compactNativeApiHistoryToBaseline({
			baselineHistory: [{ type: "system", content: "system" }],
			previousHistory: [
				{ type: "user", source: "user", content: "request" },
				{ type: "assistant", content: "investigated" },
			],
			reason: "budget",
			todoSnapshotItem: {
				type: "user",
				source: "todo",
				content: "planRevision=2",
			},
			currentTodoItem: {
				type: "user",
				source: "todo",
				content: "nextAction=verify",
			},
		});
		expect(
			result.history.some(
				(item) =>
					item.type === "user" && item.content.includes("Conversation Summary"),
			),
		).toBe(true);
		expect(
			result.history.some(
				(item) => item.type === "user" && item.content === "planRevision=2",
			),
		).toBe(true);
		expect(
			result.history.some(
				(item) => item.type === "user" && item.content === "nextAction=verify",
			),
		).toBe(true);
	});

	it("rejects workspace tools until a current Todo exists", async () => {
		const repository = await createRepository({
			name: `native-contract-${crypto.randomUUID()}`,
			localPath: "/tmp/native-llm-owned",
			branch: "main",
			allowed: true,
		});
		repositoryIds.push(repository.id);
		const task = await createTask({
			repositoryId: repository.id,
			title: "Native contract",
			status: "running",
		});
		const run = await createTaskRun({
			taskId: task.id,
			repositoryId: repository.id,
			status: "running",
		});
		const sink = { emit: vi.fn(async () => {}) };
		const result = await dispatchNativeApiToolCall({
			toolCall: {
				id: "call-read",
				name: "read_file",
				arguments: { filePath: "README.md" },
			},
			context: context({
				runId: run.id,
				taskId: task.id,
				repositoryId: repository.id,
			}),
			sink,
			state: { readFiles: [], postImport: null },
		});
		expect(result.toolResult).toMatchObject({
			ok: false,
			error: { code: "CURRENT_TODO_REQUIRED" },
		});
		expect(sink.emit).not.toHaveBeenCalled();
	});
});
