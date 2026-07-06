import { PreviewButton } from "../BlueprintPreviewPrimitives";
import { toObjectArray } from "../previewModel";
import type { SectionRendererInput } from "./types";

export function renderEmailInboxSection({ props }: SectionRendererInput) {
	const messages = toObjectArray(props.messages || props.items || props.rows);
	const rows =
		messages.length > 0
			? messages
			: [
					{
						sender: "Design Review",
						subject: "Blueprint section updates",
						time: "09:42",
					},
					{
						sender: "Billing",
						subject: "Payment receipt is ready",
						time: "08:15",
					},
					{
						sender: "Ops Team",
						subject: "Map locations imported",
						time: "Yesterday",
					},
					{
						sender: "Support",
						subject: "New comment on implementation plan",
						time: "Mon",
					},
				];
	return (
		<div className="grid overflow-hidden rounded-md border border-border bg-card md:grid-cols-[10rem_minmax(0,1fr)]">
			<div className="grid content-start gap-2 border-border border-b bg-muted p-3 md:border-r md:border-b-0">
				<PreviewButton className="w-full justify-center">Compose</PreviewButton>
				{["Inbox", "Starred", "Sent", "Drafts"].map((label, index) => (
					<div
						className={`rounded px-2 py-1.5 text-xs ${
							index === 0
								? "bg-card font-semibold text-foreground"
								: "text-muted-foreground"
						}`}
						key={label}
					>
						{label}
					</div>
				))}
			</div>
			<div className="min-w-0">
				<div className="flex items-center gap-2 border-border border-b px-3 py-2">
					<div className="flex-1 rounded border border-border bg-background px-3 py-1.5 text-xs text-muted-foreground">
						{String(props.searchPlaceholder || "Search mail")}
					</div>
					<span className="rounded border border-border px-2 py-1 text-[10px] text-muted-foreground">
						1-4
					</span>
				</div>
				<div className="divide-y divide-border">
					{rows.slice(0, 5).map((message, index) => (
						<div
							className="grid grid-cols-[1rem_minmax(7rem,0.32fr)_minmax(0,1fr)_4.5rem] items-center gap-2 px-3 py-2 text-xs"
							data-unread={index < 2 ? "true" : "false"}
							key={String(
								message.id || message.subject || JSON.stringify(message),
							)}
						>
							<span className="h-3 w-3 rounded border border-border bg-background" />
							<span className="truncate font-medium text-foreground">
								{String(
									message.sender || message.from || `Sender ${index + 1}`,
								)}
							</span>
							<span className="truncate text-muted-foreground">
								{String(
									message.subject ||
										message.title ||
										message.description ||
										"Message",
								)}
							</span>
							<span className="text-right text-[10px] text-muted-foreground">
								{String(message.time || message.date || "")}
							</span>
						</div>
					))}
				</div>
			</div>
		</div>
	);
}
