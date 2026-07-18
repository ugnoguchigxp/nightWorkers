import {
	GitCommitHorizontal,
	GitMerge,
	LoaderCircle,
	RefreshCw,
	Upload,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
	deferRunGitMerge,
	executeRunGitMerge,
	overrideRunGitMergeTarget,
	previewRunGitMerge,
	reworkRunGitMerge,
} from "../../nightworkers/nightWorkersCommands";
import type { GitCloseoutState } from "../../nightworkers/types/core";

const buttonClass =
	"inline-flex h-8 items-center justify-center gap-1.5 rounded border px-3 text-xs font-semibold shadow-sm transition disabled:cursor-not-allowed disabled:shadow-none";

function pushStatusLabel(state: GitCloseoutState) {
	const status =
		state.mergeRecord?.status === "merged"
			? state.mergeRecord.targetPushStatus
			: state.commitRecord?.pushStatus;
	if (status === "pushed") return "Push済み";
	if (status === "pushing" || state.state === "push_running") return "Push中";
	if (status === "failed") return "Push失敗";
	if (status === "blocked") return "Push不可";
	return state.canPush ? "Push可能" : "未Push";
}

function mergeStatusLabel(
	record: NonNullable<GitCloseoutState["mergeRecord"]>,
) {
	return {
		decision_required: "確認待ち",
		previewing: "確認中",
		merge_ready: "マージ可能",
		merging: "マージ中",
		merged: "マージ済み",
		deferred: "保留中",
		rework_requested: "再作業",
		merge_blocked: "マージ不可",
		merge_conflicted: "競合あり",
		failed: "失敗",
	}[record.status];
}

export function ReviewGitIntegrationPanel({
	gitCloseout: externalState,
	onCommitGitCloseout,
	onPushGitCloseout,
	onError,
	disabled = false,
	onBusyChange,
}: {
	gitCloseout: GitCloseoutState | null;
	onCommitGitCloseout?: (runId: string) => Promise<GitCloseoutState>;
	onPushGitCloseout?: (runId: string) => Promise<GitCloseoutState>;
	onError: (message: string | null) => void;
	disabled?: boolean;
	onBusyChange?: (busy: boolean) => void;
}) {
	const [state, setState] = useState(externalState);
	const [busyAction, setBusyAction] = useState<string | null>(null);
	useEffect(() => setState(externalState), [externalState]);
	useEffect(() => {
		onBusyChange?.(busyAction !== null);
		return () => onBusyChange?.(false);
	}, [busyAction, onBusyChange]);

	const record = state?.mergeRecord ?? null;
	const commitDone =
		Boolean(record) ||
		state?.commitRecord?.status === "committed" ||
		["committed", "push_ready", "push_running", "pushed"].includes(
			state?.state ?? "",
		);
	const pushDone =
		record?.status === "merged"
			? record.targetPushStatus === "pushed"
			: state?.commitRecord?.pushStatus === "pushed";
	const pushBusy =
		busyAction === "push" ||
		(record?.status === "merged"
			? record.targetPushStatus === "pushing"
			: state?.commitRecord?.pushStatus === "pushing");
	const commitDisabled =
		disabled ||
		!state ||
		!state.canCommit ||
		!onCommitGitCloseout ||
		commitDone ||
		busyAction !== null;
	const pushDisabled =
		disabled ||
		!state ||
		!state.canPush ||
		!onPushGitCloseout ||
		pushDone ||
		pushBusy ||
		busyAction !== null;
	const mergeDisabled =
		disabled ||
		!record ||
		["merged", "merging", "rework_requested"].includes(record.status) ||
		busyAction !== null;

	const applyMergeAction = async (
		kind: "preview" | "defer" | "rework" | "merge",
	) => {
		if (!record || disabled) return;
		setBusyAction(kind);
		onError(null);
		try {
			const response =
				kind === "preview"
					? await previewRunGitMerge(record.runId, record.recordVersion)
					: kind === "defer"
						? await deferRunGitMerge(record.runId, record.recordVersion)
						: kind === "rework"
							? await reworkRunGitMerge(record.runId, record.recordVersion)
							: await executeRunGitMerge(record.runId, record.recordVersion);
			if (!response.ok) throw new Error(await response.text());
			const mergeRecord = await response.json();
			setState((current) => (current ? { ...current, mergeRecord } : current));
		} catch (error) {
			onError(error instanceof Error ? error.message : String(error));
		} finally {
			setBusyAction(null);
		}
	};

	const commit = async () => {
		if (!state || !onCommitGitCloseout || commitDisabled) return;
		setBusyAction("commit");
		onError(null);
		try {
			setState(await onCommitGitCloseout(state.runId));
		} catch (error) {
			onError(error instanceof Error ? error.message : String(error));
		} finally {
			setBusyAction(null);
		}
	};

	const arrangeMerge = async () => {
		if (!record || mergeDisabled) return;
		setBusyAction("merge");
		onError(null);
		try {
			let readyRecord = record;
			if (readyRecord.status !== "merge_ready") {
				const previewResponse = await previewRunGitMerge(
					readyRecord.runId,
					readyRecord.recordVersion,
				);
				if (!previewResponse.ok) throw new Error(await previewResponse.text());
				readyRecord = await previewResponse.json();
				setState((current) =>
					current ? { ...current, mergeRecord: readyRecord } : current,
				);
			}
			if (readyRecord.status !== "merge_ready") return;
			const mergeResponse = await executeRunGitMerge(
				readyRecord.runId,
				readyRecord.recordVersion,
			);
			if (!mergeResponse.ok) throw new Error(await mergeResponse.text());
			const mergeRecord = await mergeResponse.json();
			setState((current) => (current ? { ...current, mergeRecord } : current));
		} catch (error) {
			onError(error instanceof Error ? error.message : String(error));
		} finally {
			setBusyAction(null);
		}
	};

	const push = async () => {
		if (!state || !onPushGitCloseout || pushDisabled) return;
		setBusyAction("push");
		onError(null);
		try {
			setState(await onPushGitCloseout(state.runId));
		} catch (error) {
			onError(error instanceof Error ? error.message : String(error));
		} finally {
			setBusyAction(null);
		}
	};

	const changeTarget = async () => {
		if (!record || disabled) return;
		const targetBranch = window
			.prompt(
				"新しいlocal merge target branchを入力してください。previewとCI証跡は無効になります。",
				record.targetBranch,
			)
			?.trim();
		if (!targetBranch || targetBranch === record.targetBranch) return;
		if (!window.confirm(`merge targetを ${targetBranch} に変更しますか？`))
			return;
		setBusyAction("target");
		onError(null);
		try {
			const response = await overrideRunGitMergeTarget(
				record.runId,
				targetBranch,
				record.recordVersion,
			);
			if (!response.ok) throw new Error(await response.text());
			const mergeRecord = await response.json();
			setState((current) => (current ? { ...current, mergeRecord } : current));
		} catch (error) {
			onError(error instanceof Error ? error.message : String(error));
		} finally {
			setBusyAction(null);
		}
	};

	return (
		<div
			className="rounded border border-cyan-800/70 bg-cyan-950/20 p-3 text-xs"
			data-review-section="git-integration"
		>
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div>
					<div className="flex items-center gap-2 font-medium text-slate-100">
						<GitMerge className="h-4 w-4 text-cyan-200" />
						Git統合
					</div>
					<div className="mt-1 leading-5 text-slate-400">
						{record?.status === "merged"
							? "マージ済みの統合先ブランチを、設定済みのremoteまたはupstreamへPushします。"
							: record
								? "コミット済みの作業ブランチを必要に応じてPushし、確認済みのSHAを統合先へマージします。"
								: "コミット済みの変更を上流ブランチへPushします。"}
					</div>
				</div>
				<div className="flex flex-wrap gap-1.5 text-[11px]">
					<span className="rounded border border-emerald-700/70 bg-emerald-950/30 px-2 py-1 text-emerald-100">
						1. {commitDone ? "コミット済み" : "コミット待ち"}
					</span>
					<span className="rounded border border-slate-700 px-2 py-1 text-slate-300">
						2. {state ? pushStatusLabel(state) : "Git状態を確認中"}
					</span>
					{record ? (
						<span className="rounded border border-slate-700 px-2 py-1 text-slate-300">
							3. {mergeStatusLabel(record)}
						</span>
					) : null}
				</div>
			</div>

			<div className="mt-3 grid gap-2 lg:grid-cols-3">
				<div className="grid gap-2 rounded border border-slate-800 bg-slate-950/40 p-3">
					<div>
						<div className="font-medium text-slate-100">コミット</div>
						<div className="mt-1 leading-5 text-slate-400">
							対象ファイルからLLMがコミットメッセージを作成します。
						</div>
					</div>
					<button
						type="button"
						data-review-git-action="commit"
						className={`${buttonClass} nightworkers-success-action-button`}
						disabled={commitDisabled}
						onClick={() => void commit()}
					>
						{busyAction === "commit" ? (
							<LoaderCircle className="h-3.5 w-3.5 animate-spin" />
						) : (
							<GitCommitHorizontal className="h-3.5 w-3.5" />
						)}
						{commitDone ? "コミット済み" : "LLMメッセージでコミット"}
					</button>
				</div>

				<div className="grid gap-2 rounded border border-slate-800 bg-slate-950/40 p-3">
					<div>
						<div className="font-medium text-slate-100">マージ</div>
						<div className="mt-1 leading-5 text-slate-400">
							{record
								? `${record.sourceBranch} を ${record.targetBranch} へ安全確認後に統合します。`
								: "worktreeのコミット後に統合先とSHAを確定します。"}
						</div>
					</div>
					<button
						type="button"
						data-review-git-action="merge"
						className={`${buttonClass} nightworkers-success-action-button`}
						disabled={mergeDisabled}
						onClick={() => void arrangeMerge()}
					>
						{busyAction === "merge" ? (
							<LoaderCircle className="h-3.5 w-3.5 animate-spin" />
						) : (
							<GitMerge className="h-3.5 w-3.5" />
						)}
						{record?.status === "merged" ? "マージ済み" : "LLMにマージを手配"}
					</button>
				</div>

				<div className="grid gap-2 rounded border border-slate-800 bg-slate-950/40 p-3">
					<div>
						<div className="font-medium text-slate-100">Push</div>
						<div className="mt-1 break-all leading-5 text-slate-400">
							{record?.status === "merged"
								? `${record.targetBranch} → 設定済みremote/upstream`
								: `${state?.git.branch ?? "ブランチ未確定"} → ${state?.git.upstream ?? "upstream未設定"}`}
						</div>
					</div>
					<button
						type="button"
						data-review-git-action="push"
						className={`${buttonClass} nightworkers-primary-action-button`}
						disabled={pushDisabled}
						onClick={() => void push()}
					>
						{pushBusy ? (
							<LoaderCircle className="h-3.5 w-3.5 animate-spin" />
						) : (
							<Upload className="h-3.5 w-3.5" />
						)}
						{pushDone ? "Push済み" : "LLMにPushを手配"}
					</button>
				</div>
			</div>
			{state?.blockingReason && !state.canCommit && !state.canPush ? (
				<div className="mt-2 text-[11px] text-amber-200">
					{state.blockingReason}
				</div>
			) : null}

			{record ? (
				<div className="mt-3 rounded border border-slate-800 bg-slate-950/40 p-3">
					<div className="font-medium text-slate-200">統合先へマージ</div>
					<div className="mt-2 grid gap-1 text-slate-400 md:grid-cols-2">
						<span>
							Source: {record.sourceBranch} @{" "}
							{record.sourceCommitSha.slice(0, 10)}
						</span>
						<span>
							Target: {record.targetBranch} @{" "}
							{(record.observedTargetSha ?? record.targetSelectedSha).slice(
								0,
								10,
							)}
						</span>
						<span>Plan base: {record.planTargetBaseSha.slice(0, 10)}</span>
						<span>
							Status: {mergeStatusLabel(record)} / {record.strategy}
						</span>
					</div>
					{record.lastErrorMessage ? (
						<div className="mt-2 text-amber-200">{record.lastErrorMessage}</div>
					) : null}
					<div className="mt-3 flex flex-wrap gap-2">
						<button
							type="button"
							className={`${buttonClass} nightworkers-primary-action-button`}
							disabled={
								disabled || busyAction !== null || record.status === "merged"
							}
							onClick={() => void applyMergeAction("preview")}
						>
							<RefreshCw className="h-3.5 w-3.5" />
							再評価（マージ可否を確認）
						</button>
						<button
							type="button"
							className={buttonClass}
							disabled={
								disabled || busyAction !== null || record.status === "merged"
							}
							onClick={() => void applyMergeAction("defer")}
						>
							後で判断
						</button>
						<button
							type="button"
							className={buttonClass}
							disabled={
								disabled || busyAction !== null || record.status === "merged"
							}
							onClick={() => void applyMergeAction("rework")}
						>
							再作業
						</button>
						<button
							type="button"
							className={buttonClass}
							disabled={
								disabled || busyAction !== null || record.status === "merged"
							}
							onClick={() => void changeTarget()}
						>
							統合先を変更
						</button>
					</div>
				</div>
			) : null}
		</div>
	);
}
