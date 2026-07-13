import { AlertTriangle, Plus, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { WorktreeSummary } from "../../../../shared/schemas/gitworktree.schema";
import {
	createRepositoryWorktree,
	fetchRepositoryWorktreeDiff,
	previewRepositoryWorktreePrune,
	pruneRepositoryWorktrees,
	readGitworktreeResponse,
	removeRepositoryWorktree,
} from "../api/gitworktreeCommands";
import { useGitworktreeController } from "../hooks/useGitworktreeController";
import {
	defaultCreateDraft,
	type WorktreeDiff,
} from "../model/gitworktreeViewModel";
import { GitIntegrationSettings } from "./GitIntegrationSettings";
import { GitworktreeCreateForm } from "./GitworktreeCreateForm";
import { GitworktreeDetail } from "./GitworktreeDetail";
import { GitworktreeList } from "./GitworktreeList";
import {
	controlStyle,
	mutedTextStyle,
	panelStyle,
	primaryButtonStyle,
} from "./gitworktreeStyles";
import { WorktreeDiffDialog } from "./WorktreeDiffDialog";

type ProjectDetailWorktreesProps = {
	repositoryId: string;
	onCreateTask: (input: {
		repositoryId: string;
		title: string;
		description: string;
		worktreeId: string;
	}) => Promise<void>;
};

export function ProjectDetailWorktrees({
	repositoryId,
}: ProjectDetailWorktreesProps) {
	const { t } = useTranslation();
	const controller = useGitworktreeController(repositoryId);
	const {
		data,
		loading,
		error,
		selectedId,
		setSelectedId,
		busy,
		showCreate,
		setShowCreate,
		createDraft,
		setCreateDraft,
		diff,
		setDiff,
		load,
		selected,
		runningCount,
		attentionCount,
		runAction,
	} = controller;
	const interactionDisabled = Boolean(busy) || loading;

	if (loading && !data)
		return (
			<div className="p-6 text-sm">{t("projectDetail.worktrees.loading")}</div>
		);
	if (data && !data.git.available)
		return (
			<UnavailableState
				title={t("projectDetail.worktrees.gitMissingTitle")}
				body={t("projectDetail.worktrees.gitMissingBody")}
			/>
		);
	if (data && !data.repository.available)
		return (
			<UnavailableState
				title={t("projectDetail.worktrees.repositoryMissingTitle")}
				body={t("projectDetail.worktrees.repositoryMissingBody")}
			/>
		);

	const create = () =>
		void runAction("create", async () => {
			const created = await readGitworktreeResponse<WorktreeSummary>(
				await createRepositoryWorktree(repositoryId, createDraft),
			);
			setShowCreate(false);
			setCreateDraft(defaultCreateDraft());
			await load();
			setSelectedId(created.id);
		});
	const viewDiff = () => {
		if (!selected) return;
		void runAction("diff", async () =>
			setDiff(
				await readGitworktreeResponse<WorktreeDiff>(
					await fetchRepositoryWorktreeDiff(repositoryId, selected.id),
				),
			),
		);
	};
	const remove = () => {
		const discardChanges = Boolean(selected && !selected.canRemove);
		if (
			!selected?.head ||
			!window.confirm(
				t(
					discardChanges
						? "projectDetail.worktrees.confirmDiscardAndRemove"
						: "projectDetail.worktrees.confirmRemove",
					{
						branch: selected.branch || t("projectDetail.worktrees.detached"),
					},
				),
			)
		)
			return;
		void runAction("remove", async () => {
			await readGitworktreeResponse(
				await removeRepositoryWorktree(repositoryId, {
					worktreeId: selected.id,
					expectedHead: selected.head || "",
					discardChanges,
				}),
			);
			await load();
		});
	};
	const prune = () =>
		void runAction("prune", async () => {
			const preview = await readGitworktreeResponse<{ entries: string[] }>(
				await previewRepositoryWorktreePrune(repositoryId),
			);
			if (
				preview.entries.length === 0 ||
				!window.confirm(
					t("projectDetail.worktrees.confirmPrune", {
						count: preview.entries.length,
					}),
				)
			)
				return;
			await readGitworktreeResponse(
				await pruneRepositoryWorktrees(repositoryId),
			);
			await load();
		});

	return (
		<section className="space-y-4">
			<GitIntegrationSettings repositoryId={repositoryId} />
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
						disabled={interactionDisabled}
						onClick={() => void load()}
					>
						<RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
						{t("projectDetail.worktrees.refresh")}
					</button>
					<button
						type="button"
						className="inline-flex h-8 items-center gap-2 border px-3 text-xs font-medium"
						style={primaryButtonStyle}
						disabled={interactionDisabled}
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
				<GitworktreeCreateForm
					draft={createDraft}
					setDraft={setCreateDraft}
					disabled={interactionDisabled}
					creating={busy === "create"}
					onSubmit={create}
					onCancel={() => setShowCreate(false)}
				/>
			) : null}

			<div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(300px,0.8fr)]">
				<GitworktreeList
					worktrees={data?.worktrees || []}
					selectedId={selectedId}
					onSelect={(id) => {
						setSelectedId(id);
						setDiff(null);
					}}
				/>
				<GitworktreeDetail
					selected={selected}
					busy={loading ? "loading" : busy}
					onViewDiff={viewDiff}
					onRemove={remove}
				/>
			</div>

			<div className="flex justify-end">
				<button
					type="button"
					className="h-8 border px-3 text-xs"
					style={controlStyle}
					disabled={interactionDisabled}
					onClick={prune}
				>
					{t("projectDetail.worktrees.prune")}
				</button>
			</div>
			<WorktreeDiffDialog
				branch={selected?.branch || t("projectDetail.worktrees.detached")}
				diff={diff}
				onClose={() => setDiff(null)}
			/>
		</section>
	);
}

function UnavailableState({ title, body }: { title: string; body: string }) {
	return (
		<section className="border p-8 text-center" style={panelStyle}>
			<AlertTriangle className="mx-auto mb-3 h-6 w-6" aria-hidden="true" />
			<h2 className="font-semibold">{title}</h2>
			<p className="mt-2 text-sm" style={mutedTextStyle}>
				{body}
			</p>
		</section>
	);
}
