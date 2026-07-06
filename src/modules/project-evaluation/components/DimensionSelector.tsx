import { BarChart3 } from "lucide-react";
import type {
	ProjectEvaluationDimensionKey,
	ProjectEvaluationDimensionScore,
} from "../model/projectEvaluationTypes";
import { DimensionScoreRow } from "./DimensionScoreRow";

export function DimensionSelector({
	dimensions,
	selectedKeys,
	onChange,
}: {
	dimensions: ProjectEvaluationDimensionScore[];
	selectedKeys: Set<ProjectEvaluationDimensionKey>;
	onChange: (keys: Set<ProjectEvaluationDimensionKey>) => void;
}) {
	const selectedLabels = dimensions
		.filter((dimension) => selectedKeys.has(dimension.key))
		.map((dimension) => dimension.label);
	const toggle = (key: ProjectEvaluationDimensionKey) => {
		const next = new Set(selectedKeys);
		if (next.has(key)) next.delete(key);
		else next.add(key);
		onChange(next);
	};
	return (
		<section className="rounded-md border border-[var(--nw-border)] bg-[var(--nw-panel)] shadow-sm">
			<div className="flex min-h-12 items-center justify-between gap-3 border-[var(--nw-border)] border-b px-3 py-2">
				<div className="min-w-0">
					<div className="flex items-center gap-2 font-semibold text-[var(--nw-muted-text)] text-xs uppercase">
						<BarChart3 className="h-4 w-4 text-[var(--nw-primary)]" />
						Round 1 / 評価軸を選ぶ
					</div>
					<div className="mt-1 truncate text-[var(--nw-subtle-text)] text-xs">
						{selectedLabels.length > 0
							? `${selectedLabels.length} axes selected: ${selectedLabels.join(" / ")}`
							: "改善案を生成する評価軸を選択してください。"}
					</div>
				</div>
				<div className="flex shrink-0 items-center gap-2">
					<button
						className="rounded-md border border-[var(--nw-border)] px-2.5 py-1 text-[var(--nw-muted-text)] text-xs hover:border-[var(--nw-primary)]"
						onClick={() =>
							onChange(
								new Set(
									dimensions
										.slice()
										.sort((a, b) => a.score - b.score)
										.slice(0, 3)
										.map((item) => item.key),
								),
							)
						}
						type="button"
					>
						下位3軸
					</button>
					<button
						className="rounded-md border border-[var(--nw-border)] px-2.5 py-1 text-[var(--nw-muted-text)] text-xs hover:border-[var(--nw-primary)]"
						onClick={() =>
							onChange(new Set(dimensions.map((item) => item.key)))
						}
						type="button"
					>
						すべて
					</button>
					<button
						className="rounded-md border border-[var(--nw-border)] px-2.5 py-1 text-[var(--nw-muted-text)] text-xs hover:border-[var(--nw-primary)]"
						onClick={() => onChange(new Set())}
						type="button"
					>
						解除
					</button>
				</div>
			</div>
			<div className="divide-y divide-[var(--nw-border)]">
				{dimensions.map((dimension) => (
					<DimensionScoreRow
						dimension={dimension}
						key={dimension.key}
						onToggle={() => toggle(dimension.key)}
						selected={selectedKeys.has(dimension.key)}
					/>
				))}
			</div>
		</section>
	);
}
