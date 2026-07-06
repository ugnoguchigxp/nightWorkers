import { PreviewBadge } from "../BlueprintPreviewPrimitives";
import { toObjectArray } from "../previewModel";
import type { SectionRendererInput } from "./types";

export function renderNotificationCenterSection({
	props,
}: SectionRendererInput) {
	const notifications = toObjectArray(
		props.notifications || props.items || props.messages,
	);
	const items =
		notifications.length > 0
			? notifications
			: [
					{
						title: "Blueprint adopted",
						body: "Implementation plan can use the selected section.",
					},
					{
						title: "Data source missing",
						body: "Review table binding before queuing work.",
					},
					{
						title: "Preview updated",
						body: "Design token settings changed for this session.",
					},
				];
	return (
		<div className="grid gap-3">
			<div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-card px-3 py-2">
				<div>
					<div className="text-xs font-semibold text-foreground">
						Notifications
					</div>
					<div className="text-[11px] text-muted-foreground">
						{items.length} unread updates
					</div>
				</div>
				<div className="flex gap-1 text-[10px]">
					{["All", "Unread", "Critical"].map((label, index) => (
						<span
							className={`rounded border px-2 py-0.5 ${
								index === 1
									? "border-primary bg-primary text-primary-foreground"
									: "border-border bg-muted text-muted-foreground"
							}`}
							key={label}
						>
							{label}
						</span>
					))}
				</div>
			</div>
			{items.slice(0, 5).map((item, index) => (
				<div
					className="flex items-start gap-3 rounded-md border border-border bg-card px-3 py-2 text-xs shadow-sm"
					key={String(item.id || item.title || JSON.stringify(item))}
				>
					<span
						className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
							index === 1 ? "bg-amber-500" : "bg-primary"
						}`}
						aria-hidden="true"
					/>
					<div className="min-w-0">
						<div className="flex items-center gap-2">
							<div className="font-medium text-foreground">
								{String(
									item.title || item.label || `Notification ${index + 1}`,
								)}
							</div>
							<PreviewBadge
								tone={index === 1 ? "warning" : "default"}
								className="px-1.5 py-0.5 text-[9px]"
							>
								{index === 1 ? "Needs action" : "Unread"}
							</PreviewBadge>
						</div>
						<div className="mt-1 leading-5 text-muted-foreground">
							{String(item.body || item.content || item.description || "")}
						</div>
					</div>
				</div>
			))}
		</div>
	);
}
