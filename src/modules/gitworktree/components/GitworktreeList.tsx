import { GitBranch } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { WorktreeSummary } from "../../../../shared/schemas/gitworktree.schema";
import { worktreeStatusLabelKey } from "../model/gitworktreeViewModel";
import {
	mutedTextStyle,
	panelStyle,
	tableBorderStyle,
} from "./gitworktreeStyles";

type GitworktreeListProps = {
	worktrees: WorktreeSummary[];
	selectedId: string | null;
	onSelect: (id: string) => void;
};

export function GitworktreeList({
	worktrees,
	selectedId,
	onSelect,
}: GitworktreeListProps) {
	const { t } = useTranslation();
	return (
		<div className="overflow-hidden border" style={panelStyle}>
			<div
				className="border-b px-3 py-2 text-sm font-medium"
				style={tableBorderStyle}
			>
				{t("projectDetail.worktrees.list")}
			</div>
			<div className="divide-y" style={tableBorderStyle}>
				{worktrees.map((worktree) => {
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
							onClick={() => onSelect(worktree.id)}
						>
							<span className="min-w-0">
								<span className="flex items-center gap-2 font-medium">
									<GitBranch className="h-3.5 w-3.5" aria-hidden="true" />
									<span className="truncate">
										{worktree.branch || t("projectDetail.worktrees.detached")}
									</span>
									{worktree.isBase ? (
										<span className="nightworkers-chip">
											{t("projectDetail.worktrees.base")}
										</span>
									) : null}
								</span>
								<span className="mt-1 block truncate" style={mutedTextStyle}>
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
	);
}
