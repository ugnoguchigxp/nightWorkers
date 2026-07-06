export function WorkspaceList({
	items,
	empty,
}: {
	items: Array<{
		id: string;
		title: string;
		sourceMessageId?: string;
		status?: string;
		adoptionState?: string;
		kind?: string;
	}>;
	empty: string;
}) {
	if (items.length === 0)
		return <p className="text-xs text-slate-500">{empty}</p>;
	return (
		<div className="grid gap-2">
			{items.map((item) => (
				<div
					key={item.id}
					className="rounded border border-slate-800 bg-slate-950/20 p-3 text-xs"
				>
					<div className="font-medium text-slate-100">{item.title}</div>
					<div className="mt-1 text-slate-500">
						{item.kind || "artifact"}{" "}
						{item.sourceMessageId
							? `message ${item.sourceMessageId.slice(0, 8)}`
							: ""}
						{item.adoptionState ? ` · ${item.adoptionState}` : ""}
					</div>
				</div>
			))}
		</div>
	);
}
