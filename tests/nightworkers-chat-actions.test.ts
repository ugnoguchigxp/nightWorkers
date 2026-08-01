import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createNightWorkersChatActions } from "../src/modules/nightworkers/hooks/nightWorkersChatActions";
import { appendWorkbenchMessage } from "../src/modules/nightworkers/nightWorkersCommands";

vi.mock("../src/modules/nightworkers/nightWorkersCommands", () => ({
	appendWorkbenchMessage: vi.fn(),
}));

describe("createNightWorkersChatActions", () => {
	afterEach(() => {
		vi.clearAllMocks();
	});

	it("aborts the pending workbench intake request when chat submit is cancelled", async () => {
		const setIsChatSubmitting = vi.fn();
		const setPendingChatRunId = vi.fn();
		const setPendingAssistantTaskId = vi.fn();
		let observedSignal: AbortSignal | undefined;

		vi.mocked(appendWorkbenchMessage).mockImplementation(
			(_sessionId, _input, init) =>
				new Promise<Response>((_resolve, reject) => {
					observedSignal = init?.signal;
					init?.signal?.addEventListener("abort", () => {
						reject(
							init.signal?.reason ?? new DOMException("Aborted", "AbortError"),
						);
					});
				}),
		);

		const actions = createNightWorkersChatActions({
			queryClient: new QueryClient(),
			lastSubmitRef: { current: null },
			chatSubmitStartedAtRef: { current: null },
			pendingChatRunIdRef: { current: null },
			pendingAssistantTaskIdRef: { current: null },
			pendingChatAbortControllerRef: { current: null },
			setIsChatSubmitting,
			setPendingChatRunId,
			setPendingAssistantTaskId,
		});

		const sendPromise = actions.sendWorkbenchMessage(
			"task-1",
			"Plan this",
			"intake",
		);
		await Promise.resolve();

		expect(observedSignal?.aborted).toBe(false);
		await actions.cancelChatSubmit();

		expect(observedSignal?.aborted).toBe(true);
		await expect(sendPromise).rejects.toMatchObject({ name: "AbortError" });
		expect(setIsChatSubmitting).toHaveBeenLastCalledWith(false);
		expect(setPendingChatRunId).toHaveBeenLastCalledWith(null);
		expect(setPendingAssistantTaskId).toHaveBeenLastCalledWith(null);
	});

	it("stores returned Plan Mode workspace data in the query cache after regeneration", async () => {
		const queryClient = new QueryClient();
		const setIsChatSubmitting = vi.fn();
		const setPendingChatRunId = vi.fn();
		const setPendingAssistantTaskId = vi.fn();
		const workspace = {
			taskId: "task-1",
			repositoryId: "repo-1",
			generatedAt: new Date().toISOString(),
			featurePlanArtifacts: [],
			blueprintArtifacts: [
				{
					id: "artifact-blueprint-1",
					kind: "blueprint",
					title: "Blueprint",
					sourceMessageId: "message-blueprint-1",
					createdAt: new Date().toISOString(),
				},
			],
			dataModelArtifacts: [],
			dedicatedViewArtifacts: [],
			questionnaireSessions: [],
			decisionReviews: [],
			implementationReferences: [],
		};
		vi.mocked(appendWorkbenchMessage).mockResolvedValueOnce(
			new Response(
				JSON.stringify({
					task: { id: "task-1", title: "Task", status: "ready" },
					run: null,
					messages: [
						{
							id: "message-user-1",
							taskId: "task-1",
							role: "user",
							content: "Blueprintを絞って",
							messageType: "text",
							createdAt: new Date().toISOString(),
						},
						{
							id: "message-blueprint-1",
							taskId: "task-1",
							role: "assistant",
							content: "# Blueprint",
							messageType: "markdown_document",
							createdAt: new Date().toISOString(),
						},
					],
					workspace,
				}),
				{ status: 200 },
			),
		);

		const actions = createNightWorkersChatActions({
			queryClient,
			lastSubmitRef: { current: null },
			chatSubmitStartedAtRef: { current: null },
			pendingChatRunIdRef: { current: null },
			pendingAssistantTaskIdRef: { current: null },
			pendingChatAbortControllerRef: { current: null },
			setIsChatSubmitting,
			setPendingChatRunId,
			setPendingAssistantTaskId,
		});

		await actions.sendWorkbenchMessage(
			"task-1",
			"Blueprintを絞って",
			"intake",
			{
				artifactId: "plan-mode-workspace-task-1:blueprint",
				kind: "plan_mode_workspace",
				title: "Blueprint",
				source: { type: "task_message", messageId: "message-blueprint-1" },
				metadata: {
					instructionMode: "regenerate_artifact",
					planModeTarget: "blueprint",
					displayKind: "PLAN_MODE:BLUEPRINT",
				},
			},
		);
		expect(appendWorkbenchMessage).toHaveBeenCalledWith(
			"task-1",
			expect.objectContaining({ waitForIntake: false }),
			expect.objectContaining({ signal: expect.any(AbortSignal) }),
		);

		expect(queryClient.getQueryData(["planModeWorkspace", "task-1"])).toEqual(
			workspace,
		);
		expect(setIsChatSubmitting).toHaveBeenLastCalledWith(false);
		expect(setPendingAssistantTaskId).toHaveBeenLastCalledWith(null);
	});
});
