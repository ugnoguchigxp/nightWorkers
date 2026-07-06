import { Loader2, Play } from "lucide-react";

export function ProjectEvaluationEmptyState({
	isLoading,
	onRun,
}: {
	isLoading: boolean;
	onRun: () => void;
}) {
	return (
		<div className="flex min-h-[360px] items-center justify-center rounded-md border border-[var(--nw-border)] bg-[var(--nw-panel)] p-8 text-center">
			<div className="max-w-md">
				<div className="font-semibold text-[var(--nw-text)] text-lg">
					保存済み Project Evaluation はまだありません
				</div>
				<p className="mt-2 text-[var(--nw-muted-text)] text-sm leading-6">
					登録済み Project の repository bundle を作成し、evaluation role の
					structured LLM route で評価 JSON を生成します。
				</p>
				<button
					className="mt-4 inline-flex h-9 items-center rounded-md border border-[var(--nw-strong-border)] bg-[var(--nw-surface-soft)] px-3 text-[var(--nw-text)] text-sm hover:bg-[var(--nw-surface)] disabled:opacity-50"
					disabled={isLoading}
					onClick={onRun}
					type="button"
				>
					{isLoading ? (
						<Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
					) : (
						<Play className="mr-2 h-3.5 w-3.5" />
					)}
					{isLoading ? "LLMに依頼中" : "評価を実行"}
				</button>
			</div>
		</div>
	);
}
