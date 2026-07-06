import {
	previewImageAlt,
	previewImageFor,
	toObjectArray,
} from "../previewModel";
import type { SectionRendererInput } from "./types";

export function renderCheckoutSummarySection({
	componentName,
	props,
	t,
}: SectionRendererInput) {
	const entries = toObjectArray(props.entries || props.events || props.lines);
	const rows =
		entries.length > 0
			? entries
			: [
					{
						title: t("blueprint.preview.row.planningReview"),
						date: "2026-06-03",
						amount: "$1,240",
					},
					{
						title: t("blueprint.preview.row.implementation"),
						date: "2026-06-04",
						amount: "$860",
					},
					{
						title: t("blueprint.preview.row.validation"),
						date: "2026-06-05",
						amount: "$420",
					},
				];
	const total = rows.reduce((sum, row) => {
		const numericValue = Number(
			String(row.amount || row.value || "").replace(/[^0-9.-]/g, ""),
		);
		return sum + (Number.isFinite(numericValue) ? numericValue : 0);
	}, 0);
	return (
		<div className="grid gap-3">
			<div className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2 text-xs">
				<div>
					<div className="font-semibold text-foreground">Order summary</div>
					<div className="text-[11px] text-muted-foreground">
						{rows.length} line items
					</div>
				</div>
				<div className="text-right">
					<div className="text-[11px] text-muted-foreground">Total</div>
					<div className="font-semibold text-foreground">
						${total.toLocaleString()}
					</div>
				</div>
			</div>
			{rows.slice(0, 5).map((row, index) => (
				<div
					className="flex items-center justify-between gap-3 rounded border border-border bg-card px-3 py-2 text-xs"
					key={String(row.title || row.label || JSON.stringify(row))}
				>
					<div className="flex min-w-0 items-center gap-3">
						<img
							alt={previewImageAlt(row, `Line item ${index + 1}`)}
							className="aspect-video h-12 w-20 shrink-0 rounded border border-border object-cover"
							loading="lazy"
							src={previewImageFor(row, "small", `${componentName}-${index}`)}
						/>
						<div className="min-w-0">
							<div className="truncate font-medium text-foreground">
								{String(row.title || row.label || `Item ${index + 1}`)}
							</div>
							<div className="mt-0.5 truncate text-muted-foreground">
								{String(row.date || row.status || "")}
							</div>
						</div>
					</div>
					<div className="shrink-0 text-foreground">
						{String(row.amount || row.value || "")}
					</div>
				</div>
			))}
		</div>
	);
}
