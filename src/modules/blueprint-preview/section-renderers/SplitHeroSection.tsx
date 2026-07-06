import { PreviewButton } from "../BlueprintPreviewPrimitives";
import {
	isObject,
	previewImageAlt,
	previewImageFor,
	toObjectArray,
} from "../previewModel";
import type { SectionRendererInput } from "./types";

export function renderSplitHeroSection({ props }: SectionRendererInput) {
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
		<div className="overflow-hidden rounded-lg border border-border bg-card">
			<div className="grid min-h-80 md:grid-cols-[minmax(0,1.05fr)_minmax(18rem,0.95fr)]">
				<div className="grid content-center gap-5 p-5 sm:p-6">
					<div>
						<div className="max-w-[13ch] text-4xl font-semibold leading-[1.02] tracking-normal text-foreground sm:text-5xl">
							{title}
						</div>
						{description ? (
							<p className="mt-4 max-w-xl text-sm leading-6 text-muted-foreground">
								{description}
							</p>
						) : null}
					</div>
					{actions.length > 0 ? (
						<div className="flex flex-wrap gap-2">
							{actions.slice(0, 2).map((action, index) => (
								<PreviewButton
									tone={index === 0 ? "primary" : "plain"}
									key={String(
										action.id || action.label || JSON.stringify(action),
									)}
								>
									{String(
										action.label || action.title || `Action ${index + 1}`,
									)}
								</PreviewButton>
							))}
						</div>
					) : null}
					{highlights.length > 0 ? (
						<div className="grid gap-2 border-t border-border pt-4 sm:grid-cols-3">
							{highlights.slice(0, 3).map((highlight, index) => (
								<div className="min-w-0" key={highlight}>
									<div className="text-[10px] font-medium text-muted-foreground">
										{String(index + 1).padStart(2, "0")}
									</div>
									<div className="mt-1 text-xs font-medium leading-5 text-foreground">
										{highlight}
									</div>
								</div>
							))}
						</div>
					) : null}
				</div>
				<div className="bg-muted p-3 md:p-4">
					<img
						alt={previewImageAlt(props, title)}
						className="h-full min-h-60 w-full rounded-md border border-border object-cover"
						loading="lazy"
						src={previewImageFor(props, "large", title)}
					/>
				</div>
			</div>
		</div>
	);
}
