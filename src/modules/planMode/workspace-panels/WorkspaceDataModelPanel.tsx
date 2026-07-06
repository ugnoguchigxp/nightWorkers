import { useMemo } from "react";
import { MarkdownViewer } from "../../nightworkers/components/ArtifactFileViewers";
import type { TaskMessage } from "../../nightworkers/types";
import { buildMermaidErDiagram } from "./data-model-utils";
import { MermaidDiagram } from "./MermaidDiagram";
import {
	firstRecord,
	formatCanonicalSource,
	isRecord,
	stringValue,
	toRecordArray,
} from "./record-utils";
import { SummaryList } from "./SummaryList";

export function WorkspaceDataModelPanel({
	message,
	empty = "No Data Model artifact.",
}: {
	message: TaskMessage | null;
	empty?: string;
}) {
	const metadata = isRecord(message?.metadataJson) ? message.metadataJson : {};
	const dataModel = firstRecord(
		metadata.dataModel,
		metadata.artifactPayload,
		metadata.dataModelArtifact,
	);
	if (!message && !dataModel) return <MarkdownViewer content={empty} />;
	if (!dataModel) return <MarkdownViewer content={message?.content || empty} />;

	const title =
		stringValue(dataModel.title) || stringValue(metadata.title) || "Data Model";
	const summary = stringValue(dataModel.summary);
	const canonicalSource = formatCanonicalSource(
		stringValue(dataModel.canonicalSource),
	);
	const ddl = stringValue(dataModel.ddl);
	const tables = toRecordArray(dataModel.derivedTables);
	const relations = toRecordArray(dataModel.relations);

	return (
		<div className="grid gap-4 text-xs">
			<div className="rounded border border-slate-800 bg-slate-950/20 p-3">
				<div className="flex flex-wrap items-center gap-2">
					<h2 className="text-base font-semibold text-slate-100">{title}</h2>
					<span className="rounded border border-cyan-500/40 bg-cyan-950/30 px-2 py-0.5 text-[10px] uppercase text-cyan-100">
						{canonicalSource || "Canonical source unknown"}
					</span>
				</div>
				{summary ? <p className="mt-2 text-slate-400">{summary}</p> : null}
				<p className="mt-2 text-[11px] text-slate-500">
					Source message {message?.id?.slice(0, 8) || "unknown"}
				</p>
			</div>
			{tables.length > 0 ? (
				<DataModelDiagram tables={tables} relations={relations} />
			) : null}
			{ddl ? (
				<div className="rounded border border-slate-800 bg-slate-950/20 p-3">
					<div className="mb-2 text-[11px] font-semibold uppercase text-slate-400">
						DDL
					</div>
					<pre className="nightworkers-code-block overflow-x-auto rounded bg-slate-950 p-3 text-[11px] text-slate-200">
						<code>{ddl}</code>
					</pre>
				</div>
			) : null}
			{relations.length > 0 ? (
				<SummaryList
					title="Relations"
					items={relations.map((relation) =>
						[
							stringValue(relation.from),
							stringValue(relation.cardinality),
							stringValue(relation.to),
							stringValue(relation.reason),
						]
							.filter(Boolean)
							.join(" · "),
					)}
				/>
			) : null}
			{!ddl && tables.length === 0 && message?.content ? (
				<MarkdownViewer content={message.content} />
			) : null}
		</div>
	);
}

function DataModelDiagram({
	tables,
	relations,
}: {
	tables: Array<Record<string, unknown>>;
	relations: Array<Record<string, unknown>>;
}) {
	const diagram = useMemo(
		() => buildMermaidErDiagram(tables, relations),
		[tables, relations],
	);
	return (
		<div className="grid gap-3 rounded border border-cyan-500/30 bg-slate-950/30 p-3">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<div>
					<div className="text-[11px] font-semibold uppercase text-cyan-100">
						Mermaid ER diagram
					</div>
					<div className="mt-1 text-[11px] text-slate-400">
						Generated deterministically from Data Model tables and relations.
					</div>
				</div>
			</div>
			<MermaidDiagram chart={diagram} />
		</div>
	);
}
