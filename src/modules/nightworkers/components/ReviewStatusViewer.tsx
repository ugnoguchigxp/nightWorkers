import type { TFunction } from "i18next";
import {
	Archive,
	ArchiveRestore,
	ClipboardCheck,
	GitCommitHorizontal,
	LoaderCircle,
	Play,
	ShieldAlert,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type {
	GitCloseoutState,
	ReviewArtifact,
	ReviewRunArtifactPayload,
	ReviewRunOptions,
	ReviewSessionDetail,
} from "../types";

type ReviewStatusViewerProps = {
	detail: ReviewSessionDetail | null;
	onStartReviewRun?: (
		reviewSessionId: string,
		options: Partial<ReviewRunOptions>,
	) => Promise<ReviewSessionDetail>;
	gitCloseout?: GitCloseoutState | null;
	onCommitGitCloseout?: (runId: string) => Promise<GitCloseoutState>;
	activeTaskStatus?: string | null;
	onCompleteAndArchiveTask?: (taskId: string) => Promise<unknown>;
	onRestoreArchivedTask?: (taskId: string) => Promise<unknown>;
};

const defaultReviewRunOptions: ReviewRunOptions = {
	codeReview: true,
	securityReview: false,
	applyFixes: true,
	commitChanges: false,
};

const reviewRunOptionDescriptions: Array<{
	key: keyof ReviewRunOptions;
	label: string;
	description: string;
}> = [
	{
		key: "codeReview",
		label: "コードレビュー",
		description:
			"実装計画、対象 diff、変更ファイルを照合し、仕様漏れ・副作用・設計上の危険箇所を確認します。既存の個別レビュー項目を横断する基本チェックです。",
	},
	{
		key: "securityReview",
		label: "セキュリティレビュー",
		description:
			"vulnWorkbench を使って Semgrep、Gitleaks、OSV、Trivy、scan profile、DAST、reproduction、dynamic verification を bounded CLI 実行します。",
	},
	{
		key: "applyFixes",
		label: "修正を適用",
		description:
			"ReviewRun がコードレビューまたはセキュリティレビューで安全に自動修正できる内容だけをその場で反映します。",
	},
	{
		key: "commitChanges",
		label: "コミット",
		description:
			"ReviewRun が対象として確定した変更だけを commit します。対象抽出が人の確認待ち、または blocking warning がある場合は選択できません。",
	},
];

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

const reviewActionButtonBaseClass =
	"inline-flex h-8 items-center justify-center gap-1.5 rounded border px-3 text-xs font-semibold shadow-sm transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:shadow-none";
const reviewPrimaryActionButtonClass = `${reviewActionButtonBaseClass} nightworkers-primary-action-button`;
const reviewSuccessActionButtonClass = `${reviewActionButtonBaseClass} nightworkers-success-action-button`;

export function ReviewStatusViewer({
	detail,
	onStartReviewRun,
	gitCloseout,
	onCommitGitCloseout,
	activeTaskStatus,
	onCompleteAndArchiveTask,
	onRestoreArchivedTask,
}: ReviewStatusViewerProps) {
	const { t } = useTranslation();
	const [busySection, setBusySection] = useState<string | null>(null);
	const [reviewRunOptions, setReviewRunOptions] = useState<ReviewRunOptions>(
		defaultReviewRunOptions,
	);
	const [error, setError] = useState<string | null>(null);
	if (!detail) {
		return (
			<div className="flex h-full items-center justify-center text-xs text-slate-500">
				{t("reviewStatus.unavailable")}
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
	const reviewRunInProgress =
		busySection === "review_run" || latestReviewRun?.status === "running";
	const reviewCompleted =
		latestReviewRun?.status === "done" ||
		["approved", "changes_requested", "cancelled"].includes(
			detail.session.status,
		);
	const latestTargets = latestArtifactByKind(
		detail.artifacts,
		"review_targets",
	);
	const canSelectCommit =
		latestTargets?.status !== "needs_human" &&
		!latestReviewRun?.warnings.some(
			(warning) => warning.severity === "blocking",
		);
	const commitAlreadyDone =
		gitCloseout?.state === "committed" ||
		gitCloseout?.state === "push_ready" ||
		gitCloseout?.state === "pushed";
	const canCommitReviewedRun =
		Boolean(gitCloseout?.canCommit) &&
		!commitAlreadyDone &&
		busySection !== "git_commit";
	const commitButtonDisabled = !onCommitGitCloseout || !canCommitReviewedRun;
	const commitButtonTitle = commitAlreadyDone
		? "この run は既にコミット済みです。"
		: gitCloseout?.blockingReason;
	const isArchivedTask =
		activeTaskStatus === "cancelled" || activeTaskStatus === "failed";
	const taskArchiveBusy = busySection === "task_archive";
	const taskArchiveAction = isArchivedTask
		? {
				label: "アクティブタスクに戻す",
				description:
					"このタスクを ready に戻し、通常のアクティブタスクとして再開できる状態にします。",
				icon: <ArchiveRestore className="h-3.5 w-3.5" />,
				buttonClass: reviewPrimaryActionButtonClass,
				disabled: !onRestoreArchivedTask || taskArchiveBusy,
				run: () => onRestoreArchivedTask?.(detail.session.taskId),
			}
		: {
				label: "完了してアーカイブ",
				description:
					"このレビュー対象タスクを完全に完了したものとして扱い、アーカイブタスクへ移動します。",
				icon: <Archive className="h-3.5 w-3.5" />,
				buttonClass: reviewSuccessActionButtonClass,
				disabled: !onCompleteAndArchiveTask || taskArchiveBusy,
				run: () => onCompleteAndArchiveTask?.(detail.session.taskId),
			};
	return (
		<div className="nightworkers-review-status h-full overflow-auto bg-slate-950 p-5 text-slate-100">
			<div className="mx-auto grid max-w-5xl gap-5">
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

				<div className="grid gap-3 rounded border border-slate-800 bg-slate-900/50 p-3">
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
						<button
							type="button"
							className={`nightworkers-review-run-button ${reviewPrimaryActionButtonClass}`}
							disabled={!onStartReviewRun || reviewRunInProgress}
							onClick={async () => {
								if (!onStartReviewRun || reviewRunInProgress) return;
								setBusySection("review_run");
								setError(null);
								try {
									await onStartReviewRun(detail.session.id, reviewRunOptions);
								} catch (err) {
									setError(
										err instanceof Error
											? err.message
											: "Review Run could not start.",
									);
								} finally {
									setBusySection(null);
								}
							}}
						>
							{reviewRunInProgress ? (
								<LoaderCircle className="h-3.5 w-3.5 animate-spin" />
							) : (
								<Play className="h-3.5 w-3.5" />
							)}
							Run
						</button>
					</div>
					<div className="grid gap-2">
						{reviewRunOptionDescriptions.map(({ key, label, description }) => {
							const disabled = key === "commitChanges" && !canSelectCommit;
							return (
								<label
									key={key}
									className={`grid cursor-pointer grid-cols-[auto_minmax(0,1fr)] gap-x-3 rounded border border-slate-800 bg-slate-950/40 px-3 py-2 text-xs text-slate-200 ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
								>
									<input
										type="checkbox"
										className="mt-0.5 h-3.5 w-3.5 accent-cyan-400"
										checked={reviewRunOptions[key]}
										disabled={disabled}
										onChange={(event) =>
											setReviewRunOptions((prev) => ({
												...prev,
												[key]: event.target.checked,
											}))
										}
									/>
									<span className="grid gap-1">
										<span className="font-medium text-slate-100">{label}</span>
										<span className="leading-5 text-slate-400">
											{description}
										</span>
									</span>
								</label>
							);
						})}
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
					<div className="flex flex-wrap items-center justify-between gap-3 rounded border border-slate-800 bg-slate-950/40 px-3 py-2">
						<div className="min-w-0 text-xs">
							<div className="font-medium text-slate-100">手動コミット</div>
							<div className="mt-1 text-slate-400">
								対象 {gitCloseout?.counts.stageablePaths ?? 0} 件 / 除外{" "}
								{gitCloseout?.counts.excludedPaths ?? 0} 件 /{" "}
								{gitCloseout?.state ?? "未確認"}
							</div>
						</div>
						<button
							type="button"
							className={reviewSuccessActionButtonClass}
							title={commitButtonTitle ?? undefined}
							disabled={commitButtonDisabled}
							onClick={async () => {
								if (!onCommitGitCloseout || !canCommitReviewedRun) return;
								setBusySection("git_commit");
								setError(null);
								try {
									await onCommitGitCloseout(detail.session.runId);
								} catch (err) {
									setError(
										err instanceof Error
											? err.message
											: "Git commit could not be created.",
									);
								} finally {
									setBusySection(null);
								}
							}}
						>
							{busySection === "git_commit" ? (
								<LoaderCircle className="h-3.5 w-3.5 animate-spin" />
							) : (
								<GitCommitHorizontal className="h-3.5 w-3.5" />
							)}
							{commitAlreadyDone ? "コミット済み" : "LLMメッセージでコミット"}
						</button>
					</div>
				</div>

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
