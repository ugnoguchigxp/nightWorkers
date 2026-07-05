import { MarkdownViewer } from '../../nightworkers/components/ArtifactFileViewers';
import type { PlanModeWorkspaceArtifact, TaskMessage } from '../../nightworkers/types';
import { ApiContractViewer } from './ApiContractViewer';
import { readApiContractArtifact, readZodSchemaArtifact } from './dedicated-view-artifacts';
import {
  buildFlowchartFromMarkdown,
  extractMermaidChart,
  isDiagramDedicatedView,
  isFlowchartPlanView,
  stripMermaidBlocks,
} from './flowchart';
import { MermaidDiagram } from './MermaidDiagram';
import { isRecord } from './record-utils';
import { formatViewLabel } from './types';
import { ZodSchemaViewer } from './ZodSchemaViewer';

export function DedicatedViewPanel({
  artifact,
  message,
}: {
  artifact: PlanModeWorkspaceArtifact | null;
  message: TaskMessage | null;
}) {
  if (!artifact && !message) return <MarkdownViewer content="No plan view artifact." />;
  const metadata = isRecord(message?.metadataJson) ? message.metadataJson : {};
  const viewKind = String(artifact?.kind || metadata.view || '');
  const apiContract = viewKind === 'api_io_contract' ? readApiContractArtifact(metadata) : null;
  if (apiContract) {
    return <ApiContractViewer artifact={artifact} apiContract={apiContract} />;
  }
  const zodSchema = viewKind === 'zod_schema_design' ? readZodSchemaArtifact(metadata) : null;
  if (zodSchema) {
    return <ZodSchemaViewer artifact={artifact} zodSchema={zodSchema} />;
  }
  const explicitChart = isDiagramDedicatedView(viewKind)
    ? extractMermaidChart(message?.content || '')
    : null;
  const fallbackChart =
    !explicitChart && isFlowchartPlanView(viewKind)
      ? buildFlowchartFromMarkdown(message?.content || '', viewKind)
      : null;
  const chart = explicitChart || fallbackChart;
  if (isDiagramDedicatedView(viewKind) && !chart) {
    return (
      <div className="rounded border border-amber-700/70 bg-amber-950/20 p-3 text-xs text-amber-100">
        {viewKind === 'user_flow'
          ? 'User Flow として作図できるユーザー操作や画面遷移が見つかりません。実装手順は Feature Plan または Activity Flow に残してください。'
          : `${formatViewLabel(viewKind)} は Mermaid 図が必要です。再生成するか、文章で足りる内容は spec に残してください。`}
      </div>
    );
  }
  if (chart) {
    const notes = stripMermaidBlocks(message?.content || '').trim();
    return (
      <div className="grid gap-3">
        <div className="rounded border border-slate-800 bg-slate-950/20 p-3 text-xs">
          <div className="font-semibold text-slate-100">{artifact?.title || 'Plan View'}</div>
          <div className="mt-1 text-slate-500">
            {artifact?.kind || viewKind || 'view'}{' '}
            {artifact?.sourceMessageId ? `message ${artifact.sourceMessageId.slice(0, 8)}` : ''}
          </div>
        </div>
        <div className="grid gap-3 rounded border border-cyan-500/30 bg-slate-950/30 p-3">
          <div className="text-[11px] font-semibold uppercase text-cyan-100">Mermaid diagram</div>
          <MermaidDiagram
            chart={chart}
            idPrefix={`dedicated-${viewKind || 'view'}`}
            downloadName={`${viewKind || 'dedicated-view'}-mermaid.svg`}
          />
        </div>
        {notes ? <MarkdownViewer content={notes} /> : null}
      </div>
    );
  }
  return (
    <div className="grid gap-3">
      <div className="rounded border border-slate-800 bg-slate-950/20 p-3 text-xs">
        <div className="font-semibold text-slate-100">{artifact?.title || 'Plan View'}</div>
        <div className="mt-1 text-slate-500">
          {artifact?.kind || 'view'}{' '}
          {artifact?.sourceMessageId ? `message ${artifact.sourceMessageId.slice(0, 8)}` : ''}
        </div>
      </div>
      <MarkdownViewer content={message?.content || 'No Markdown content.'} />
    </div>
  );
}
