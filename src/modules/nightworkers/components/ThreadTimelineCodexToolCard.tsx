import type { ActivityEvent, TaskEvent } from "../types";
import { LazyDetails } from "./LazyDetails";
import {
	type CodexToolCardModel,
	codexToolCodeBlockMaxHeight,
	getCodexToolCardModel,
	statusLabel,
} from "./ThreadTimelineCodexToolCardModel";
import { DiffCodeBlock } from "./ThreadTimelineDiffView";
import { NightWorkersCodeBlock } from "./ThreadTimelineMarkdown";

export {
	getCodexToolCardModel,
	hasCodexToolCard,
} from "./ThreadTimelineCodexToolCardModel";
export function CodexToolCard({ event }: { event: TaskEvent | ActivityEvent }) {
	const card = getCodexToolCardModel(event);
	if (!card) return null;

	return (
		<details
			className="nightworkers-chat-card rounded border"
			data-tone="accent"
			open
		>
			<summary className="nightworkers-chat-card-header cursor-pointer list-none px-3 py-2 text-xs">
				<span className="nightworkers-chat-card-badge mr-2 rounded border px-1.5 py-0.5">
					{card.title}
				</span>
				<span className="nightworkers-chat-card-meta">{card.summary}</span>
				{typeof event.seq === "number" ? (
					<span className="nightworkers-chat-card-subtle ml-2">
						#{event.seq}
					</span>
				) : null}
			</summary>
			<CodexToolCardBody card={card} debug />
		</details>
	);
}

export function NormalCodexToolCard({
	event,
}: {
	event: TaskEvent | ActivityEvent;
}) {
	const card = getCodexToolCardModel(event);
	if (!card) return null;

	return (
		<LazyDetails
			className="nightworkers-chat-card overflow-hidden rounded-[var(--radius-md)] border text-sm"
			summary={
				<summary className="nightworkers-chat-card-header cursor-pointer list-none px-4 py-3">
					<div className="flex items-baseline justify-between gap-4">
						<span className="nightworkers-chat-card-title min-w-0 truncate">
							{card.summary}
						</span>
						<span className="nightworkers-chat-card-meta shrink-0 whitespace-nowrap text-right">
							{card.title}
						</span>
					</div>
					<div className="nightworkers-chat-card-meta mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
						<span>{statusLabel(card)}</span>
						{card.metadata.slice(0, 3).map((item) => (
							<span key={`${item.label}:${item.value}`}>
								{item.label}: {item.value}
							</span>
						))}
					</div>
				</summary>
			}
		>
			<CodexToolCardBody card={card} />
		</LazyDetails>
	);
}

function CodexToolCardBody({
	card,
	debug = false,
}: {
	card: CodexToolCardModel;
	debug?: boolean;
}) {
	const detailLines = [
		`toolName: ${card.toolName}`,
		`lifecycle: ${card.lifecycle}`,
		`status: ${card.status}`,
		card.providerItemId ? `providerItemId: ${card.providerItemId}` : "",
		...card.metadata.map((item) => `${item.label}: ${item.value}`),
		card.errorMessage ? `error: ${card.errorMessage}` : "",
	].filter(Boolean);
	const blocks = [
		detailLines.join("\n"),
		card.argumentsPreview ? `arguments:\n${card.argumentsPreview}` : "",
		card.resultPreview ? `result:\n${card.resultPreview}` : "",
		card.outputPreview ? `output:\n${card.outputPreview}` : "",
	].filter(Boolean);
	if (blocks.length === 0) return null;

	return (
		<div className="nightworkers-chat-card-body border-t">
			{card.editDiffPreview ? (
				<div className="space-y-2 p-3">
					<DiffCodeBlock
						code={card.editDiffPreview.diff}
						label={card.editDiffPreview.label}
					/>
					{card.outputPreview ? (
						<NightWorkersCodeBlock
							code={card.outputPreview}
							filename={card.detailsFilename || `${card.toolName}.output.txt`}
							language="text"
							maxHeight={codexToolCodeBlockMaxHeight(card, debug, "output")}
							syntaxHighlighting={false}
						/>
					) : null}
				</div>
			) : (
				<NightWorkersCodeBlock
					code={blocks.join("\n\n")}
					filename={card.detailsFilename || `${card.toolName}.txt`}
					language="text"
					maxHeight={codexToolCodeBlockMaxHeight(card, debug, "details")}
					syntaxHighlighting={false}
				/>
			)}
		</div>
	);
}
