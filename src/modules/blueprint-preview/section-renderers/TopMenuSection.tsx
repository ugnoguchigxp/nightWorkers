import { Search } from "lucide-react";
import { navigationLinks } from "./navigationHelpers";
import type { SectionRendererInput } from "./types";

export function renderTopMenuSection({ props }: SectionRendererInput) {
	const navLinks = navigationLinks(props);
	return (
		<div className="flex min-h-12 items-center gap-3 overflow-hidden rounded-md border border-border bg-card px-3 py-2">
			<div className="flex min-w-0 items-center gap-2">
				<span className="grid h-8 w-8 place-items-center rounded-md bg-primary text-xs font-semibold text-primary-foreground">
					{String(props.brand || "NW").slice(0, 2)}
				</span>
				<span className="truncate font-semibold text-foreground">
					{String(props.brand || "Workspace")}
				</span>
			</div>
			<div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden text-xs">
				{navLinks.slice(0, 3).map((link, index) => (
					<span
						className={`inline-flex min-w-0 shrink-0 items-center gap-1 rounded border px-2 py-1 ${
							index === 0
								? "border-border bg-muted text-foreground"
								: "border-transparent text-muted-foreground"
						}`}
						key={String(link.label || link.title || JSON.stringify(link))}
					>
						{String(
							link.label || link.title || link.name || `Link ${index + 1}`,
						)}
						{index < 3 ? (
							<span className="text-[9px] text-muted-foreground">v</span>
						) : null}
					</span>
				))}
			</div>
			<div className="flex shrink-0 items-center gap-2">
				<div className="flex h-8 w-28 items-center overflow-hidden rounded border border-border bg-background px-2.5 text-[11px] text-muted-foreground sm:w-36">
					<span className="truncate">
						{String(props.searchPlaceholder || "Search")}
					</span>
				</div>
				<button
					aria-label="Search"
					className="grid h-8 w-8 shrink-0 place-items-center rounded border border-primary bg-primary text-primary-foreground"
					type="button"
				>
					<Search className="h-3.5 w-3.5" />
				</button>
			</div>
		</div>
	);
}
