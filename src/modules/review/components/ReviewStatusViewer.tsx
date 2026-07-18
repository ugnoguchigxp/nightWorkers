import type { TFunction } from "i18next";
import {
	Archive,
	ArchiveRestore,
	ClipboardCheck,
	LoaderCircle,
	ShieldAlert,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { GitCloseoutState, TaskRun } from "../../nightworkers/types/core";
import type { ReviewModePromptAction } from "../reviewModeLauncher";
import type {
	ReviewArtifact,
	ReviewRunArtifactPayload,
	ReviewSessionDetail,
} from "../types";
import { ReviewGitIntegrationPanel } from "./ReviewGitIntegrationPanel";
import { ReviewPromptActions } from "./ReviewPromptActions";
import { ReviewRunResultPanel } from "./ReviewRunResultPanel";

type ReviewStatusViewerProps = {
	detail: ReviewSessionDetail | null;
	loading?: boolean;
	gitCloseout?: GitCloseoutState | null;
	onCommitGitCloseout?: (runId: string) => Promise<GitCloseoutState>;
	onPushGitCloseout?: (runId: string) => Promise<GitCloseoutState>;
	activeTaskStatus?: string | null;
	onCompleteAndArchiveTask?: (taskId: string) => Promise<unknown>;
	onRestoreArchivedTask?: (taskId: string) => Promise<unknown>;
	latestRun?: TaskRun;
	onSubmitReviewPrompt?: (prompt: string) => Promise<boolean>;
	isReviewPromptDisabled?: boolean;
};

function reviewStatusLabel(t: TFunction, key: string, fallback: string) {
	return t(key, { defaultValue: fallback });
}

function reviewStatusValueLabel(t: TFunction, group: string, value: string) {
	return reviewStatusLabel(t, `reviewStatus.${group}.${value}`, value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function reviewArtifactTimeValue(artifact: ReviewArtifact) {
	const timestamp = new Date(artifact.updatedAt).getTime();
	return Number.isNaN(timestamp) ? 0 : timestamp;
}

function latestArtifactByKind(artifacts: ReviewArtifact[], kind: string) {
	return artifacts
		.filter((artifact) => artifact.kind === kind)
		.sort((a, b) => reviewArtifactTimeValue(b) - reviewArtifactTimeValue(a))[0];
}

function reviewRunPayload(
	artifact: ReviewArtifact | undefined,
): ReviewRunArtifactPayload | null {
	if (!artifact || !isRecord(artifact.artifact)) return null;
	if (artifact.artifact.kind !== "review_run") return null;
	return artifact.artifact as ReviewRunArtifactPayload;
}

const terminalReviewRunStatuses = new Set([
	"completed",
	"needs_review",
	"needs_human",
	"failed",
	"blocked",
	"timed_out",
	"cancelled",
]);

function reviewRunResolvedStatus(
	payload: ReviewRunArtifactPayload | null,
	latestRun?: TaskRun,
) {
	if (!payload) return null;
	if (
		payload.status === "running" &&
		payload.reviewRunId &&
		latestRun?.id === payload.reviewRunId &&
		terminalReviewRunStatuses.has(latestRun.status)
	) {
		if (
			latestRun.status === "completed" ||
			latestRun.status === "needs_review"
		) {
			return "done";
		}
		if (latestRun.status === "needs_human" || latestRun.status === "blocked") {
			return "needs_human";
		}
		return "failed";
	}
	return payload.status;
}

const reviewActionButtonBaseClass =
	"inline-flex h-8 items-center justify-center gap-1.5 rounded border px-3 text-xs font-semibold shadow-sm transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:shadow-none";
const reviewPrimaryActionButtonClass = `${reviewActionButtonBaseClass} nightworkers-primary-action-button`;
const reviewSuccessActionButtonClass = `${reviewActionButtonBaseClass} nightworkers-success-action-button`;

export function ReviewStatusViewer({
	detail,
	loading = false,
	gitCloseout,
	onCommitGitCloseout,
	onPushGitCloseout,
	activeTaskStatus,
	onCompleteAndArchiveTask,
	onRestoreArchivedTask,
	latestRun,
	onSubmitReviewPrompt,
	isReviewPromptDisabled = false,
}: ReviewStatusViewerProps) {
	const { t } = useTranslation();
	const [busySection, setBusySection] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [promptSubmission, setPromptSubmission] = useState<{
		actionId: ReviewModePromptAction["id"];
		phase: "submitting" | "waiting";
	} | null>(null);
	const handleGitBusyChange = useCallback((busy: boolean) => {
		setBusySection((current) =>
			busy ? "git" : current === "git" ? null : current,
		);
	}, []);
	useEffect(() => {
		if (promptSubmission?.phase !== "waiting" || isReviewPromptDisabled) return;
		setPromptSubmission(null);
	}, [isReviewPromptDisabled, promptSubmission?.phase]);
	const submitReviewPrompt = async (action: ReviewModePromptAction) => {
		if (!onSubmitReviewPrompt || busySection || promptSubmission) return;
		setPromptSubmission({ actionId: action.id, phase: "submitting" });
		setError(null);
		try {
			const accepted = await onSubmitReviewPrompt(action.prompt);
			if (!accepted) {
				throw new Error(
					"Coding Agentの実行を開始できませんでした。もう一度お試しください。",
				);
			}
			setPromptSubmission({ actionId: action.id, phase: "waiting" });
		} catch (err) {
			setPromptSubmission(null);
			setError(
				err instanceof Error
					? err.message
					: "定型プロンプトを送信できませんでした。",
			);
		}
	};
	const promptActions = (
		<ReviewPromptActions
			onSubmit={onSubmitReviewPrompt ? submitReviewPrompt : undefined}
			disabled={
				isReviewPromptDisabled ||
				busySection !== null ||
				promptSubmission !== null
			}
			busyActionId={promptSubmission?.actionId ?? null}
			pendingPhase={promptSubmission?.phase ?? null}
			disabledStatusMessage={
				isReviewPromptDisabled
					? "Coding Agentの結果が確定するまで操作できません。"
					: busySection
						? "別の操作が完了するまで操作できません。"
						: null
			}
		/>
	);
	if (!detail) {
		return (
			<div className="nightworkers-review-status h-full overflow-auto bg-slate-950 p-5 text-slate-100">
				<div className="mx-auto grid max-w-5xl gap-4">
					{promptActions}
					{loading ? (
						<div className="text-center text-xs text-slate-500">
							{t("reviewStatus.loading")}
						</div>
					) : null}
					{error ? (
						<div className="rounded border border-red-800 bg-red-950/40 px-3 py-2 text-xs text-red-100">
							{error}
						</div>
					) : null}
				</div>
			</div>
		);
	}
	const status = detail.statusArtifact;
	const level = status.recommendation.level;
	const levelClass =
		level === "required"
			? "border-red-500/60 bg-red-950/30 text-red-100"
			: level === "recommended"
				? "border-amber-500/60 bg-amber-950/30 text-amber-100"
				: "border-cyan-500/60 bg-cyan-950/30 text-cyan-100";
	const latestReviewRun = reviewRunPayload(
		latestArtifactByKind(detail.artifacts, "review_run"),
	);
	const resolvedReviewRunStatus = reviewRunResolvedStatus(
		latestReviewRun,
		latestRun,
	);
	const reviewCompleted =
		resolvedReviewRunStatus === "done" ||
		["approved", "changes_requested", "cancelled"].includes(
			detail.session.status,
		);
	const latestSecurityReview = latestArtifactByKind(
		detail.artifacts,
		"security_review",
	);
	const reviewRunFindings =
		latestReviewRun?.findings?.map((finding) => ({
			id: `${finding.severity}-${finding.title}-${finding.path ?? ""}`,
			severity: finding.severity,
			title: finding.title,
			body: finding.body ?? null,
			filePath: finding.path ?? null,
		})) ?? [];
	const visibleFindings =
		detail.findings.length > 0
			? detail.findings.map((finding) => ({
					id: finding.id,
					severity: finding.severity,
					title: finding.title,
					body: finding.body,
					filePath: null,
				}))
			: reviewRunFindings;
	const isArchivedTask = activeTaskStatus === "archived";
	const taskArchiveBusy = busySection === "task_archive";
	const taskArchiveAction = isArchivedTask
		? {
				label: "アクティブタスクに戻す",
				description:
					"このタスクを以前の完了状態へ戻します。実装の再開は別の Reopen 操作で行います。",
				icon: <ArchiveRestore className="h-3.5 w-3.5" />,
				buttonClass: reviewPrimaryActionButtonClass,
				disabled:
					!onRestoreArchivedTask ||
					busySection !== null ||
					isReviewPromptDisabled,
				run: () => onRestoreArchivedTask?.(detail.session.taskId),
			}
		: {
				label: "完了してアーカイブ",
				description:
					"このレビュー対象タスクを完全に完了したものとして扱い、アーカイブタスクへ移動します。",
				icon: <Archive className="h-3.5 w-3.5" />,
				buttonClass: reviewSuccessActionButtonClass,
				disabled:
					!onCompleteAndArchiveTask ||
					busySection !== null ||
					isReviewPromptDisabled,
				run: () => onCompleteAndArchiveTask?.(detail.session.taskId),
			};
	return (
		<div
			className="nightworkers-review-status h-full overflow-auto bg-slate-950 p-5 text-slate-100"
			data-artifact-export-expand
		>
			<div className="mx-auto grid max-w-5xl gap-5">
				{promptActions}
				<div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-800 pb-4">
					<div>
						<div className="text-xs leading-5 text-slate-400">
							{t("reviewStatus.runRemains")}{" "}
							{detail.session.status === "approved"
								? t("reviewStatus.sessionState.approved")
								: t("reviewStatus.sessionState.executionUnchanged")}
							.
						</div>
					</div>
					{reviewCompleted ? null : (
						<span
							className={`rounded border px-2.5 py-1 text-xs font-medium ${levelClass}`}
						>
							{reviewStatusValueLabel(t, "level", level)}
						</span>
					)}
				</div>

				<div
					className="grid gap-3 rounded border border-slate-800 bg-slate-900/50 p-3"
					data-review-section="review-run"
				>
					<div className="flex flex-wrap items-start justify-between gap-3">
						<div className="min-w-0">
							<div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
								<ClipboardCheck className="h-4 w-4 text-cyan-200" />
								Review Run
							</div>
							{latestReviewRun ? (
								<div className="mt-1 flex flex-wrap gap-1.5 text-[11px] text-slate-300">
									<span className="rounded border border-slate-700 px-2 py-0.5">
										targets {latestReviewRun.target.targetFiles?.length ?? 0}
									</span>
									<span className="rounded border border-slate-700 px-2 py-0.5">
										excluded{" "}
										{latestReviewRun.target.excludedDirtyFiles?.length ?? 0}
									</span>
									<span className="rounded border border-slate-700 px-2 py-0.5">
										todos {latestReviewRun.todos.length}
									</span>
								</div>
							) : null}
						</div>
					</div>
					{latestReviewRun?.warnings.length ? (
						<div className="grid gap-1 text-xs text-amber-100">
							{latestReviewRun.warnings.slice(0, 4).map((warning) => (
								<div
									key={`${warning.code}-${warning.message}`}
									className="rounded border border-amber-800/70 bg-amber-950/30 px-2 py-1"
								>
									{warning.message}
								</div>
							))}
						</div>
					) : null}
					<ReviewRunResultPanel
						reviewRun={latestReviewRun}
						visibleFindings={visibleFindings}
						securityArtifact={latestSecurityReview}
					/>
				</div>

				<ReviewGitIntegrationPanel
					gitCloseout={gitCloseout ?? null}
					onCommitGitCloseout={onCommitGitCloseout}
					onPushGitCloseout={onPushGitCloseout}
					onError={setError}
					disabled={
						isReviewPromptDisabled ||
						(busySection !== null && busySection !== "git")
					}
					onBusyChange={handleGitBusyChange}
				/>

				{detail.securityHandoffs.length > 0 ? (
					<div className="grid gap-3">
						<div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
							{t("reviewStatus.securityHandoffs")}
						</div>
						<div className="grid gap-2">
							{detail.securityHandoffs.map((handoff) => (
								<div
									key={handoff.id}
									className="grid gap-2 rounded border border-slate-800 bg-slate-900/60 p-3"
								>
									<div className="flex flex-wrap items-center gap-2">
										<ShieldAlert className="h-3.5 w-3.5 text-amber-300" />
										<span className="text-sm font-medium text-slate-100">
											{handoff.title}
										</span>
										<span className="rounded border border-slate-700 px-2 py-0.5 text-[11px] text-slate-300">
											{reviewStatusValueLabel(
												t,
												"securityHandoffStatus",
												handoff.status,
											)}
										</span>
									</div>
									<div className="text-xs leading-5 text-slate-400">
										{handoff.summary}
									</div>
									{handoff.changedPaths.length > 0 ? (
										<div className="font-mono text-[11px] text-slate-500">
											{handoff.changedPaths.join(", ")}
										</div>
									) : null}
								</div>
							))}
						</div>
					</div>
				) : null}

				{error ? (
					<div className="rounded border border-red-800 bg-red-950/40 px-3 py-2 text-xs text-red-100">
						{error}
					</div>
				) : null}

				<div className="flex flex-wrap items-center justify-between gap-3 rounded border border-slate-800 bg-slate-900/60 px-3 py-3">
					<div className="min-w-0 text-xs">
						<div className="font-medium text-slate-100">
							レビュー後のタスク状態
						</div>
						<div className="mt-1 leading-5 text-slate-400">
							{taskArchiveAction.description}
						</div>
					</div>
					<button
						type="button"
						className={taskArchiveAction.buttonClass}
						disabled={taskArchiveAction.disabled}
						onClick={async () => {
							setBusySection("task_archive");
							setError(null);
							try {
								await taskArchiveAction.run();
							} catch (err) {
								setError(
									err instanceof Error
										? err.message
										: "Task status could not be updated.",
								);
							} finally {
								setBusySection(null);
							}
						}}
					>
						{taskArchiveBusy ? (
							<LoaderCircle className="h-3.5 w-3.5 animate-spin" />
						) : (
							taskArchiveAction.icon
						)}
						{taskArchiveAction.label}
					</button>
				</div>
			</div>
		</div>
	);
}
