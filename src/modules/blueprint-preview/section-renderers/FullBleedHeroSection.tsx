import { PreviewButton } from "../BlueprintPreviewPrimitives";
import {
	isObject,
	previewImageAlt,
	previewImageFor,
	toObjectArray,
} from "../previewModel";
import type { SectionRendererInput } from "./types";

export function renderFullBleedHeroSection({ props }: SectionRendererInput) {
	const title = String(props.headline || props.title || props.name || "Hero");
	const description = String(
		props.description || props.subtitle || props.body || "",
	);
	const highlights = Array.isArray(props.highlights)
		? props.highlights.map(String)
		: [];
	const actions: Record<string, unknown>[] = [
		...(isObject(props.primaryCta) ? [props.primaryCta] : []),
		...(isObject(props.secondaryCta) ? [props.secondaryCta] : []),
		...toObjectArray(props.actions),
	];

	return (
		<div className="relative min-h-[24rem] overflow-hidden rounded-lg border border-border bg-muted">
			<img
				alt={previewImageAlt(props, title)}
				className="absolute inset-0 h-full w-full object-cover"
				loading="lazy"
				src={previewImageFor(props, "large", title)}
			/>
			<div className="absolute inset-0 bg-[linear-gradient(90deg,color-mix(in_srgb,var(--background)_78%,transparent),color-mix(in_srgb,var(--background)_32%,transparent)_55%,transparent)]" />
			<div className="relative grid min-h-[24rem] max-w-xl content-center gap-5 p-5 sm:p-7">
				<div>
					<div className="text-4xl font-semibold leading-[1.02] tracking-normal text-foreground sm:text-5xl">
						{title}
					</div>
					{description ? (
						<p className="mt-4 max-w-lg text-sm leading-6 text-muted-foreground">
							{description}
						</p>
					) : null}
				</div>
				{highlights.length > 0 ? (
					<div className="grid gap-2 text-xs font-medium text-foreground">
						{highlights.slice(0, 3).map((highlight, _index) => (
							<div className="flex items-center gap-2" key={highlight}>
								<span className="h-1.5 w-1.5 rounded-full bg-primary" />
								<span>{highlight}</span>
							</div>
						))}
					</div>
				) : null}
				{actions.length > 0 ? (
					<div className="flex flex-wrap gap-2">
						{actions.slice(0, 2).map((action, index) => (
							<PreviewButton
								tone={index === 0 ? "primary" : "plain"}
								key={String(
									action.id || action.label || JSON.stringify(action),
								)}
							>
								{String(action.label || action.title || `Action ${index + 1}`)}
							</PreviewButton>
						))}
					</div>
				) : null}
			</div>
		</div>
	);
}
