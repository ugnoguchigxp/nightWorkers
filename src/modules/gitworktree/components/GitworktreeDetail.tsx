import { GitCompare, Sparkles, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type {
	WorktreeAdviceResponse,
	WorktreeSummary,
} from "../../../../shared/schemas/gitworktree.schema";
import { worktreeStatusLabelKey } from "../model/gitworktreeViewModel";
import {
	controlStyle,
	mutedTextStyle,
	panelStyle,
	primaryButtonStyle,
	tableBorderStyle,
} from "./gitworktreeStyles";

type GitworktreeDetailProps = {
	selected: WorktreeSummary | null;
	busy: boolean;
	showTask: boolean;
	taskTitle: string;
	advice: WorktreeAdviceResponse | null;
	onViewDiff: () => void;
	onRequestAdvice: () => void;
	onToggleTask: () => void;
	onRemove: () => void;
	onTaskTitleChange: (value: string) => void;
	onSubmitTask: () => void;
};

export function GitworktreeDetail({
	selected,
	busy,
	showTask,
	taskTitle,
	advice,
	onViewDiff,
	onRequestAdvice,
	onToggleTask,
	onRemove,
	onTaskTitleChange,
	onSubmitTask,
}: GitworktreeDetailProps) {
	const { t } = useTranslation();
	if (!selected) {
		return (
			<div className="border p-4" style={panelStyle}>
				<p className="text-sm" style={mutedTextStyle}>
					{t("projectDetail.worktrees.empty")}
				</p>
			</div>
		);
	}
	return (
		<div className="border p-4" style={panelStyle}>
			<div className="space-y-4">
				<div
					className="flex items-start justify-between gap-3 border-b pb-3"
					style={tableBorderStyle}
				>
					<div>
						<h2 className="font-semibold">
							{selected.branch || t("projectDetail.worktrees.detached")}
						</h2>
						<p className="mt-1 break-all text-xs" style={mutedTextStyle}>
							{selected.path}
						</p>
					</div>
					<span className="nightworkers-chip">
						{t(worktreeStatusLabelKey(selected))}
					</span>
				</div>
				<dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 text-xs">
					<dt style={mutedTextStyle}>HEAD</dt>
					<dd className="break-all font-mono">{selected.head || "—"}</dd>
					<dt style={mutedTextStyle}>
						{t("projectDetail.worktrees.latestCommit")}
					</dt>
					<dd>{selected.headSubject || "—"}</dd>
					<dt style={mutedTextStyle}>
						{t("projectDetail.worktrees.upstream")}
					</dt>
					<dd>{selected.upstream || "—"}</dd>
					<dt style={mutedTextStyle}>{t("projectDetail.worktrees.sync")}</dt>
					<dd>
						{t("projectDetail.worktrees.aheadBehind", {
							ahead: selected.ahead,
							behind: selected.behind,
						})}
					</dd>
					<dt style={mutedTextStyle}>{t("projectDetail.worktrees.changes")}</dt>
					<dd>
						{t("projectDetail.worktrees.changeCounts", {
							staged: selected.stagedCount,
							modified: selected.modifiedCount,
							untracked: selected.untrackedCount,
							conflicted: selected.conflictedCount,
						})}
					</dd>
					<dt style={mutedTextStyle}>{t("projectDetail.worktrees.usage")}</dt>
					<dd>
						{t("projectDetail.worktrees.usageCounts", {
							tasks: selected.usage.activeTaskCount,
							runs: selected.usage.activeRunCount,
						})}
					</dd>
				</dl>
				{selected.removeBlockers.length > 0 ? (
					<div
						className="border px-3 py-2 text-xs"
						style={{ ...controlStyle, color: "var(--nw-warning)" }}
					>
						{selected.removeBlockers
							.map((blocker) => t(`projectDetail.worktrees.blocker.${blocker}`))
							.join(" / ")}
					</div>
				) : null}
				<div className="flex flex-wrap gap-2">
					<button
						type="button"
						className="inline-flex h-8 items-center gap-2 border px-3 text-xs"
						style={controlStyle}
						disabled={busy}
						onClick={onViewDiff}
					>
						<GitCompare className="h-3.5 w-3.5" aria-hidden="true" />
						{t("projectDetail.worktrees.viewDiff")}
					</button>
					<button
						type="button"
						className="inline-flex h-8 items-center gap-2 border px-3 text-xs"
						style={controlStyle}
						disabled={busy}
						onClick={onRequestAdvice}
					>
						<Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
						{t("projectDetail.worktrees.summarize")}
					</button>
					<button
						type="button"
						className="h-8 border px-3 text-xs"
						style={controlStyle}
						disabled={busy}
						onClick={onToggleTask}
					>
						{t("projectDetail.worktrees.createTask")}
					</button>
					<button
						type="button"
						className="inline-flex h-8 items-center gap-2 border px-3 text-xs"
						style={{ ...controlStyle, color: "var(--nw-danger)" }}
						disabled={busy || !selected.canRemove || !selected.head}
						onClick={onRemove}
					>
						<Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
						{t("projectDetail.worktrees.remove")}
					</button>
				</div>
				{showTask ? (
					<form
						className="flex flex-wrap gap-2"
						onSubmit={(event) => {
							event.preventDefault();
							onSubmitTask();
						}}
					>
						<input
							className="h-8 min-w-[220px] flex-1 border px-2 text-xs"
							style={controlStyle}
							disabled={busy}
							required
							value={taskTitle}
							placeholder={t("projectDetail.worktrees.taskTitlePlaceholder")}
							onChange={(event) => onTaskTitleChange(event.target.value)}
						/>
						<button
							type="submit"
							className="h-8 border px-3 text-xs"
							style={primaryButtonStyle}
							disabled={busy}
						>
							{t("projectDetail.worktrees.confirmTask")}
						</button>
					</form>
				) : null}
				{advice ? (
					<div className="border p-3 text-xs" style={controlStyle}>
						{advice.summary}
					</div>
				) : null}
			</div>
		</div>
	);
}
