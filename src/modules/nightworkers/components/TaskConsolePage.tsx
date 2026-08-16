import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, RefreshCw, Shield, Terminal } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { client } from "../../../lib/api";
import { readJsonResponse } from "../../../lib/api-error";
import {
	useCodingAgentCommandClient,
	useCodingAgentCommandMutations,
} from "../../codingAgent";
import { taskOperatorProjectionQueryOptions } from "../../taskOperator";
import { reviewTaskRun } from "../nightWorkersCommands";
import { getActiveNightWorkersRealtimeConnection } from "../realtime/nightWorkersRealtimeConnection";
import type { Repository, Task, TaskRun } from "../types";
import {
	TaskConsoleHeader,
	TaskConsoleSidebar,
} from "./TaskConsoleTaskSummary";
import {
	isRecord,
	shouldPollTaskConsoleStatus,
	type TaskConsoleRunDetails,
} from "./task-console-model";
import { sanitizeTerminalText } from "./terminalText";

export function TaskConsolePage({ id }: { id: string }) {
	const { t } = useTranslation();
	const queryClient = useQueryClient();
	const codingAgentCommandClient = useCodingAgentCommandClient(
		getActiveNightWorkersRealtimeConnection,
	);
	const [activeTab, setActiveTab] = useState<"log" | "diff">("log");
	const {
		data: task,
		isLoading: isTaskLoading,
		isError: isTaskError,
		error: taskError,
		refetch: refetchTask,
	} = useQuery({
		queryKey: ["task", id],
		queryFn: async () => {
			const res = await client.tasks[":id"].$get({ param: { id } });
			return readJsonResponse<Task>(res);
		},
		refetchInterval: (query) =>
			shouldPollTaskConsoleStatus(
				(query.state.data as { status?: string } | undefined)?.status,
			)
				? 3000
				: false,
	});
	const { data: repo } = useQuery({
		queryKey: ["repository", task?.repositoryId],
		queryFn: async () => {
			if (!task?.repositoryId) return null;
			const res = await client.repositories[":id"].$get({
				param: { id: task.repositoryId },
			});
			return readJsonResponse<Repository>(res);
		},
		enabled: !!task?.repositoryId,
	});
	const {
		data: runs = [],
		isError: isRunsError,
		error: runsError,
		refetch: refetchRuns,
	} = useQuery({
		queryKey: ["taskRuns", id],
		queryFn: async () => {
			const res = await client.tasks[":id"].runs.$get({ param: { id } });
			return readJsonResponse<TaskRun[]>(res);
		},
		refetchInterval: (query) =>
			shouldPollTaskConsoleStatus(
				(query.state.data as Array<{ status?: string }> | undefined)?.[0]
					?.status,
			) || shouldPollTaskConsoleStatus(task?.status)
				? 3000
				: false,
	});
	const { data: taskOperatorView = null } = useQuery(
		taskOperatorProjectionQueryOptions(id),
	);

	const activeRun = runs[0];

	const {
		data: runDetails,
		isError: isRunDetailsError,
		error: runDetailsError,
		refetch: refetchRunDetails,
	} = useQuery({
		queryKey: ["runDetails", activeRun?.id],
		queryFn: async () => {
			if (!activeRun?.id) return null;
			const res = await client.runs[":id"].$get({
				param: { id: activeRun.id },
			});
			return readJsonResponse<TaskConsoleRunDetails>(res);
		},
		enabled: !!activeRun?.id,
		refetchInterval: (query) =>
			shouldPollTaskConsoleStatus(
				(query.state.data as { status?: string } | undefined)?.status,
			)
				? 1500
				: false,
	});

	const { startRunMutation } = useCodingAgentCommandMutations({
		client: codingAgentCommandClient,
		onFailure: () =>
			Promise.all([
				queryClient.invalidateQueries({
					queryKey: ["taskOperatorView", id],
				}),
				queryClient.invalidateQueries({ queryKey: ["taskRuns", id] }),
			]),
		onStartSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["task", id] });
			queryClient.invalidateQueries({ queryKey: ["taskRuns", id] });
		},
	});

	const reviewRunMutation = useMutation({
		mutationFn: async (data: {
			action: "complete" | "cancel";
			note?: string;
		}) => {
			if (!activeRun?.id) throw new Error("No active Run to review");
			return readJsonResponse(await reviewTaskRun(activeRun.id, data));
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["task", id] });
			queryClient.invalidateQueries({ queryKey: ["taskRuns", id] });
			if (activeRun?.id)
				queryClient.invalidateQueries({
					queryKey: ["runDetails", activeRun.id],
				});
		},
	});

	if (isTaskLoading) {
		return (
			<div className="flex items-center justify-center min-h-[50vh]">
				<RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
			</div>
		);
	}
	const queryError =
		(isTaskError && taskError) ||
		(isRunsError && runsError) ||
		(isRunDetailsError && runDetailsError);
	if (queryError) {
		return (
			<div
				className="flex min-h-[50vh] flex-col items-center justify-center gap-3"
				role="alert"
			>
				<span>
					{queryError instanceof Error
						? queryError.message
						: t("taskConsole.loadFailed")}
				</span>
				<button
					type="button"
					onClick={() => {
						void refetchTask();
						void refetchRuns();
						void refetchRunDetails();
					}}
				>
					{t("taskConsole.retry")}
				</button>
			</div>
		);
	}
	if (!task) {
		return (
			<div className="flex min-h-[50vh] items-center justify-center">
				{t("taskConsole.notFound")}
			</div>
		);
	}

	return (
		<div className="max-w-7xl mx-auto px-6 py-8">
			<TaskConsoleHeader
				task={task}
				repository={repo}
				canStart={Boolean(
					taskOperatorView?.commandCatalog.availableIds.includes(
						"run.implementation.start",
					),
				)}
				isStarting={startRunMutation.isPending}
				onStart={() => {
					if (!taskOperatorView) return;
					startRunMutation.mutate({
						taskId: id,
						expectedTaskRevision: taskOperatorView.task.revision,
					});
				}}
			/>

			<div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
				<TaskConsoleSidebar task={task} />

				<div className="lg:col-span-2 flex flex-col min-h-[500px]">
					<div className="flex items-center justify-between border-b border-border mb-4">
						<div className="flex gap-2">
							<button
								type="button"
								onClick={() => setActiveTab("log")}
								className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors ${
									activeTab === "log"
										? "border-primary text-foreground"
										: "border-transparent text-muted-foreground hover:text-foreground"
								}`}
							>
								{t("taskConsole.logTab")}
							</button>
							<button
								type="button"
								onClick={() => setActiveTab("diff")}
								className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors ${
									activeTab === "diff"
										? "border-primary text-foreground"
										: "border-transparent text-muted-foreground hover:text-foreground"
								}`}
							>
								{t("taskConsole.diffTab")}
							</button>
						</div>
						{runDetails?.endedAt && (
							<span className="text-xs text-muted-foreground">
								{t("taskConsole.ended", {
									time: new Date(runDetails.endedAt).toLocaleTimeString(),
								})}
							</span>
						)}
					</div>

					{activeTab === "log" && (
						<div className="flex-1 bg-black border border-zinc-800 rounded-xl p-5 shadow-2xl font-mono text-xs text-zinc-300 overflow-y-auto max-h-[500px] flex flex-col justify-between">
							<div className="space-y-4">
								<div className="text-zinc-500 flex justify-between border-b border-zinc-900 pb-2 mb-2">
									<span>{t("taskConsole.localWorkerActive")}</span>
									<span className="animate-pulse text-cyan-400">
										● {t("taskConsole.monitoring")}
									</span>
								</div>

								{runDetails?.events && runDetails.events.length > 0 ? (
									runDetails.events.map((evt) => {
										const payload: Record<string, unknown> = isRecord(
											evt.payloadJson,
										)
											? evt.payloadJson
											: {};
										const runEvent: Record<string, unknown> = isRecord(
											payload.runEvent,
										)
											? payload.runEvent
											: {};
										const runEventData: Record<string, unknown> = isRecord(
											runEvent.data,
										)
											? runEvent.data
											: {};
										const nestedPayload: Record<string, unknown> = isRecord(
											payload.payload,
										)
											? payload.payload
											: {};
										const payloadError: Record<string, unknown> | null =
											isRecord(payload.error) ? payload.error : null;
										const expectedEvidence = Array.isArray(
											payload.expectedEvidence,
										)
											? payload.expectedEvidence
											: [];
										const runEventType = runEvent.type;
										const isResponseDelta =
											runEventType === "model.response_delta";
										const isSupervisor =
											evt.actor === "supervisor" ||
											evt.eventType === "supervisor_decision";
										const isToolCall = evt.eventType === "tool_call";
										const isToolResult = evt.eventType === "tool_result";
										const isFinalReport = evt.eventType === "final_report";
										const isError =
											evt.type === "error" || evt.eventType === "error";

										if (isResponseDelta) {
											const text = String(
												runEventData.text || evt.message || "",
											);
											return (
												<div
													key={evt.id}
													className="border-l-2 border-cyan-500 pl-4 py-2 bg-cyan-950/10 rounded-r-lg space-y-1"
												>
													<div className="flex items-center gap-2 text-cyan-300 font-semibold">
														<RefreshCw className="h-3.5 w-3.5 animate-spin" />
														<span>{t("taskConsole.modelStream")}</span>
														<span className="text-[10px] text-zinc-500 font-mono">
															[{new Date(evt.timestamp).toLocaleTimeString()}]
														</span>
													</div>
													<p className="text-zinc-200 whitespace-pre-wrap font-sans">
														{text}
													</p>
												</div>
											);
										}

										if (isSupervisor) {
											return (
												<div
													key={evt.id}
													className="border-l-2 border-amber-500 pl-4 py-2 bg-amber-950/10 rounded-r-lg space-y-1"
												>
													<div className="flex items-center gap-2 text-amber-400 font-bold">
														<Shield className="h-4 w-4" />
														<span>
															{t("taskConsole.supervisorPhase", {
																phase: String(
																	payload.phase ||
																		t("taskConsole.defaultPhase"),
																),
															})}
														</span>
														<span className="text-[10px] text-zinc-500 font-mono">
															[{new Date(evt.timestamp).toLocaleTimeString()}]
														</span>
													</div>
													<p className="text-zinc-200 font-medium">
														{evt.message.replace(
															/\[Supervisor Decision\]\s*/,
															"",
														)}
													</p>
													{Boolean(payload.rationale) && (
														<p className="text-[11px] text-amber-300/80 italic font-sans">
															{t("taskConsole.rationale")}:{" "}
															{String(payload.rationale)}
														</p>
													)}
													{expectedEvidence.length > 0 && (
														<div className="text-[10px] text-zinc-400 font-sans">
															{t("taskConsole.expectedEvidence")}:{" "}
															{expectedEvidence
																.map((e) => `"${String(e)}"`)
																.join(", ")}
														</div>
													)}
												</div>
											);
										}

										if (isToolCall) {
											return (
												<div
													key={evt.id}
													className="border-l-2 border-blue-500 pl-4 py-2 bg-blue-950/10 rounded-r-lg space-y-1"
												>
													<div className="flex items-center gap-2 text-blue-400 font-semibold">
														<Terminal className="h-3.5 w-3.5" />
														<span>
															{t("taskConsole.workerRunningTool", {
																toolName: String(payload.toolName || ""),
															})}
														</span>
														<span className="text-[10px] text-zinc-500 font-mono">
															[{new Date(evt.timestamp).toLocaleTimeString()}]
														</span>
													</div>
													{Boolean(payload.arguments) && (
														<pre className="text-[10px] text-zinc-400 bg-zinc-950 p-2 rounded border border-zinc-900 overflow-x-auto max-w-full">
															{JSON.stringify(payload.arguments, null, 2)}
														</pre>
													)}
												</div>
											);
										}

										if (isToolResult) {
											const isSuccess = Boolean(payload.ok);
											return (
												<div
													key={evt.id}
													className={`border-l-2 ${
														isSuccess
															? "border-emerald-500 bg-emerald-950/5"
															: "border-rose-500 bg-rose-950/5"
													} pl-4 py-2 rounded-r-lg space-y-1`}
												>
													<div
														className={`flex items-center gap-2 ${
															isSuccess ? "text-emerald-400" : "text-rose-400"
														} font-semibold`}
													>
														<Check className="h-3.5 w-3.5" />
														<span>
															{t("taskConsole.workerToolResult", {
																toolName: String(payload.toolName || ""),
																result: t(
																	isSuccess
																		? "taskConsole.toolSucceeded"
																		: "taskConsole.toolFailed",
																),
															})}
														</span>
														<span className="text-[10px] text-zinc-500 font-mono">
															[{new Date(evt.timestamp).toLocaleTimeString()}]
														</span>
													</div>
													{Boolean(nestedPayload.content) && (
														<pre className="text-[10px] text-zinc-300 bg-zinc-950/80 p-2 rounded border border-zinc-900/50 overflow-y-auto max-h-[120px] whitespace-pre-wrap">
															{sanitizeTerminalText(
																String(nestedPayload.content),
															)}
														</pre>
													)}
													{Boolean(nestedPayload.stdout) && (
														<pre className="text-[10px] text-zinc-300 bg-zinc-950/80 p-2 rounded border border-zinc-900/50 overflow-y-auto max-h-[120px] whitespace-pre-wrap font-mono">
															{sanitizeTerminalText(
																String(nestedPayload.stdout),
															)}
														</pre>
													)}
													{Boolean(nestedPayload.stderr) && (
														<pre className="text-[10px] text-rose-300 bg-zinc-950/80 p-2 rounded border border-zinc-900/50 overflow-y-auto max-h-[120px] whitespace-pre-wrap font-mono">
															{sanitizeTerminalText(
																String(nestedPayload.stderr),
															)}
														</pre>
													)}
													{payloadError && (
														<p className="text-[11px] text-rose-300 font-sans">
															{t("taskConsole.error")}:{" "}
															{String(payloadError.message || "")}
														</p>
													)}
												</div>
											);
										}

										if (isFinalReport) {
											return (
												<div
													key={evt.id}
													className="border-l-2 border-purple-500 pl-4 py-3 bg-purple-950/10 rounded-r-lg space-y-2"
												>
													<div className="flex items-center gap-2 text-purple-400 font-bold">
														<Check className="h-4 w-4" />
														<span>{t("taskConsole.finalReport")}</span>
														<span className="text-[10px] text-zinc-500 font-mono">
															[{new Date(evt.timestamp).toLocaleTimeString()}]
														</span>
													</div>
													<p className="text-zinc-200 text-sm whitespace-pre-wrap font-sans">
														{String(payload.finalReport || evt.message)}
													</p>
													{Boolean(payload.diffStat) && (
														<div>
															<span className="text-xs text-purple-300 font-bold">
																{t("taskConsole.changeStats")}:
															</span>
															<pre className="text-[10px] text-zinc-300 bg-zinc-950 p-2 rounded border border-zinc-900 overflow-x-auto max-w-full font-mono mt-1">
																{String(payload.diffStat)}
															</pre>
														</div>
													)}
												</div>
											);
										}

										return (
											<div
												key={evt.id}
												className="flex gap-2.5 py-1 text-zinc-400"
											>
												<span className="text-zinc-600">
													[{new Date(evt.timestamp).toLocaleTimeString()}]
												</span>
												<span
													className={
														isError
															? "text-rose-400 font-semibold"
															: "text-zinc-400"
													}
												>
													{evt.message}
												</span>
											</div>
										);
									})
								) : (
									<div className="text-zinc-600 italic py-8 text-center">
										{t("taskConsole.noLogs")}
									</div>
								)}

								{[
									"running",
									"context_compiling",
									"compiling_context",
									"finalizing",
								].includes(activeRun?.status || "") && (
									<div className="flex items-center gap-2 text-cyan-400 animate-pulse mt-4">
										<RefreshCw className="h-3.5 w-3.5 animate-spin" />
										<span>
											{activeRun?.status === "finalizing"
												? t("taskConsole.finalizing")
												: t("taskConsole.working")}
										</span>
									</div>
								)}
							</div>

							{runDetails?.logContent && (
								<details className="mt-8 border-t border-zinc-900 pt-4">
									<summary className="cursor-pointer text-zinc-500 hover:text-zinc-300">
										{t("taskConsole.viewRawOutput")}
									</summary>
									<pre className="mt-2 text-[10px] text-zinc-400 whitespace-pre-wrap max-h-[200px] overflow-y-auto bg-zinc-950 p-2 rounded">
										{runDetails.logContent}
									</pre>
								</details>
							)}
						</div>
					)}

					{/* Diff View */}
					{activeTab === "diff" && (
						<div className="flex-1 bg-zinc-950 border border-zinc-900 rounded-xl p-5 shadow-2xl font-mono text-xs overflow-y-auto max-h-[500px]">
							{runDetails?.diffPatch ? (
								<div>
									<div className="text-zinc-500 border-b border-zinc-900 pb-2 mb-4 flex items-center justify-between">
										<span>{t("taskConsole.generatedPatch")}</span>
										<span className="text-emerald-400 font-bold">
											{t("taskConsole.readyReview")}
										</span>
									</div>
									<pre className="text-zinc-300 whitespace-pre bg-zinc-900/50 p-3 rounded-lg border border-zinc-900 max-h-[300px] overflow-x-auto">
										{runDetails.diffPatch}
									</pre>

									{/* Manual Approval Action */}
									<div className="mt-6 flex gap-3">
										<Button
											onClick={() =>
												reviewRunMutation.mutate({
													action: "complete",
													note: t("taskConsole.approvedNote"),
												})
											}
											disabled={reviewRunMutation.isPending}
											className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold gap-1.5 flex-1"
										>
											<Check className="h-4 w-4" />
											{reviewRunMutation.isPending
												? t("taskConsole.completing")
												: t("taskConsole.approve")}
										</Button>
										<Button
											onClick={() =>
												reviewRunMutation.mutate({
													action: "cancel",
													note: t("taskConsole.discardedNote"),
												})
											}
											disabled={reviewRunMutation.isPending}
											variant="outline"
											className="border-zinc-800 hover:bg-zinc-900 hover:text-white flex-1"
										>
											{reviewRunMutation.isPending
												? t("taskConsole.discarding")
												: t("taskConsole.discard")}
										</Button>
									</div>
								</div>
							) : (
								<div className="text-zinc-500 italic py-12 text-center">
									{t("taskConsole.noDiff")}
								</div>
							)}
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
