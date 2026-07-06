import { toObjectArray } from "../previewModel";
import type { SectionRendererInput } from "./types";

export function renderTimelineSection({ props, t }: SectionRendererInput) {
	const items = toObjectArray(props.steps || props.items || props.messages);
	const feed =
		items.length > 0
			? items
			: [
					{
						actor: t("blueprint.preview.feed.system"),
						action: t("blueprint.preview.feed.validated"),
						target: t("blueprint.preview.feed.blueprint"),
					},
					{
						actor: t("blueprint.preview.feed.agent"),
						action: t("blueprint.preview.feed.mapped"),
						target: t("blueprint.preview.feed.data"),
					},
					{
						actor: t("blueprint.preview.feed.user"),
						action: t("blueprint.preview.feed.reviewed"),
						target: t("blueprint.preview.feed.preview"),
					},
				];
	return (
		<div className="relative grid gap-0 rounded-md border border-border bg-card p-3">
			<div
				className="absolute top-5 bottom-5 left-[1.15rem] w-px bg-border"
				aria-hidden="true"
			/>
			{feed.slice(0, 5).map((item, index) => (
				<div
					className="relative grid grid-cols-[1.5rem_minmax(0,1fr)] gap-3 pb-4 last:pb-0"
					key={String(
						item.id || item.title || item.label || JSON.stringify(item),
					)}
				>
					<span className="z-10 mt-1 h-2.5 w-2.5 rounded-full border border-card bg-primary" />
					<div className="min-w-0 rounded-md border border-border bg-muted px-3 py-2">
						<div className="flex flex-wrap items-center gap-2 text-xs">
							<span className="font-medium text-foreground">
								{String(
									item.title ||
										item.author ||
										item.actor ||
										`Event ${index + 1}`,
								)}
							</span>
							{item.action || item.target || item.status ? (
								<span className="text-muted-foreground">
									{String(
										[item.action, item.target || item.status]
											.filter(Boolean)
											.join(" ") || item.status,
									)}
								</span>
							) : null}
						</div>
						{item.description || item.body || item.content ? (
							<div className="mt-1 text-[11px] leading-5 text-muted-foreground">
								{String(item.description || item.body || item.content)}
							</div>
						) : null}
						<div className="mt-1 flex flex-wrap gap-1.5 text-[10px] text-muted-foreground">
							<span>
								{String(
									item.time ||
										item.date ||
										item.updatedAt ||
										`${index + 1}m ago`,
								)}
							</span>
							{item.owner ? (
								<span className="rounded border border-border px-1.5 py-0.5">
									{String(item.owner)}
								</span>
							) : null}
						</div>
					</div>
				</div>
			))}
		</div>
	);
}
