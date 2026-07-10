import { Loader2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import type { MissionPilotDetail } from "../../../../../../shared/schemas/mission-pilot.schema";
import { missionPilotDetailSchema } from "../../../../../../shared/schemas/mission-pilot.schema";
import {
	applyMissionReplan,
	commandMissionAutopilot,
	createMissionReplanSuggestion,
	decideMissionApproval,
	enqueueMissionTask,
	evaluateMission,
	fetchMissionPilotDetail,
	materializeMissionTask,
	requestMissionApproval,
	startMissionAutopilot,
	syncMissionExecution,
} from "../../../missionPilotCommands";
import { readJsonResponse } from "../data";
import {
	controlStyle,
	mutedTextStyle,
	panelStyle,
	subtleTextStyle,
} from "../styles";

function dateLabel(value: string | Date) {
	return new Intl.DateTimeFormat("ja-JP", {
		dateStyle: "short",
		timeStyle: "short",
	}).format(new Date(value));
}

function statusLabel(status: string) {
	return status.replaceAll("_", " ");
}

export function MissionPilotDetailView({
	detail,
	onRequestApproval,
	onDecideApproval,
	onMaterialize,
	onEnqueue,
	onRequestAutopilotApproval,
	onStartAutopilot,
	onAutopilotCommand,
	onSyncExecution,
	onEvaluateMission,
	onCreateReplanSuggestion,
	onRequestReplanApproval,
	onApplyReplan,
	busyTargetId,
}: {
	detail: MissionPilotDetail;
	onRequestApproval?: (candidateId: string) => void;
	onDecideApproval?: (
		approvalId: string,
		decision: "approve" | "reject",
	) => void;
	onMaterialize?: (candidateId: string, approvalId: string) => void;
	onEnqueue?: (missionTaskId: string) => void;
	onRequestAutopilotApproval?: () => void;
	onStartAutopilot?: (approvalId: string) => void;
	onAutopilotCommand?: (
		command: "pause" | "resume" | "revoke" | "tick",
	) => void;
	onSyncExecution?: () => void;
	onEvaluateMission?: () => void;
	onCreateReplanSuggestion?: (evaluationId: string) => void;
	onRequestReplanApproval?: (suggestionId: string) => void;
	onApplyReplan?: (suggestionId: string, approvalId: string) => void;
	busyTargetId?: string | null;
}) {
	const [selectedEvidence, setSelectedEvidence] = useState<{
		type: string;
		id: string;
		label?: string;
	} | null>(null);
	const summary = detail.executionSummary;
	const autopilotApproval = [...detail.approvals]
		.reverse()
		.find(
			(approval) =>
				approval.targetType === "mission" &&
				approval.approvalType === "autopilot_start",
		);
	const grant = detail.latestAutopilotGrant;
	const latestEvaluation = detail.latestEvaluation;
	return (
		<div className="nightworkers-scrollbar min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
			<section className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
				{[
					["承認済み", summary.approved],
					["Queue", summary.queued],
					["実行中", summary.running],
					["評価待ち", summary.awaitingEvaluation],
					["達成", summary.satisfied],
					["ブロック", summary.blocked],
					["失敗", summary.failed],
				].map(([label, value]) => (
					<div key={String(label)} className="border p-2" style={controlStyle}>
						<div className="text-[10px] font-semibold" style={subtleTextStyle}>
							{label}
						</div>
						<div className="mt-1 text-lg font-bold">{value}</div>
					</div>
				))}
			</section>

			<section className="border p-3" style={controlStyle}>
				<div className="text-xs font-bold">次の推奨アクション</div>
				<div className="mt-1 text-sm font-semibold">
					{detail.nextRecommendedAction.type}
				</div>
				<p className="mt-1 text-xs" style={mutedTextStyle}>
					{detail.nextRecommendedAction.reason}
				</p>
			</section>

			<section className="border p-3" style={controlStyle}>
				<div className="flex flex-wrap items-start justify-between gap-3">
					<div>
						<div className="text-xs font-bold">実行証拠と進捗評価</div>
						<p className="mt-1 text-[11px]" style={mutedTextStyle}>
							{detail.latestEvaluation
								? `${statusLabel(detail.latestEvaluation.result)} · ${detail.latestEvaluation.summary}`
								: "まだ評価されていません。Run完了だけではObjectiveを達成扱いにしません。"}
						</p>
					</div>
					<div className="flex gap-2">
						{onSyncExecution ? (
							<Button size="sm" variant="outline" onClick={onSyncExecution}>
								証拠を同期
							</Button>
						) : null}
						{onEvaluateMission ? (
							<Button size="sm" onClick={onEvaluateMission}>
								進捗を評価
							</Button>
						) : null}
					</div>
				</div>
				{detail.latestEvaluation?.evidenceRefs.length ? (
					<div className="mt-3 flex flex-wrap gap-2">
						{detail.latestEvaluation.evidenceRefs.map((ref) => (
							<button
								type="button"
								key={`${ref.type}:${ref.id}`}
								className="border px-2 py-1 text-[10px]"
								style={controlStyle}
								onClick={() => setSelectedEvidence(ref)}
							>
								{ref.label ?? ref.type}
							</button>
						))}
					</div>
				) : null}
				{selectedEvidence ? (
					<div
						className="mt-3 flex items-start justify-between gap-3 border p-2 text-[11px]"
						style={{ borderColor: "var(--nw-border)" }}
					>
						<div>
							<div className="font-semibold">{selectedEvidence.type}</div>
							<div className="break-all" style={mutedTextStyle}>
								{selectedEvidence.id}
							</div>
						</div>
						<Button
							size="sm"
							variant="outline"
							onClick={() => setSelectedEvidence(null)}
						>
							閉じる
						</Button>
					</div>
				) : null}
			</section>

			<section className="border p-3" style={controlStyle}>
				<div className="flex items-start justify-between gap-3">
					<div>
						<div className="text-xs font-bold">Level 1 Autopilot</div>
						<div className="mt-1 text-[11px]" style={mutedTextStyle}>
							{grant
								? `grant: ${grant.status} / ${grant.allowedActions.join(", ")}`
								: `approval: ${autopilotApproval?.status ?? "not requested"}`}
						</div>
					</div>
					<div className="flex flex-wrap justify-end gap-2">
						{!grant && !autopilotApproval && onRequestAutopilotApproval ? (
							<Button
								size="sm"
								variant="outline"
								onClick={onRequestAutopilotApproval}
							>
								開始承認を依頼
							</Button>
						) : null}
						{!grant &&
						autopilotApproval?.status === "requested" &&
						onDecideApproval ? (
							<>
								<Button
									size="sm"
									onClick={() =>
										onDecideApproval(autopilotApproval.id, "approve")
									}
								>
									承認
								</Button>
								<Button
									size="sm"
									variant="outline"
									onClick={() =>
										onDecideApproval(autopilotApproval.id, "reject")
									}
								>
									却下
								</Button>
							</>
						) : null}
						{!grant &&
						autopilotApproval?.status === "approved" &&
						onStartAutopilot ? (
							<Button
								size="sm"
								onClick={() => onStartAutopilot(autopilotApproval.id)}
							>
								開始
							</Button>
						) : null}
						{grant?.status === "active" && onAutopilotCommand ? (
							<>
								<Button size="sm" onClick={() => onAutopilotCommand("tick")}>
									1 action進める
								</Button>
								<Button
									size="sm"
									variant="outline"
									onClick={() => onAutopilotCommand("pause")}
								>
									一時停止
								</Button>
								<Button
									size="sm"
									variant="outline"
									onClick={() => onAutopilotCommand("revoke")}
								>
									取消
								</Button>
							</>
						) : null}
						{grant?.status === "paused" && onAutopilotCommand ? (
							<>
								<Button size="sm" onClick={() => onAutopilotCommand("resume")}>
									再開
								</Button>
								<Button
									size="sm"
									variant="outline"
									onClick={() => onAutopilotCommand("revoke")}
								>
									取消
								</Button>
							</>
						) : null}
					</div>
				</div>
			</section>

			{detail.attentionItems.length > 0 ? (
				<section className="space-y-2">
					<h3 className="text-xs font-bold">対応が必要</h3>
					{detail.attentionItems.map((item) => (
						<div
							key={item.id}
							className="border p-3 text-xs"
							style={{ ...controlStyle, borderColor: "var(--nw-warning)" }}
						>
							<div className="font-bold">{item.title}</div>
							<div className="mt-1" style={mutedTextStyle}>
								{item.summary}
							</div>
						</div>
					))}
				</section>
			) : null}

			<section className="space-y-2">
				<div className="flex items-center justify-between gap-2">
					<h3 className="text-xs font-bold">Replan Suggestions</h3>
					{latestEvaluation &&
					["failed", "blocked"].includes(latestEvaluation.result) &&
					onCreateReplanSuggestion ? (
						<Button
							size="sm"
							variant="outline"
							onClick={() => onCreateReplanSuggestion(latestEvaluation.id)}
						>
							再計画案を作成
						</Button>
					) : null}
				</div>
				{detail.replanSuggestions.length === 0 ? (
					<p className="text-xs" style={mutedTextStyle}>
						再計画差分はありません。
					</p>
				) : (
					detail.replanSuggestions.map((suggestion) => {
						const approval = detail.approvals.find(
							(item) =>
								item.targetType === "replan_suggestion" &&
								item.targetId === suggestion.id,
						);
						return (
							<div
								key={suggestion.id}
								className="border p-3"
								style={controlStyle}
							>
								<div className="flex items-start justify-between gap-2">
									<div>
										<div className="text-xs font-bold">{suggestion.reason}</div>
										<div className="mt-1 text-[10px]" style={subtleTextStyle}>
											base revision: {suggestion.baseRevisionId} ·{" "}
											{suggestion.status}
										</div>
									</div>
									<div className="flex flex-wrap justify-end gap-2">
										{suggestion.status === "awaiting_approval" &&
										!approval &&
										onRequestReplanApproval ? (
											<Button
												size="sm"
												variant="outline"
												onClick={() => onRequestReplanApproval(suggestion.id)}
											>
												承認を依頼
											</Button>
										) : null}
										{approval?.status === "requested" && onDecideApproval ? (
											<>
												<Button
													size="sm"
													onClick={() =>
														onDecideApproval(approval.id, "approve")
													}
												>
													承認
												</Button>
												<Button
													size="sm"
													variant="outline"
													onClick={() =>
														onDecideApproval(approval.id, "reject")
													}
												>
													却下
												</Button>
											</>
										) : null}
										{suggestion.status === "approved" &&
										approval?.status === "approved" &&
										onApplyReplan ? (
											<Button
												size="sm"
												onClick={() =>
													onApplyReplan(suggestion.id, approval.id)
												}
											>
												適用
											</Button>
										) : null}
									</div>
								</div>
								<ul
									className="mt-2 space-y-1 text-[11px]"
									style={mutedTextStyle}
								>
									{suggestion.taskGraphDiff.map((operation) => (
										<li
											key={`${suggestion.id}:${operation.op}:${JSON.stringify(operation)}`}
										>
											{operation.op}:{" "}
											{"candidateId" in operation
												? operation.candidateId
												: "candidate" in operation
													? operation.candidate.id
													: "objectiveId" in operation
														? operation.objectiveId
														: "objective" in operation
															? operation.objective.id
															: "dependency"}
										</li>
									))}
								</ul>
							</div>
						);
					})
				)}
			</section>

			<section className="space-y-2">
				<h3 className="text-xs font-bold">Objectives</h3>
				{detail.objectives.length === 0 ? (
					<p className="text-xs" style={mutedTextStyle}>
						まだObjectiveはありません。
					</p>
				) : (
					detail.objectives.map((objective) => (
						<div key={objective.id} className="border p-3" style={controlStyle}>
							<div className="flex items-start justify-between gap-2">
								<div className="text-xs font-bold">{objective.title}</div>
								<span className="text-[10px] uppercase" style={subtleTextStyle}>
									{statusLabel(objective.status)}
								</span>
							</div>
							<ul
								className="mt-2 list-disc space-y-1 pl-4 text-[11px]"
								style={mutedTextStyle}
							>
								{objective.completionCriteria.map((criterion) => (
									<li key={criterion}>{criterion}</li>
								))}
							</ul>
						</div>
					))
				)}
			</section>

			<section className="space-y-2">
				<h3 className="text-xs font-bold">Task Candidates</h3>
				{detail.taskCandidates.length === 0 ? (
					<p className="text-xs" style={mutedTextStyle}>
						まだTaskCandidateはありません。
					</p>
				) : (
					detail.taskCandidates.map((candidate) => {
						const approval = [...detail.approvals]
							.reverse()
							.find(
								(item) =>
									item.targetType === "task_candidate" &&
									item.targetId === candidate.taskCandidateId,
							);
						const busy =
							busyTargetId === candidate.taskCandidateId ||
							busyTargetId === approval?.id;
						const missionTask = detail.missionTasks.find(
							(item) => item.taskCandidateId === candidate.taskCandidateId,
						);
						return (
							<div
								key={candidate.taskCandidateId}
								className="border p-3"
								style={controlStyle}
							>
								<div className="flex items-start justify-between gap-2">
									<div>
										<div className="text-xs font-bold">{candidate.title}</div>
										<p className="mt-1 text-[11px]" style={mutedTextStyle}>
											{candidate.summary}
										</p>
									</div>
									<span
										className="text-[10px] uppercase"
										style={subtleTextStyle}
									>
										{statusLabel(candidate.status)}
									</span>
								</div>
								<div
									className="mt-2 flex flex-wrap gap-2 text-[10px]"
									style={subtleTextStyle}
								>
									<span>risk: {candidate.risk}</span>
									<span>approval: {approval?.status ?? "not requested"}</span>
									<span>scheduling: {candidate.scheduling.executionType}</span>
								</div>
								{candidate.verificationGate.length > 0 ? (
									<ul
										className="mt-2 list-disc pl-4 text-[11px]"
										style={mutedTextStyle}
									>
										{candidate.verificationGate.map((gate) => (
											<li key={gate}>{gate}</li>
										))}
									</ul>
								) : null}
								{onRequestApproval &&
								(!approval ||
									["stale", "rejected", "cancelled", "expired"].includes(
										approval.status,
									)) ? (
									<Button
										className="mt-3"
										size="sm"
										variant="outline"
										disabled={busy}
										onClick={() => onRequestApproval(candidate.taskCandidateId)}
									>
										{busy ? "処理中" : "承認を依頼"}
									</Button>
								) : null}
								{approval?.status === "requested" && onDecideApproval ? (
									<div className="mt-3 flex gap-2">
										<Button
											size="sm"
											disabled={busy}
											onClick={() => onDecideApproval(approval.id, "approve")}
										>
											承認
										</Button>
										<Button
											size="sm"
											variant="outline"
											disabled={busy}
											onClick={() => onDecideApproval(approval.id, "reject")}
										>
											却下
										</Button>
									</div>
								) : null}
								{approval?.status === "approved" &&
								!missionTask &&
								onMaterialize ? (
									<Button
										className="mt-3"
										size="sm"
										disabled={busy}
										onClick={() =>
											onMaterialize(candidate.taskCandidateId, approval.id)
										}
									>
										Task化
									</Button>
								) : null}
								{missionTask ? (
									<div
										className="mt-3 border-t pt-2 text-[11px]"
										style={{ borderColor: "var(--nw-border)" }}
									>
										<div>MissionTask: {missionTask.status}</div>
										{missionTask.nightworkersTaskId ? (
											<div>Task: {missionTask.nightworkersTaskId}</div>
										) : null}
										{missionTask.queueEntryId ? (
											<div>Queue: {missionTask.queueEntryId}</div>
										) : null}
										{missionTask.status === "task_created" && onEnqueue ? (
											<Button
												className="mt-2"
												size="sm"
												disabled={busyTargetId === missionTask.id}
												onClick={() => onEnqueue(missionTask.id)}
											>
												Queue投入
											</Button>
										) : null}
									</div>
								) : null}
							</div>
						);
					})
				)}
			</section>

			<section className="space-y-2">
				<h3 className="text-xs font-bold">Mission Events</h3>
				{detail.events.map((event) => (
					<div
						key={event.id}
						className="flex gap-3 border-l pl-3 text-xs"
						style={{ borderColor: "var(--nw-border)" }}
					>
						<div className="w-28 shrink-0 text-[10px]" style={subtleTextStyle}>
							{dateLabel(event.occurredAt)}
						</div>
						<div>
							<div className="font-semibold">{event.summary}</div>
							<div className="mt-0.5 text-[10px]" style={mutedTextStyle}>
								{event.actor.displayName} · {event.eventType}
							</div>
						</div>
					</div>
				))}
			</section>
		</div>
	);
}

export function MissionPilotDetailModal({
	missionId,
	onClose,
}: {
	missionId: string;
	onClose: () => void;
}) {
	const [detail, setDetail] = useState<MissionPilotDetail | null>(null);
	const [loading, setLoading] = useState(true);
	const [fetchError, setFetchError] = useState("");
	const [mutationError, setMutationError] = useState("");
	const [busyTargetId, setBusyTargetId] = useState<string | null>(null);

	const loadDetail = useCallback(async () => {
		setLoading(true);
		setFetchError("");
		try {
			const payload = await readJsonResponse<unknown>(
				await fetchMissionPilotDetail(missionId),
			);
			setDetail(missionPilotDetailSchema.parse(payload));
		} catch (cause) {
			setFetchError(
				cause instanceof Error
					? cause.message
					: "Missionの取得に失敗しました。",
			);
		} finally {
			setLoading(false);
		}
	}, [missionId]);

	useEffect(() => {
		void loadDetail();
	}, [loadDetail]);

	const runApprovalAction = async (
		targetId: string,
		action: () => Promise<Response>,
	) => {
		setBusyTargetId(targetId);
		setMutationError("");
		try {
			await readJsonResponse(await action());
		} catch (cause) {
			setMutationError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			await loadDetail();
			setBusyTargetId(null);
		}
	};

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
			<div
				role="dialog"
				aria-modal="true"
				aria-label="Mission Pilot"
				className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden border"
				style={panelStyle}
			>
				<header
					className="flex shrink-0 items-start justify-between gap-3 border-b p-4"
					style={{ borderColor: "var(--nw-border)" }}
				>
					<div className="min-w-0">
						<div
							className="text-[10px] font-bold uppercase tracking-wide"
							style={subtleTextStyle}
						>
							Mission Pilot
						</div>
						<h2 className="truncate text-base font-bold">
							{detail?.mission.title ?? "Missionを読み込み中"}
						</h2>
						{detail ? (
							<p className="mt-1 text-xs" style={mutedTextStyle}>
								{detail.mission.goalText}
							</p>
						) : null}
					</div>
					<div className="flex gap-2">
						<Button
							variant="outline"
							size="icon"
							aria-label="閉じる"
							onClick={onClose}
						>
							<X className="h-4 w-4" />
						</Button>
					</div>
				</header>
				{mutationError ? (
					<div
						className="mx-4 mt-4 border p-3 text-xs"
						style={{ ...controlStyle, color: "var(--nw-danger)" }}
					>
						{mutationError}
					</div>
				) : null}
				{loading && !detail ? (
					<div
						className="flex min-h-72 items-center justify-center gap-2 text-xs"
						style={mutedTextStyle}
					>
						<Loader2 className="h-4 w-4 animate-spin" /> 読み込み中
					</div>
				) : fetchError ? (
					<div
						className="m-4 border p-3 text-xs"
						style={{ ...controlStyle, color: "var(--nw-danger)" }}
					>
						{fetchError}
					</div>
				) : detail ? (
					<MissionPilotDetailView
						detail={detail}
						busyTargetId={busyTargetId}
						onSyncExecution={() =>
							void runApprovalAction(missionId, () =>
								syncMissionExecution(missionId, {
									idempotencyKey: crypto.randomUUID(),
								}),
							)
						}
						onEvaluateMission={() =>
							void runApprovalAction(missionId, () =>
								evaluateMission(missionId, {
									idempotencyKey: crypto.randomUUID(),
								}),
							)
						}
						onCreateReplanSuggestion={(evaluationId) =>
							void runApprovalAction(evaluationId, () =>
								createMissionReplanSuggestion(missionId, {
									evaluationId,
									idempotencyKey: crypto.randomUUID(),
								}),
							)
						}
						onRequestReplanApproval={(suggestionId) =>
							void runApprovalAction(suggestionId, () =>
								requestMissionApproval(missionId, {
									targetType: "replan_suggestion",
									targetId: suggestionId,
									approvalType: "replan",
									reason: "再計画差分と影響範囲を確認する。",
									idempotencyKey: crypto.randomUUID(),
								}),
							)
						}
						onApplyReplan={(suggestionId, approvalId) =>
							void runApprovalAction(suggestionId, () =>
								applyMissionReplan(missionId, suggestionId, {
									approvalId,
									idempotencyKey: crypto.randomUUID(),
								}),
							)
						}
						onRequestApproval={(candidateId) =>
							void runApprovalAction(candidateId, () =>
								requestMissionApproval(missionId, {
									targetType: "task_candidate",
									targetId: candidateId,
									approvalType: "queue_admission",
									reason:
										"Queue投入前にTaskCandidateの内容とリスクを確認する。",
									idempotencyKey: crypto.randomUUID(),
								}),
							)
						}
						onDecideApproval={(approvalId, decision) =>
							void runApprovalAction(approvalId, () =>
								decideMissionApproval(missionId, approvalId, decision, {
									reason:
										decision === "approve"
											? "内容を確認し実行を承認する。"
											: "現在の内容では実行しない。",
									idempotencyKey: crypto.randomUUID(),
								}),
							)
						}
						onMaterialize={(candidateId, approvalId) =>
							void runApprovalAction(candidateId, () =>
								materializeMissionTask(missionId, candidateId, {
									approvalId,
									mode: "ready",
									idempotencyKey: crypto.randomUUID(),
								}),
							)
						}
						onEnqueue={(missionTaskId) =>
							void runApprovalAction(missionTaskId, () =>
								enqueueMissionTask(missionId, missionTaskId, {
									idempotencyKey: crypto.randomUUID(),
								}),
							)
						}
						onRequestAutopilotApproval={() =>
							void runApprovalAction(missionId, () =>
								requestMissionApproval(missionId, {
									targetType: "mission",
									targetId: missionId,
									approvalType: "autopilot_start",
									autopilotConfig: {
										autonomyLevel: 1,
										allowedActions: [
											"enqueue_approved_task",
											"sync_execution",
											"evaluate_completed_run",
											"create_replan_suggestion",
											"pause_mission",
										],
									},
									reason: "Level 1 Approved Executionを開始する。",
									idempotencyKey: crypto.randomUUID(),
								}),
							)
						}
						onStartAutopilot={(approvalId) =>
							void runApprovalAction(missionId, () =>
								startMissionAutopilot(missionId, {
									autonomyLevel: 1,
									allowedActions: [
										"enqueue_approved_task",
										"sync_execution",
										"evaluate_completed_run",
										"create_replan_suggestion",
										"pause_mission",
									],
									approvalId,
									idempotencyKey: crypto.randomUUID(),
								}),
							)
						}
						onAutopilotCommand={(command) =>
							void runApprovalAction(missionId, () =>
								commandMissionAutopilot(
									missionId,
									command,
									crypto.randomUUID(),
								),
							)
						}
					/>
				) : null}
			</div>
		</div>
	);
}
