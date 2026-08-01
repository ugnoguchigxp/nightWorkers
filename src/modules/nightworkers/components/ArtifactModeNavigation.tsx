import {
	ClipboardCheck,
	FolderTree,
	ListTodo,
	LoaderCircle,
	NotebookPen,
} from "lucide-react";

export type ArtifactModeNavigationKind =
	| "project_files"
	| "plan"
	| "todo"
	| "evidence"
	| "review";

export type ArtifactModeNavigationProps = {
	current: ArtifactModeNavigationKind | null;
	disabled?: boolean;
	busyKind?: ArtifactModeNavigationKind | null;
	available: Record<ArtifactModeNavigationKind, boolean>;
	onOpen: Record<ArtifactModeNavigationKind, () => void>;
};

const navigationItems = [
	{
		kind: "project_files",
		label: "Files",
		title: "プロジェクトファイル",
		icon: FolderTree,
	},
	{
		kind: "plan",
		label: "Plan",
		title: "Plan モードワークスペース",
		icon: NotebookPen,
	},
	{
		kind: "todo",
		label: "Todo",
		title: "Todo アーティファクト",
		icon: ListTodo,
	},
	{
		kind: "evidence",
		label: "Evidence",
		title: "証跡チェック",
		icon: ClipboardCheck,
	},
	{
		kind: "review",
		label: "Review",
		title: "レビューモード",
		icon: ClipboardCheck,
	},
] as const;

export function ArtifactModeNavigation({
	current,
	disabled = false,
	busyKind = null,
	available,
	onOpen,
}: ArtifactModeNavigationProps) {
	return (
		<nav
			aria-label="アーティファクト表示"
			className="nightworkers-scrollbar-hidden flex min-w-0 items-center gap-1 overflow-x-auto"
			data-artifact-export-exclude
		>
			{navigationItems.map((item) => {
				const active = current === item.kind;
				const busy = busyKind === item.kind;
				const Icon = item.icon;
				return (
					<button
						type="button"
						key={item.kind}
						data-artifact-mode={item.kind}
						aria-pressed={active}
						aria-label={item.title}
						title={item.title}
					disabled={disabled || busy || !available[item.kind]}
						onClick={onOpen[item.kind]}
						className={`nightworkers-artifact-mode-button inline-flex h-7 shrink-0 items-center gap-1.5 rounded border px-2 text-[11px] font-semibold transition active:translate-y-px disabled:cursor-not-allowed disabled:shadow-none ${
							active
								? "border-cyan-400/80 bg-cyan-950/60 text-cyan-100 shadow-inner"
								: "border-slate-700 bg-slate-900/70 text-slate-300 shadow-sm hover:border-slate-500 hover:bg-slate-800 hover:text-slate-100"
						}`}
					>
						{busy ? (
							<LoaderCircle className="h-3.5 w-3.5 animate-spin" />
						) : (
							<Icon className="h-3.5 w-3.5" />
						)}
						<span>{item.label}</span>
					</button>
				);
			})}
		</nav>
	);
}
