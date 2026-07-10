import {
	AlertTriangle,
	GitBranch,
	GitCompare,
	Plus,
	RefreshCw,
	Sparkles,
	Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
	CreateWorktreeRequest,
	WorktreeAdviceResponse,
	WorktreeListResponse,
	WorktreeSummary,
} from "../../../../../shared/schemas/git-worktree.schema";
import {
	adviseRepositoryWorktrees,
	createRepositoryWorktree,
	createTask,
	fetchRepositoryWorktreeDiff,
	fetchRepositoryWorktrees,
	previewRepositoryWorktreePrune,
	pruneRepositoryWorktrees,
	removeRepositoryWorktree,
} from "../../nightWorkersCommands";
import type { Task } from "../../types";
import { readJsonResponse } from "./data";
import {
	controlStyle,
	mutedTextStyle,
	panelStyle,
	primaryButtonStyle,
	tableBorderStyle,
} from "./styles";

type ProjectDetailWorktreesProps = {
	repositoryId: string;
	onTaskCreated?: (task: Task) => Promise<void> | void;
};

type WorktreeDiff = {
	diff: string;
	diffStat: string;
	hasChanges: boolean;
	truncated: boolean;
};

export function worktreeHasChanges(worktree: WorktreeSummary) {
	return (
		worktree.stagedCount +
			worktree.modifiedCount +
			worktree.untrackedCount +
			worktree.conflictedCount >
		0
	);
}

export function worktreeStatusLabelKey(worktree: WorktreeSummary) {
	if (worktree.prunable) return "projectDetail.worktrees.status.prunable";
	if (worktree.locked) return "projectDetail.worktrees.status.locked";
	if (worktree.conflictedCount > 0)
		return "projectDetail.worktrees.status.conflicted";
	if (worktreeHasChanges(worktree))
		return "projectDetail.worktrees.status.changed";
	return "projectDetail.worktrees.status.clean";
}

function defaultCreateDraft(): CreateWorktreeRequest {
	return { mode: "new_branch", branchName: "", startPoint: "HEAD" };
}

export function ProjectDetailWorktrees({
	repositoryId,
	onTaskCreated,
}: ProjectDetailWorktreesProps) {
	const { t } = useTranslation();
	const [data, setData] = useState<WorktreeListResponse | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [busy, setBusy] = useState<string | null>(null);
	const [showCreate, setShowCreate] = useState(false);
	const [createDraft, setCreateDraft] =
		useState<CreateWorktreeRequest>(defaultCreateDraft);
	const [showTask, setShowTask] = useState(false);
	const [taskTitle, setTaskTitle] = useState("");
	const [diff, setDiff] = useState<WorktreeDiff | null>(null);
	const [advice, setAdvice] = useState<WorktreeAdviceResponse | null>(null);

	const load = useCallback(async () => {
		setError("");
		setLoading(true);
		try {
			const next = await readJsonResponse<WorktreeListResponse>(
				await fetchRepositoryWorktrees(repositoryId),
			);
			setData(next);
			setSelectedId((current) => {
				if (current && next.worktrees.some((item) => item.id === current))
					return current;
				return (
					next.worktrees.find((item) => item.isBase)?.id ||
					next.worktrees[0]?.id ||
					null
				);
			});
		} catch (loadError) {
			setError(
				loadError instanceof Error ? loadError.message : String(loadError),
			);
		} finally {
			setLoading(false);
		}
	}, [repositoryId]);

	useEffect(() => {
		void load();
	}, [load]);

	const selected = useMemo(
		() => data?.worktrees.find((item) => item.id === selectedId) || null,
		[data, selectedId],
	);
	const runningCount =
		data?.worktrees.filter(
			(item) => item.usage.activeTaskCount + item.usage.activeRunCount > 0,
		).length || 0;
	const attentionCount =
		data?.worktrees.filter(
			(item) => item.removeBlockers.length > 0 && !item.isBase,
		).length || 0;

	const runAction = async (name: string, action: () => Promise<void>) => {
		setBusy(name);
		setError("");
		try {
			await action();
		} catch (actionError) {
			setError(
				actionError instanceof Error
					? actionError.message
					: String(actionError),
			);
		} finally {
			setBusy(null);
		}
	};

	if (loading && !data) {
		return (
			<div className="p-6 text-sm">{t("projectDetail.worktrees.loading")}</div>
		);
	}
	if (data && !data.git.available) {
		return (
			<section className="border p-8 text-center" style={panelStyle}>
				<AlertTriangle className="mx-auto mb-3 h-6 w-6" aria-hidden="true" />
				<h2 className="font-semibold">
					{t("projectDetail.worktrees.gitMissingTitle")}
				</h2>
				<p className="mt-2 text-sm" style={mutedTextStyle}>
					{t("projectDetail.worktrees.gitMissingBody")}
				</p>
			</section>
		);
	}
	if (data && !data.repository.available) {
		return (
			<section className="border p-8 text-center" style={panelStyle}>
				<AlertTriangle className="mx-auto mb-3 h-6 w-6" aria-hidden="true" />
				<h2 className="font-semibold">
					{t("projectDetail.worktrees.repositoryMissingTitle")}
				</h2>
				<p className="mt-2 text-sm" style={mutedTextStyle}>
					{t("projectDetail.worktrees.repositoryMissingBody")}
				</p>
			</section>
		);
	}

	return (
		<section className="space-y-4">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div className="flex flex-wrap items-center gap-2 text-xs">
					<span className="nightworkers-chip">
						{data?.worktrees.length || 0} worktrees
					</span>
					<span className="nightworkers-chip">
						{t("projectDetail.worktrees.runningCount", { count: runningCount })}
					</span>
					<span className="nightworkers-chip">
						{t("projectDetail.worktrees.attentionCount", {
							count: attentionCount,
						})}
					</span>
					{data?.refreshedAt ? (
						<span style={mutedTextStyle}>
							{t("projectDetail.worktrees.refreshedAt", {
								value: new Date(data.refreshedAt).toLocaleTimeString(),
							})}
						</span>
					) : null}
				</div>
				<div className="flex flex-wrap gap-2">
					<button
						type="button"
						className="inline-flex h-8 items-center gap-2 border px-3 text-xs"
						style={controlStyle}
						disabled={Boolean(busy)}
						onClick={() => void load()}
					>
						<RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
						{t("projectDetail.worktrees.refresh")}
					</button>
					<button
						type="button"
						className="inline-flex h-8 items-center gap-2 border px-3 text-xs font-medium"
						style={primaryButtonStyle}
						disabled={Boolean(busy)}
						onClick={() => setShowCreate((value) => !value)}
					>
						<Plus className="h-3.5 w-3.5" aria-hidden="true" />
						{t("projectDetail.worktrees.create")}
					</button>
				</div>
			</div>

			{error ? (
				<div
					className="border px-3 py-2 text-xs"
					style={{ ...panelStyle, color: "var(--nw-danger)" }}
				>
					{error}
				</div>
			) : null}

			{showCreate ? (
				<form
					className="grid gap-3 border p-4 md:grid-cols-2"
					style={panelStyle}
					onSubmit={(event) => {
						event.preventDefault();
						void runAction("create", async () => {
							const created = await readJsonResponse<WorktreeSummary>(
								await createRepositoryWorktree(repositoryId, createDraft),
							);
							setShowCreate(false);
							setCreateDraft(defaultCreateDraft());
							await load();
							setSelectedId(created.id);
						});
					}}
				>
					<label className="space-y-1 text-xs">
						<span>{t("projectDetail.worktrees.createMode")}</span>
						<select
							className="h-9 w-full border px-2"
							style={controlStyle}
							value={createDraft.mode}
							onChange={(event) =>
								setCreateDraft(
									event.target.value === "existing_branch"
										? {
												mode: "existing_branch",
												branchName: createDraft.branchName,
											}
										: {
												mode: "new_branch",
												branchName: createDraft.branchName,
												startPoint: "HEAD",
											},
								)
							}
						>
							<option value="new_branch">
								{t("projectDetail.worktrees.newBranch")}
							</option>
							<option value="existing_branch">
								{t("projectDetail.worktrees.existingBranch")}
							</option>
						</select>
					</label>
					<label className="space-y-1 text-xs">
						<span>{t("projectDetail.worktrees.branchName")}</span>
						<input
							className="h-9 w-full border px-2"
							style={controlStyle}
							required
							value={createDraft.branchName}
							onChange={(event) =>
								setCreateDraft({
									...createDraft,
									branchName: event.target.value,
								})
							}
						/>
					</label>
					{createDraft.mode === "new_branch" ? (
						<label className="space-y-1 text-xs">
							<span>{t("projectDetail.worktrees.startPoint")}</span>
							<input
								className="h-9 w-full border px-2"
								style={controlStyle}
								required
								value={createDraft.startPoint}
								onChange={(event) =>
									setCreateDraft({
										...createDraft,
										startPoint: event.target.value,
									})
								}
							/>
						</label>
					) : null}
					<label className="space-y-1 text-xs">
						<span>{t("projectDetail.worktrees.pathOptional")}</span>
						<input
							className="h-9 w-full border px-2"
							style={controlStyle}
							value={createDraft.path || ""}
							onChange={(event) =>
								setCreateDraft({
									...createDraft,
									path: event.target.value || undefined,
								})
							}
						/>
					</label>
					<div className="flex gap-2 md:col-span-2">
						<button
							type="submit"
							className="h-8 border px-3 text-xs"
							style={primaryButtonStyle}
						>
							{busy === "create"
								? t("projectDetail.worktrees.creating")
								: t("projectDetail.worktrees.confirmCreate")}
						</button>
						<button
							type="button"
							className="h-8 border px-3 text-xs"
							style={controlStyle}
							onClick={() => setShowCreate(false)}
						>
							{t("projectDetail.worktrees.cancel")}
						</button>
					</div>
				</form>
			) : null}

			<div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(300px,0.8fr)]">
				<div className="overflow-hidden border" style={panelStyle}>
					<div
						className="border-b px-3 py-2 text-sm font-medium"
						style={tableBorderStyle}
					>
						{t("projectDetail.worktrees.list")}
					</div>
					<div className="divide-y" style={tableBorderStyle}>
						{data?.worktrees.map((worktree) => {
							const active = worktree.id === selectedId;
							return (
								<button
									type="button"
									key={worktree.id}
									className="grid w-full gap-2 px-3 py-3 text-left text-xs md:grid-cols-[minmax(0,1fr)_auto_auto]"
									style={{
										background: active
											? "color-mix(in srgb, var(--nw-primary) 10%, var(--nw-panel))"
											: "transparent",
									}}
									aria-pressed={active}
									onClick={() => {
										setSelectedId(worktree.id);
										setDiff(null);
										setAdvice(null);
									}}
								>
									<span className="min-w-0">
										<span className="flex items-center gap-2 font-medium">
											<GitBranch className="h-3.5 w-3.5" aria-hidden="true" />
											<span className="truncate">
												{worktree.branch ||
													t("projectDetail.worktrees.detached")}
											</span>
											{worktree.isBase ? (
												<span className="nightworkers-chip">
													{t("projectDetail.worktrees.base")}
												</span>
											) : null}
										</span>
										<span
											className="mt-1 block truncate"
											style={mutedTextStyle}
										>
											{worktree.path}
										</span>
									</span>
									<span>{t(worktreeStatusLabelKey(worktree))}</span>
									<span className="font-mono">
										{worktree.head?.slice(0, 8) || "—"}
									</span>
								</button>
							);
						})}
					</div>
				</div>

				<div className="border p-4" style={panelStyle}>
					{selected ? (
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
								<dt style={mutedTextStyle}>
									{t("projectDetail.worktrees.sync")}
								</dt>
								<dd>
									{t("projectDetail.worktrees.aheadBehind", {
										ahead: selected.ahead,
										behind: selected.behind,
									})}
								</dd>
								<dt style={mutedTextStyle}>
									{t("projectDetail.worktrees.changes")}
								</dt>
								<dd>
									{t("projectDetail.worktrees.changeCounts", {
										staged: selected.stagedCount,
										modified: selected.modifiedCount,
										untracked: selected.untrackedCount,
										conflicted: selected.conflictedCount,
									})}
								</dd>
								<dt style={mutedTextStyle}>
									{t("projectDetail.worktrees.usage")}
								</dt>
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
										.map((blocker) =>
											t(`projectDetail.worktrees.blocker.${blocker}`),
										)
										.join(" / ")}
								</div>
							) : null}
							<div className="flex flex-wrap gap-2">
								<button
									type="button"
									className="inline-flex h-8 items-center gap-2 border px-3 text-xs"
									style={controlStyle}
									disabled={Boolean(busy)}
									onClick={() =>
										void runAction("diff", async () =>
											setDiff(
												await readJsonResponse<WorktreeDiff>(
													await fetchRepositoryWorktreeDiff(
														repositoryId,
														selected.id,
													),
												),
											),
										)
									}
								>
									<GitCompare className="h-3.5 w-3.5" aria-hidden="true" />
									{t("projectDetail.worktrees.viewDiff")}
								</button>
								<button
									type="button"
									className="inline-flex h-8 items-center gap-2 border px-3 text-xs"
									style={controlStyle}
									disabled={Boolean(busy)}
									onClick={() => {
										if (
											!window.confirm(
												t("projectDetail.worktrees.confirmAdvice"),
											)
										)
											return;
										void runAction("advice", async () =>
											setAdvice(
												await readJsonResponse<WorktreeAdviceResponse>(
													await adviseRepositoryWorktrees(repositoryId, {
														kind: "summarize",
														selectedWorktreeId: selected.id,
													}),
												),
											),
										);
									}}
								>
									<Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
									{t("projectDetail.worktrees.summarize")}
								</button>
								<button
									type="button"
									className="h-8 border px-3 text-xs"
									style={controlStyle}
									disabled={Boolean(busy)}
									onClick={() => setShowTask((value) => !value)}
								>
									{t("projectDetail.worktrees.createTask")}
								</button>
								<button
									type="button"
									className="inline-flex h-8 items-center gap-2 border px-3 text-xs"
									style={{ ...controlStyle, color: "var(--nw-danger)" }}
									disabled={
										Boolean(busy) || !selected.canRemove || !selected.head
									}
									onClick={() => {
										if (
											!selected.head ||
											!window.confirm(
												t("projectDetail.worktrees.confirmRemove", {
													branch:
														selected.branch ||
														t("projectDetail.worktrees.detached"),
												}),
											)
										)
											return;
										void runAction("remove", async () => {
											await readJsonResponse(
												await removeRepositoryWorktree(repositoryId, {
													worktreeId: selected.id,
													expectedHead: selected.head || "",
												}),
											);
											setDiff(null);
											await load();
										});
									}}
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
										void runAction("task", async () => {
											const task = await readJsonResponse<Task>(
												await createTask({
													repositoryId,
													title: taskTitle,
													description: taskTitle,
													worktreeId: selected.id,
												}),
											);
											setTaskTitle("");
											setShowTask(false);
											await onTaskCreated?.(task);
											await load();
										});
									}}
								>
									<input
										className="h-8 min-w-[220px] flex-1 border px-2 text-xs"
										style={controlStyle}
										required
										value={taskTitle}
										placeholder={t(
											"projectDetail.worktrees.taskTitlePlaceholder",
										)}
										onChange={(event) => setTaskTitle(event.target.value)}
									/>
									<button
										type="submit"
										className="h-8 border px-3 text-xs"
										style={primaryButtonStyle}
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
					) : (
						<p className="text-sm" style={mutedTextStyle}>
							{t("projectDetail.worktrees.empty")}
						</p>
					)}
				</div>
			</div>

			<div className="flex justify-end">
				<button
					type="button"
					className="h-8 border px-3 text-xs"
					style={controlStyle}
					disabled={Boolean(busy)}
					onClick={() =>
						void runAction("prune", async () => {
							const preview = await readJsonResponse<{ entries: string[] }>(
								await previewRepositoryWorktreePrune(repositoryId),
							);
							if (preview.entries.length === 0) return;
							if (
								!window.confirm(
									t("projectDetail.worktrees.confirmPrune", {
										count: preview.entries.length,
									}),
								)
							)
								return;
							await readJsonResponse(
								await pruneRepositoryWorktrees(repositoryId),
							);
							await load();
						})
					}
				>
					{t("projectDetail.worktrees.prune")}
				</button>
			</div>

			{diff ? (
				<div className="overflow-hidden border" style={panelStyle}>
					<div className="border-b px-3 py-2 text-xs" style={tableBorderStyle}>
						{diff.diffStat || t("projectDetail.worktrees.noChanges")}
					</div>
					<pre className="nightworkers-scrollbar max-h-[520px] overflow-auto p-3 text-xs">
						{diff.diff || t("projectDetail.worktrees.noChanges")}
					</pre>
				</div>
			) : null}
		</section>
	);
}
