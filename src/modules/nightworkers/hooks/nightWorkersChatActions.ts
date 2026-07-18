import type { QueryClient } from "@tanstack/react-query";
import type { MutableRefObject } from "react";
import type { PromptImageInput } from "../../../../shared/prompt-image";
import { mergeTaskPreservingMissionPilot } from "../../missionPilot";
import { appendWorkbenchMessage } from "../nightWorkersCommands";
import type {
	Task,
	TaskMessage,
	TaskRun,
	WorkbenchArtifactContext,
	WorkbenchChatIntent,
} from "../types";
import type {
	WorkbenchLlmSelection,
	WorkbenchMessageResult,
} from "./nightWorkersWorkspaceState";

type ChatActionsInput = {
	queryClient: QueryClient;
	wsRef: MutableRefObject<WebSocket | null>;
	lastSubmitRef: MutableRefObject<{
		taskId: string;
		prompt: string;
		contextKey: string;
		at: number;
	} | null>;
	pendingChatQueueRef: MutableRefObject<
		Array<{ taskId: string; prompt: string }>
	>;
	chatSubmitStartedAtRef: MutableRefObject<number | null>;
	chatSubmitTransportRef: MutableRefObject<"http" | "websocket" | null>;
	pendingChatRunIdRef: MutableRefObject<string | null>;
	pendingAssistantTaskIdRef: MutableRefObject<string | null>;
	pendingChatAbortControllerRef: MutableRefObject<AbortController | null>;
	setIsChatSubmitting: (value: boolean) => void;
	setPendingChatRunId: (value: string | null) => void;
	setPendingAssistantTaskId: (value: string | null) => void;
};

function appendOptimisticUserMessage(
	sessionId: string,
	content: string,
	lastSubmitRef: ChatActionsInput["lastSubmitRef"],
	queryClient: QueryClient,
	artifactContext?: WorkbenchArtifactContext | null,
	images: PromptImageInput[] = [],
): boolean {
	const now = Date.now();
	const lastSubmit = lastSubmitRef.current;
	const artifactContextKey = artifactContext
		? `${artifactContext.kind}:${artifactContext.artifactId}`
		: "";
	const contextKey = `${artifactContextKey}:${images.map((image) => image.id).join(",")}`;
	if (
		lastSubmit &&
		lastSubmit.taskId === sessionId &&
		lastSubmit.prompt === content &&
		lastSubmit.contextKey === contextKey &&
		now - lastSubmit.at < 1500
	)
		return false;
	lastSubmitRef.current = {
		taskId: sessionId,
		prompt: content,
		contextKey,
		at: now,
	};
	const optimisticUserMessage: TaskMessage = {
		id: `optimistic-user-${Date.now()}`,
		taskId: sessionId,
		role: "user",
		content,
		messageType: "text",
		metadataJson:
			artifactContext || images.length > 0
				? {
						...(artifactContext
							? { intent: "artifact_context_instruction", artifactContext }
							: {}),
						source: "workbench",
						...(images.length > 0
							? {
									imageAttachments: images.map(
										({ id, name, mediaType, size }) => ({
											id,
											name,
											mediaType,
											size,
										}),
									),
								}
							: {}),
					}
				: undefined,
		traceOwner: "user",
		traceChannel: "chat",
		createdAt: new Date().toISOString(),
	};
	queryClient.setQueryData<TaskMessage[]>(
		["taskMessages", sessionId],
		(prev = []) => [...prev, optimisticUserMessage],
	);
	return true;
}

export function createNightWorkersChatActions(input: ChatActionsInput) {
	const {
		queryClient,
		wsRef,
		lastSubmitRef,
		pendingChatQueueRef,
		chatSubmitStartedAtRef,
		chatSubmitTransportRef,
		pendingChatRunIdRef,
		pendingAssistantTaskIdRef,
		pendingChatAbortControllerRef,
		setIsChatSubmitting,
		setPendingChatRunId,
		setPendingAssistantTaskId,
	} = input;
	const resetPendingChatState = () => {
		setIsChatSubmitting(false);
		chatSubmitStartedAtRef.current = null;
		chatSubmitTransportRef.current = null;
		pendingChatRunIdRef.current = null;
		setPendingChatRunId(null);
		pendingAssistantTaskIdRef.current = null;
		setPendingAssistantTaskId(null);
		pendingChatAbortControllerRef.current = null;
	};

	return {
		cancelChatSubmit: async () => {
			pendingChatAbortControllerRef.current?.abort(
				new DOMException("Chat submit cancelled.", "AbortError"),
			);
			pendingChatQueueRef.current = [];
			resetPendingChatState();
		},
		sendChatMessage: async (sessionId: string, prompt: string) => {
			const content = prompt.trim();
			if (!content) return;
			if (
				!appendOptimisticUserMessage(
					sessionId,
					content,
					lastSubmitRef,
					queryClient,
				)
			)
				return;
			setIsChatSubmitting(true);
			chatSubmitStartedAtRef.current = Date.now();
			chatSubmitTransportRef.current = "websocket";
			pendingChatRunIdRef.current = null;
			setPendingChatRunId(null);
			pendingAssistantTaskIdRef.current = sessionId;
			setPendingAssistantTaskId(sessionId);
			const ws = wsRef.current;
			if (!ws || ws.readyState !== WebSocket.OPEN) {
				pendingChatQueueRef.current.push({
					taskId: sessionId,
					prompt: content,
				});
				return;
			}
			ws.send(
				JSON.stringify({
					type: "chat_submit",
					taskId: sessionId,
					prompt: content,
				}),
			);
		},
		sendWorkbenchMessage: async (
			sessionId: string,
			prompt: string,
			intent: WorkbenchChatIntent,
			artifactContext?: WorkbenchArtifactContext | null,
			llmSelection?: WorkbenchLlmSelection,
			images: PromptImageInput[] = [],
		) => {
			const content = prompt.trim();
			if (!content) return;
			if (
				!appendOptimisticUserMessage(
					sessionId,
					content,
					lastSubmitRef,
					queryClient,
					artifactContext,
					images,
				)
			)
				return;
			setIsChatSubmitting(true);
			chatSubmitStartedAtRef.current = Date.now();
			chatSubmitTransportRef.current = "http";
			pendingChatRunIdRef.current = null;
			setPendingChatRunId(null);
			const expectsAssistantResponse =
				intent !== "queue" && intent !== "create_task";
			let shouldClearPendingAssistant = !expectsAssistantResponse;
			const abortController = new AbortController();
			pendingChatAbortControllerRef.current = abortController;
			if (expectsAssistantResponse) {
				pendingAssistantTaskIdRef.current = sessionId;
				setPendingAssistantTaskId(sessionId);
			} else {
				pendingAssistantTaskIdRef.current = null;
				setPendingAssistantTaskId(null);
			}
			try {
				const res = await appendWorkbenchMessage(
					sessionId,
					{
						prompt: content,
						intent,
						waitForIntake: false,
						...(llmSelection?.model ? { model: llmSelection.model } : {}),
						...(llmSelection?.providerEndpointId
							? { providerEndpointId: llmSelection.providerEndpointId }
							: {}),
						...(llmSelection?.thinkingDepth
							? { thinkingDepth: llmSelection.thinkingDepth }
							: {}),
						...(artifactContext ? { artifactContext } : {}),
						...(images.length > 0 ? { images } : {}),
					},
					{ signal: abortController.signal },
				);
				if (!res.ok) throw new Error(await res.text());
				const result = (await res.json()) as WorkbenchMessageResult;
				if (result.messages)
					queryClient.setQueryData(
						["taskMessages", sessionId],
						result.messages,
					);
				if (result.workspace) {
					queryClient.setQueryData(
						["planModeWorkspace", sessionId],
						result.workspace,
					);
				}
				if (result.task) {
					queryClient.setQueryData<Task[]>(["sessions"], (prev = []) => {
						const next = [...prev];
						const idx = next.findIndex((task) => task.id === result.task?.id);
						if (idx >= 0 && result.task)
							next[idx] = mergeTaskPreservingMissionPilot(
								next[idx],
								result.task,
							);
						else if (result.task) next.unshift(result.task);
						return next;
					});
				}
				if (result.run) {
					pendingChatRunIdRef.current = result.run.id;
					setPendingChatRunId(result.run.id);
					queryClient.setQueryData<TaskRun[]>(
						["sessionRuns", result.run.taskId],
						(prev = []) => {
							const next = [...prev];
							const idx = next.findIndex((run) => run.id === result.run?.id);
							if (idx >= 0) next[idx] = result.run as TaskRun;
							else next.unshift(result.run as TaskRun);
							return next;
						},
					);
				}
				const latestMessage = result.messages?.[result.messages.length - 1];
				shouldClearPendingAssistant =
					!expectsAssistantResponse ||
					latestMessage?.role === "assistant" ||
					latestMessage?.role === "system";
				queryClient.invalidateQueries({ queryKey: ["sessions"] });
				queryClient.invalidateQueries({ queryKey: ["sessionRuns", sessionId] });
				queryClient.invalidateQueries({
					queryKey: ["planModeWorkspace", sessionId],
				});
				return result;
			} catch (error) {
				shouldClearPendingAssistant = true;
				throw error;
			} finally {
				setIsChatSubmitting(false);
				chatSubmitStartedAtRef.current = null;
				chatSubmitTransportRef.current = null;
				if (!pendingChatRunIdRef.current) {
					pendingChatRunIdRef.current = null;
					setPendingChatRunId(null);
				}
				if (shouldClearPendingAssistant) {
					pendingAssistantTaskIdRef.current = null;
					setPendingAssistantTaskId(null);
				}
				if (pendingChatAbortControllerRef.current === abortController) {
					pendingChatAbortControllerRef.current = null;
				}
			}
		},
	};
}
