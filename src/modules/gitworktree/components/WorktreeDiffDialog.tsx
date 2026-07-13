import { FileDiff, Files, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { CodeBlock } from "@/components/ui/CodeBlock";
import { useModalFocus } from "@/hooks/useModalFocus";
import { getChangedFileDiffs, getDiffStats } from "@/lib/unifiedDiff";
import type { WorktreeDiff } from "../model/gitworktreeViewModel";
import {
	controlStyle,
	mutedTextStyle,
	panelStyle,
	tableBorderStyle,
} from "./gitworktreeStyles";

const deletedLineStyle = { color: "var(--nw-danger)" };

export function WorktreeDiffDialog({
	branch,
	diff,
	onClose,
}: {
	branch: string;
	diff: WorktreeDiff | null;
	onClose: () => void;
}) {
	const { t } = useTranslation();
	const files = useMemo(() => getChangedFileDiffs(diff?.diff), [diff?.diff]);
	const totals = useMemo(() => getDiffStats(diff?.diff), [diff?.diff]);
	const [selectedPath, setSelectedPath] = useState<string | null>(null);
	const dialogRef = useModalFocus<HTMLDivElement>({
		open: Boolean(diff),
		onClose,
	});

	useEffect(() => {
		setSelectedPath(files[0]?.path ?? null);
	}, [files]);

	if (!diff) return null;
	const selectedFile =
		files.find((file) => file.path === selectedPath) ?? files[0] ?? null;

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center p-4">
			<button
				type="button"
				className="absolute inset-0 h-full w-full bg-black/70"
				onClick={onClose}
				aria-label={t("projectDetail.worktrees.diff.close")}
			/>
			<div
				ref={dialogRef}
				role="dialog"
				aria-modal="true"
				aria-labelledby="worktree-diff-dialog-title"
				tabIndex={-1}
				className="relative flex h-[88vh] w-[96vw] max-w-[1500px] flex-col overflow-hidden border shadow-2xl"
				style={panelStyle}
			>
				<header
					className="flex shrink-0 items-center gap-3 border-b px-4 py-3"
					style={tableBorderStyle}
				>
					<FileDiff className="h-5 w-5 shrink-0" aria-hidden="true" />
					<div className="min-w-0 flex-1">
						<h2
							id="worktree-diff-dialog-title"
							className="truncate font-semibold"
						>
							{t("projectDetail.worktrees.diff.title")}
						</h2>
						<p className="truncate text-xs" style={mutedTextStyle}>
							{branch}
						</p>
					</div>
					<div className="flex shrink-0 flex-wrap items-center justify-end gap-2 text-xs">
						<span className="nightworkers-chip">
							{t("projectDetail.worktrees.diff.fileCount", {
								count: files.length,
							})}
						</span>
						<span className="nightworkers-chip text-emerald-300">
							{t("projectDetail.worktrees.diff.addedLines", {
								count: totals.added,
							})}
						</span>
						<span className="nightworkers-chip" style={deletedLineStyle}>
							{t("projectDetail.worktrees.diff.deletedLines", {
								count: totals.deleted,
							})}
						</span>
						{diff.truncated ? (
							<span className="nightworkers-chip">
								{t("projectDetail.worktrees.diff.truncated")}
							</span>
						) : null}
					</div>
					<button
						type="button"
						className="inline-flex h-8 w-8 shrink-0 items-center justify-center border"
						style={controlStyle}
						onClick={onClose}
						aria-label={t("projectDetail.worktrees.diff.close")}
					>
						<X className="h-4 w-4" aria-hidden="true" />
					</button>
				</header>

				<div className="grid min-h-0 flex-1 grid-rows-[minmax(160px,35%)_minmax(0,1fr)] md:grid-cols-[minmax(240px,320px)_minmax(0,1fr)] md:grid-rows-1">
					<aside
						className="nightworkers-scrollbar min-h-0 overflow-y-auto border-b p-3 md:border-r md:border-b-0"
						style={tableBorderStyle}
					>
						<div className="mb-2 flex items-center gap-2 text-xs font-semibold">
							<Files className="h-4 w-4" aria-hidden="true" />
							{t("projectDetail.worktrees.diff.changedFiles")}
						</div>
						{files.length > 0 ? (
							<div className="space-y-1">
								{files.map((file) => {
									const selected = file.path === selectedFile?.path;
									return (
										<button
											key={file.path}
											type="button"
											aria-pressed={selected}
											data-worktree-diff-file={file.path}
											className="w-full border px-3 py-2 text-left text-xs transition-colors"
											style={
												selected
													? {
															...controlStyle,
															background:
																"color-mix(in srgb, var(--nw-primary) 12%, var(--nw-panel))",
															borderColor: "var(--nw-primary)",
														}
													: controlStyle
											}
											onClick={() => setSelectedPath(file.path)}
											title={file.path}
										>
											<span className="block truncate font-mono">
												{file.path}
											</span>
											<span className="mt-1 flex gap-2 font-mono text-[11px]">
												<span className="text-emerald-300">+{file.added}</span>
												<span style={deletedLineStyle}>-{file.deleted}</span>
											</span>
										</button>
									);
								})}
							</div>
						) : (
							<p className="text-xs" style={mutedTextStyle}>
								{t("projectDetail.worktrees.noChanges")}
							</p>
						)}
					</aside>

					<div className="min-h-0 min-w-0 overflow-hidden p-3">
						{selectedFile ? (
							<CodeBlock
								key={selectedFile.path}
								className="nightworkers-code-block h-full max-w-full shadow-none"
								data={[
									{
										code: selectedFile.diff,
										filename: selectedFile.path,
										language: "diff",
									},
								]}
								lineNumbers={false}
								maxHeight="calc(88vh - 8.5rem)"
								copyLabel={t("projectDetail.worktrees.diff.copy")}
								copiedLabel={t("projectDetail.worktrees.diff.copied")}
							/>
						) : (
							<div
								className="flex h-full items-center justify-center text-sm"
								style={mutedTextStyle}
							>
								{t("projectDetail.worktrees.noChanges")}
							</div>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}
