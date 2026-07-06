import { navigationLinks } from "./navigationHelpers";
import type { SectionRendererInput } from "./types";

export function renderRightSidebarLinksSection({
	props,
}: SectionRendererInput) {
	const navLinks = navigationLinks(props);
	const title = String(props.title || props.heading || "アクセスランキング");
	const ads = Array.isArray(props.ads)
		? props.ads.map(String).filter(Boolean)
		: [];
	return (
		<aside className="grid content-start gap-4 rounded-md border border-border bg-muted p-3">
			<section className="grid gap-2">
				<div className="text-xs font-semibold text-foreground">{title}</div>
				<div className="grid gap-2">
					{navLinks.slice(0, 5).map((link, index) => (
						<a
							className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-2 text-xs leading-5 text-foreground"
							href={String(link.href || "#")}
							key={String(link.label || link.title || JSON.stringify(link))}
						>
							<span className="font-semibold text-primary">{index + 1}</span>
							<span>
								{String(link.label || link.title || `Link ${index + 1}`)}
							</span>
						</a>
					))}
				</div>
			</section>
			{ads.length > 0 ? (
				<section className="grid gap-2">
					<div className="text-[10px] font-semibold uppercase tracking-normal text-muted-foreground">
						Ads
					</div>
					{ads.slice(0, 3).map((ad, _index) => (
						<div
							className="rounded border border-border bg-card px-3 py-4 text-center text-[11px] text-muted-foreground"
							key={ad}
						>
							{ad}
						</div>
					))}
				</section>
			) : null}
			{props.note ? (
				<div className="rounded border border-border bg-card p-3 text-[11px] leading-5 text-muted-foreground">
					{String(props.note)}
				</div>
			) : null}
		</aside>
	);
}
