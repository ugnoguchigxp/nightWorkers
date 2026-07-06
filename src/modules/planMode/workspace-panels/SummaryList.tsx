export function SummaryList({
	title,
	items,
	tone = "slate",
}: {
	title: string;
	items: string[];
	tone?: "slate" | "amber";
}) {
	const textClass = tone === "amber" ? "text-amber-100" : "text-slate-300";
	return (
		<div className="rounded border border-slate-800 bg-slate-950/20 p-3 text-xs">
			<div className="mb-2 text-[11px] font-semibold uppercase text-slate-400">
				{title}
			</div>
			<ul className={`grid gap-1 ${textClass}`}>
				{items.map((item, _index) => (
					<li key={`${title}-${item}`}>{item}</li>
				))}
			</ul>
		</div>
	);
}
