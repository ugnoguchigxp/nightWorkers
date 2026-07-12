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
			className="rounded border border-cyan-700/60 bg-cyan-950/20 text-slate-100"
			open
		>
			<summary className="cursor-pointer list-none px-3 py-2 text-xs">
				<span className="mr-2 rounded border border-current/30 px-1.5 py-0.5">
					{card.title}
				</span>
				<span className="text-current/80">{card.summary}</span>
				{typeof event.seq === "number" ? (
					<span className="ml-2 text-current/50">#{event.seq}</span>
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
			className="overflow-hidden rounded-[var(--radius-md)] border border-transparent bg-[#1f2030] text-sm text-slate-200"
			summary={
				<summary className="cursor-pointer list-none px-4 py-3">
					<div className="flex items-baseline justify-between gap-4">
						<span className="min-w-0 truncate text-slate-200">
							{card.summary}
						</span>
						<span className="shrink-0 whitespace-nowrap text-right text-slate-400">
							{card.title}
						</span>
					</div>
					<div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
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
		<div className="border-slate-700/60 border-t">
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
