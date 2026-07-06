import { previewImageFor } from "../previewModel";
import type { SectionRendererInput } from "./types";

export function renderImageSection({
	componentName,
	props,
}: SectionRendererInput) {
	const label = String(
		props.alt || props.caption || props.title || componentName,
	);
	return (
		<figure className="grid gap-2">
			<img
				alt={label}
				className="aspect-video max-h-80 w-full rounded-md border border-border object-cover"
				loading="lazy"
				src={previewImageFor(props, "large", label)}
			/>
			{props.caption ? (
				<figcaption className="text-xs leading-5 text-muted-foreground">
					{String(props.caption)}
				</figcaption>
			) : null}
		</figure>
	);
}
