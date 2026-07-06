import { PreviewBadge, PreviewCard } from "../BlueprintPreviewPrimitives";
import {
	previewColumns,
	previewImageAlt,
	previewImageFor,
	toObjectArray,
} from "../previewModel";
import type { SectionRendererInput } from "./types";

export function renderCardGridSection({
	componentName,
	props,
}: SectionRendererInput) {
	const items = toObjectArray(props.items || props.cards || props.products);
	const cards =
		items.length > 0
			? items
			: previewColumns(props)
					.slice(0, 6)
					.map((column) => ({
						title: column.label,
						description: `Sample ${column.key}`,
						badge: "Blueprint",
					}));
	return (
		<div className="grid gap-[var(--blueprint-preview-gap)] sm:grid-cols-2 xl:grid-cols-3">
			{cards.map((card, index) => (
				<PreviewCard
					as="article"
					key={String(card.title || JSON.stringify(card))}
					className="p-3"
				>
					<img
						alt={previewImageAlt(card, `Card ${index + 1}`)}
						className="mb-3 aspect-video w-full rounded border border-border object-cover"
						loading="lazy"
						src={previewImageFor(card, "small", `${componentName}-${index}`)}
					/>
					<div className="font-medium text-foreground">
						{String(card.title || "Card")}
					</div>
					<p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
						{String(card.description || "")}
					</p>
					{card.badge ? (
						<PreviewBadge className="mt-3 w-fit py-0.5 text-[10px]">
							{String(card.badge)}
						</PreviewBadge>
					) : null}
				</PreviewCard>
			))}
		</div>
	);
}
