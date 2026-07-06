import { PreviewCard } from "../BlueprintPreviewPrimitives";
import {
	previewGenericItems,
	previewImageAlt,
	previewImageFor,
	toObjectArray,
} from "../previewModel";
import type { SectionRendererInput } from "./types";

export function renderCarouselSection({
	componentName,
	props,
	t,
}: SectionRendererInput) {
	const sourceItems = toObjectArray(
		props.items || props.slides || props.cards || props.products,
	);
	const items: Array<Record<string, unknown>> =
		sourceItems.length > 0
			? sourceItems
			: previewGenericItems(props, t).map((item) => ({
					title: item.title,
					description: item.description,
				}));

	return (
		<div className="flex gap-[var(--blueprint-preview-gap)] overflow-hidden">
			{items.slice(0, 4).map((item, index) => (
				<PreviewCard
					as="article"
					className="min-w-44 flex-1 p-2"
					key={String(
						item.id || item.title || item.label || JSON.stringify(item),
					)}
				>
					<img
						alt={previewImageAlt(item, `Carousel item ${index + 1}`)}
						className="aspect-video w-full rounded border border-border object-cover"
						loading="lazy"
						src={previewImageFor(item, "small", `${componentName}-${index}`)}
					/>
					<div className="mt-2 truncate text-xs font-medium text-foreground">
						{String(item.title || item.label || `Item ${index + 1}`)}
					</div>
					<div className="mt-1 line-clamp-2 text-[11px] leading-4 text-muted-foreground">
						{String(item.description || item.body || item.caption || "")}
					</div>
				</PreviewCard>
			))}
		</div>
	);
}
