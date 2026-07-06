import { previewImageAlt, previewImageFor } from "../previewModel";
import type { SectionRendererInput } from "./types";

export function renderVideoSection({ props }: SectionRendererInput) {
	const title = String(props.title || props.name || "Video preview");
	const caption = String(props.caption || props.description || "");
	return (
		<figure className="grid gap-2">
			<div className="overflow-hidden rounded-md border border-border bg-card">
				<div className="relative aspect-video bg-muted">
					<img
						alt={previewImageAlt(props, title)}
						className="absolute inset-0 h-full w-full object-cover opacity-80"
						loading="lazy"
						src={previewImageFor(
							{ ...props, imageUrl: props.posterUrl || props.imageUrl },
							"large",
							title,
						)}
					/>
					<div className="absolute inset-0 bg-[linear-gradient(180deg,transparent,color-mix(in_srgb,var(--background)_68%,transparent))]" />
					<div className="absolute inset-0 grid place-items-center">
						<div className="grid h-14 w-14 place-items-center rounded-full border border-border bg-card/90 shadow-sm">
							<span className="ml-1 h-0 w-0 border-y-[9px] border-y-transparent border-l-[14px] border-l-foreground" />
						</div>
					</div>
					<div className="absolute right-3 bottom-3 rounded bg-background/90 px-2 py-1 text-[10px] font-medium text-foreground">
						{String(props.duration || "02:48")}
					</div>
				</div>
				<div className="grid gap-2 border-border border-t bg-card px-3 py-2">
					<div className="flex items-center gap-2">
						<div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
							<div className="h-full w-2/5 rounded-full bg-primary" />
						</div>
						<span className="text-[10px] text-muted-foreground">HD</span>
					</div>
					<div className="text-xs font-semibold text-foreground">{title}</div>
				</div>
			</div>
			{caption ? (
				<figcaption className="text-xs leading-5 text-muted-foreground">
					{caption}
				</figcaption>
			) : null}
		</figure>
	);
}
