import { Check, Download, LoaderCircle } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { BlueprintPreview, mockBlueprintToPreviewBlueprintSafely } from '../blueprint-preview';
import { MarkdownViewer } from '../nightworkers/components/ArtifactFileViewers';
import type {
  DesignQuestionnaireSession,
  PlanModeCapability,
  PlanModeSettings,
  PlanModeWorkspace,
  PlanModeWorkspaceArtifact,
  TaskMessage,
} from '../nightworkers/types';
import { getQuestionCount } from './PlanModeQuestionnaire';

type AdditionalPlanView = Exclude<
  PlanModeCapability,
  'feature_plan' | 'questionnaire' | 'blueprint' | 'data_model'
>;

const ADDITIONAL_PLAN_VIEWS: readonly AdditionalPlanView[] = [
  'user_flow',
  'api_io_contract',
  'state_model',
  'activity_flow',
  'sequence_flow',
  'zod_schema_design',
];

export type PlanViewDecision = {
  view: string;
  decision: 'include' | 'omit';
  reason?: string;
};

export function WorkspaceBlueprintPreview({
  sessionId,
  message,
  empty = 'No Blueprint artifact.',
}: {
  sessionId: string | null;
  message: TaskMessage | null;
  empty?: string;
}) {
  const metadata = isRecord(message?.metadataJson) ? message.metadataJson : {};
  const blueprint = previewBlueprintFromMetadata(metadata);
  if (!isRecord(blueprint)) {
    return <MarkdownViewer content={message?.content || empty} />;
  }
  const screens = toRecordArray(blueprint.screens);
  const validation = metadata.validation;
  const issues = isRecord(validation) ? toRecordArray(validation.issues) : [];
  return (
    <BlueprintPreview
      key={String(blueprint.id || blueprint.name || screens[0]?.id || message?.id || 'blueprint')}
      sessionId={sessionId}
      messageId={message?.id || null}
      blueprint={blueprint}
      screens={screens}
      validationIssues={issues}
    />
  );
}

function previewBlueprintFromMetadata(metadata: Record<string, unknown>) {
  if (isRecord(metadata.mockBlueprint)) {
    return mockBlueprintToPreviewBlueprintSafely(metadata.mockBlueprint);
  }
  return metadata.appBlueprint;
}

export function WorkspaceDataModelPanel({
  message,
  empty = 'No Data Model artifact.',
}: {
  message: TaskMessage | null;
  empty?: string;
}) {
  const metadata = isRecord(message?.metadataJson) ? message.metadataJson : {};
  const dataModel = firstRecord(
    metadata.dataModel,
    metadata.artifactPayload,
    metadata.dataModelArtifact
  );
  if (!message && !dataModel) return <MarkdownViewer content={empty} />;
  if (!dataModel) return <MarkdownViewer content={message?.content || empty} />;

  const title = stringValue(dataModel.title) || stringValue(metadata.title) || 'Data Model';
  const summary = stringValue(dataModel.summary);
  const canonicalSource = formatCanonicalSource(stringValue(dataModel.canonicalSource));
  const ddl = stringValue(dataModel.ddl);
  const tables = toRecordArray(dataModel.derivedTables);
  const relations = toRecordArray(dataModel.relations);

  return (
    <div className="grid gap-4 text-xs">
      <div className="rounded border border-slate-800 bg-slate-950/20 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold text-slate-100">{title}</h2>
          <span className="rounded border border-cyan-500/40 bg-cyan-950/30 px-2 py-0.5 text-[10px] uppercase text-cyan-100">
            {canonicalSource || 'Canonical source unknown'}
          </span>
        </div>
        {summary ? <p className="mt-2 text-slate-400">{summary}</p> : null}
        <p className="mt-2 text-[11px] text-slate-500">
          Source message {message?.id?.slice(0, 8) || 'unknown'}
        </p>
      </div>
      {tables.length > 0 ? <DataModelDiagram tables={tables} relations={relations} /> : null}
      {ddl ? (
        <div className="rounded border border-slate-800 bg-slate-950/20 p-3">
          <div className="mb-2 text-[11px] font-semibold uppercase text-slate-400">DDL</div>
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
              .join(' · ')
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
  const diagram = useMemo(() => buildMermaidErDiagram(tables, relations), [tables, relations]);
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

function MermaidDiagram({ chart }: { chart: string }) {
  const rawId = useId();
  const diagramId = useMemo(() => `data-model-${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`, [rawId]);
  const containerRef = useRef<HTMLButtonElement | null>(null);
  const fullscreenContainerRef = useRef<HTMLButtonElement | null>(null);
  const [rendered, setRendered] = useState(false);
  const [renderedSvg, setRenderedSvg] = useState('');
  const [error, setError] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    containerRef.current?.replaceChildren();
    setRendered(false);
    setRenderedSvg('');
    setError('');
    setIsFullscreen(false);
    import('mermaid')
      .then(async ({ default: mermaid }) => {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: 'dark',
          themeVariables: {
            darkMode: true,
            background: '#020617',
            mainBkg: '#0f172a',
            primaryColor: '#164e63',
            primaryTextColor: '#e2e8f0',
            lineColor: '#67e8f9',
            textColor: '#e2e8f0',
          },
        });
        const rendered = await mermaid.render(diagramId, chart);
        if (cancelled || !containerRef.current) return;
        if (!replaceMermaidSvg(containerRef.current, rendered.svg)) {
          throw new Error('Mermaid did not return SVG output.');
        }
        setRenderedSvg(rendered.svg);
        setRendered(true);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [chart, diagramId]);

  useEffect(() => {
    if (isFullscreen && renderedSvg) {
      replaceMermaidSvg(fullscreenContainerRef.current, renderedSvg);
    }
  }, [isFullscreen, renderedSvg]);

  const handleDownload = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (!renderedSvg) return;
    const blob = new Blob([renderedSvg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'data-model-mermaid.svg';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const renderDownloadButton = () => (
    <button
      type="button"
      className="inline-flex h-7 w-7 items-center justify-center rounded border border-slate-700 bg-slate-950/90 text-slate-200 shadow hover:border-cyan-400/70 hover:text-cyan-100 disabled:cursor-not-allowed disabled:opacity-50"
      title="Download Mermaid SVG"
      aria-label="Download Mermaid SVG"
      disabled={!renderedSvg}
      onClick={handleDownload}
    >
      <Download className="h-3.5 w-3.5" />
    </button>
  );

  return (
    <div className="grid gap-2">
      <div className="relative">
        <div className="absolute right-2 top-2 z-10">{renderDownloadButton()}</div>
        <button
          type="button"
          ref={containerRef}
          className={`w-full overflow-x-auto rounded border border-slate-800 bg-slate-950 p-3 pr-12 text-left [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full ${
            rendered ? 'cursor-zoom-in' : 'hidden'
          }`}
          onClick={() => {
            if (renderedSvg) setIsFullscreen(true);
          }}
          aria-label="Open Mermaid diagram fullscreen"
          title={renderedSvg ? 'Open Mermaid diagram fullscreen' : undefined}
        />
      </div>
      {!rendered ? (
        <pre className="nightworkers-code-block overflow-x-auto rounded border border-slate-800 bg-slate-950 p-3 text-[11px] text-slate-200">
          <code>{chart}</code>
        </pre>
      ) : null}
      {error ? (
        <div className="text-[11px] text-amber-300">Mermaid render failed: {error}</div>
      ) : null}
      <details className="text-[11px] text-slate-400">
        <summary className="cursor-pointer text-slate-300">Mermaid source</summary>
        <pre className="mt-2 overflow-x-auto rounded border border-slate-800 bg-slate-950 p-3 text-[11px] text-slate-300">
          <code>{chart}</code>
        </pre>
      </details>
      {isFullscreen && renderedSvg ? (
        <div className="fixed inset-0 z-50 grid bg-slate-950/95 p-4">
          <div className="absolute right-4 top-4 z-10">{renderDownloadButton()}</div>
          <button
            type="button"
            ref={fullscreenContainerRef}
            className="min-h-0 cursor-zoom-out overflow-auto rounded border border-cyan-500/40 bg-slate-950 p-4 text-left [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-h-[calc(100vh-4rem)] [&_svg]:max-w-full"
            aria-label="Close fullscreen Mermaid diagram"
            title="Close fullscreen Mermaid diagram"
            onClick={() => setIsFullscreen(false)}
          />
        </div>
      ) : null}
    </div>
  );
}

function replaceMermaidSvg(target: Element | null, svg: string) {
  if (!target) return false;
  const parsedSvg = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const svgElement = parsedSvg.documentElement;
  if (svgElement.nodeName.toLowerCase() !== 'svg') return false;
  target.replaceChildren(document.importNode(svgElement, true));
  return true;
}

export function PlanWorkspaceStatusView({
  workspace,
  questionnaireSession,
  busyAction,
  canGenerateDataModel,
  hasFeaturePlan,
  isImplementationLocked = false,
  planModeSettings,
  viewDecisions = [],
  onOpenQuestionnaire,
  onGenerateBlueprint,
  onGenerateDataModel,
  onGenerateFeaturePlan,
  onGenerateDedicatedViews,
  onQueueSession,
  onAddToQueue,
}: {
  workspace: PlanModeWorkspace | null;
  questionnaireSession: DesignQuestionnaireSession | null;
  busyAction: string | null;
  canGenerateDataModel: boolean;
  hasFeaturePlan: boolean;
  isImplementationLocked?: boolean;
  planModeSettings?: PlanModeSettings;
  viewDecisions?: PlanViewDecision[];
  onOpenQuestionnaire: () => void;
  onGenerateBlueprint: () => void;
  onGenerateDataModel: () => void;
  onGenerateFeaturePlan: () => void;
  onGenerateDedicatedViews: (views: string[]) => void;
  onQueueSession?: () => void;
  onAddToQueue?: () => void;
}) {
  const answeredCount = questionnaireSession?.answers.length || 0;
  const questionCount = questionnaireSession ? getQuestionCount(questionnaireSession) : 0;
  const hasBlueprint = Boolean(workspace?.blueprintArtifacts.length);
  const hasDataModel = Boolean(workspace?.dataModelArtifacts.length);
  const hasRoutingDecisions = viewDecisions.length > 0;
  const decisionByView = new Map(viewDecisions.map((item) => [item.view, item]));
  const isIncluded = (view: string) => decisionByView.get(view)?.decision === 'include';
  const shouldShowDefault = (view: string, enabled: boolean, exists: boolean) =>
    exists || isIncluded(view) || (!hasRoutingDecisions && enabled);
  const capabilities = planModeSettings?.capabilities ?? {
    feature_plan: true,
    questionnaire: true,
    user_flow: true,
    blueprint: true,
    data_model: true,
    api_io_contract: true,
    state_model: true,
    activity_flow: true,
    sequence_flow: true,
    zod_schema_design: true,
  };
  const includedAdditionalViews = viewDecisions.filter(
    (item): item is PlanViewDecision & { view: AdditionalPlanView } =>
      item.decision === 'include' && isAdditionalView(item.view)
  );
  const generatedAdditionalViews = new Set<AdditionalPlanView>(
    (workspace?.dedicatedViewArtifacts || [])
      .map((artifact) => artifact.kind)
      .filter(isAdditionalView)
  );
  const enabledIncludedAdditionalViews = includedAdditionalViews
    .map((item) => item.view)
    .filter((view) => capabilities[view]);
  const disabledIncludedAdditionalViews = includedAdditionalViews
    .map((item) => item.view)
    .filter((view) => !capabilities[view]);
  const missingAdditionalViews = enabledIncludedAdditionalViews.filter(
    (view) => !generatedAdditionalViews.has(view)
  );
  const includedAdditionalViewCount = includedAdditionalViews.length;
  const generatedAdditionalViewCount = enabledIncludedAdditionalViews.filter((view) =>
    generatedAdditionalViews.has(view)
  ).length;
  const disabledReason = 'Plan Mode capability is disabled in Settings.';
  const additionalViewDisabledReason =
    disabledIncludedAdditionalViews.length > 0
      ? `Disabled in Settings: ${disabledIncludedAdditionalViews.map(formatViewLabel).join(' / ')}`
      : null;
  const questionnaireDone = Boolean(
    questionnaireSession &&
      (questionnaireSession.status === 'review_ready' || questionnaireSession.status === 'accepted')
  );
  const steps = [
    shouldShowDefault('questionnaire', capabilities.questionnaire, Boolean(questionnaireSession))
      ? {
          number: 1,
          title: '仕様に関する質問を回答してください',
          detail:
            questionCount > 0
              ? `Questionnaire ${answeredCount}/${questionCount}`
              : '仕様判断に必要な質問を先に確認します。',
          done: questionnaireDone,
          buttonLabel: questionnaireDone ? 'アンケートを確認' : 'アンケートへ',
          busy: false,
          disabled: !capabilities.questionnaire,
          disabledReason: capabilities.questionnaire ? null : disabledReason,
          onClick: onOpenQuestionnaire,
        }
      : null,
    shouldShowDefault('blueprint', capabilities.blueprint, hasBlueprint)
      ? {
          number: 2,
          title: 'インスタントMockUpを作成し、大筋UIの方向性を決めます',
          detail: hasBlueprint
            ? `${workspace?.blueprintArtifacts.length || 0}件のBlueprintがあります。`
            : '画面構成と主要UIセクションを生成します。',
          done: hasBlueprint,
          buttonLabel: hasBlueprint ? 'Blueprintを再生成' : 'Blueprint作成',
          busy: busyAction === 'blueprint',
          disabled: isImplementationLocked || !capabilities.blueprint,
          disabledReason: !capabilities.blueprint ? disabledReason : null,
          onClick: onGenerateBlueprint,
        }
      : null,
    shouldShowDefault('data_model', capabilities.data_model, hasDataModel)
      ? {
          number: 3,
          title: 'どの様なデータモデルが必要になるかプレビュー出来ます',
          detail: hasDataModel
            ? `${workspace?.dataModelArtifacts.length || 0}件のData Modelがあります。`
            : 'Data Modelでテーブル、カラム、リレーションを確認します。',
          done: hasDataModel,
          buttonLabel: hasDataModel ? 'Data Modelを再生成' : 'Data Model作成',
          busy: busyAction === 'data-model',
          disabled: !canGenerateDataModel || isImplementationLocked || !capabilities.data_model,
          disabledReason: !capabilities.data_model ? disabledReason : null,
          onClick: onGenerateDataModel,
        }
      : null,
    includedAdditionalViewCount > 0
      ? {
          number: 4,
          title: '追加の dedicated design view を確認します',
          detail:
            enabledIncludedAdditionalViews.length > 0
              ? `${generatedAdditionalViewCount}/${enabledIncludedAdditionalViews.length}件の追加 view が生成済みです。`
              : `${includedAdditionalViewCount}件の追加 view はSettingsで無効です。`,
          done: missingAdditionalViews.length === 0,
          buttonLabel: missingAdditionalViews.length > 0 ? '追加Viewを生成' : '生成状況を確認',
          busy: Boolean(busyAction?.startsWith('view:')),
          disabled: isImplementationLocked || missingAdditionalViews.length === 0,
          disabledReason: additionalViewDisabledReason,
          onClick: () => onGenerateDedicatedViews(missingAdditionalViews),
        }
      : null,
    {
      number: 5,
      title: '仕様書を作成します',
      detail: hasFeaturePlan
        ? '仕様書が作成済みです。'
        : '利用可能なQuestionnaire、Blueprint、Data Modelを要約して仕様書を生成します。',
      done: hasFeaturePlan,
      buttonLabel: hasFeaturePlan ? '仕様書を再生成' : '仕様書作成',
      busy: busyAction === 'feature-plan',
      disabled: isImplementationLocked || !capabilities.feature_plan,
      disabledReason: !capabilities.feature_plan ? disabledReason : null,
      onClick: onGenerateFeaturePlan,
    },
  ].filter((step): step is NonNullable<typeof step> => Boolean(step));
  const allStepsDone = steps.every((step) => step.done);
  return (
    <div className="grid gap-3 text-xs">
      <div>
        <h2 className="text-base font-semibold text-slate-100">Status</h2>
        <p className="mt-1 text-slate-400">必要なArtifactを確認し、仕様書を作成します。</p>
      </div>
      <ViewDecisionSummary decisions={viewDecisions} />
      <div className="grid gap-3">
        {steps.map((step, index) => {
          const displayNumber = index + 1;
          return (
            <div
              key={step.number}
              className="grid gap-3 rounded border border-slate-800 bg-slate-950/20 p-3 md:grid-cols-[1fr_auto] md:items-center"
            >
              <div className="flex gap-3">
                <div className="flex flex-col items-center">
                  <div
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold ${
                      step.done
                        ? 'border-emerald-400/70 bg-emerald-950/40 text-emerald-100'
                        : 'border-slate-700 bg-slate-900 text-slate-300'
                    }`}
                  >
                    {step.done ? <Check className="h-3.5 w-3.5" /> : displayNumber}
                  </div>
                  {index < steps.length - 1 ? (
                    <div className="mt-2 min-h-8 w-px flex-1 bg-slate-800" />
                  ) : null}
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-100">
                    {displayNumber}. {step.title}
                  </div>
                  <div className="mt-1 text-slate-400">{step.detail}</div>
                  {step.disabledReason ? (
                    <div className="mt-1 text-[11px] text-amber-300">{step.disabledReason}</div>
                  ) : null}
                </div>
              </div>
              <StatusActionButton
                label={step.buttonLabel}
                busy={step.busy}
                disabled={step.disabled}
                onClick={step.onClick}
              />
            </div>
          );
        })}
      </div>
      {allStepsDone ? (
        <div className="mt-4 flex flex-wrap justify-center gap-3">
          <StatusActionButton
            label="今すぐ実装開始"
            busy={busyAction === 'start-session'}
            disabled={!onQueueSession || isImplementationLocked}
            onClick={() => onQueueSession?.()}
            size="lg"
          />
          <StatusActionButton
            label="キューに追加"
            busy={busyAction === 'add-to-queue'}
            disabled={!onAddToQueue || isImplementationLocked}
            onClick={() => onAddToQueue?.()}
            size="lg"
          />
        </div>
      ) : null}
    </div>
  );
}

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
  if (items.length === 0) return <p className="text-xs text-slate-500">{empty}</p>;
  return (
    <div className="grid gap-2">
      {items.map((item) => (
        <div key={item.id} className="rounded border border-slate-800 bg-slate-950/20 p-3 text-xs">
          <div className="font-medium text-slate-100">{item.title}</div>
          <div className="mt-1 text-slate-500">
            {item.kind || 'artifact'}{' '}
            {item.sourceMessageId ? `message ${item.sourceMessageId.slice(0, 8)}` : ''}
            {item.adoptionState ? ` · ${item.adoptionState}` : ''}
          </div>
        </div>
      ))}
    </div>
  );
}

export function DedicatedViewPanel({
  artifact,
  message,
}: {
  artifact: PlanModeWorkspaceArtifact | null;
  message: TaskMessage | null;
}) {
  if (!artifact && !message) return <MarkdownViewer content="No dedicated view artifact." />;
  return (
    <div className="grid gap-3">
      <div className="rounded border border-slate-800 bg-slate-950/20 p-3 text-xs">
        <div className="font-semibold text-slate-100">{artifact?.title || 'Dedicated View'}</div>
        <div className="mt-1 text-slate-500">
          {artifact?.kind || 'view'}{' '}
          {artifact?.sourceMessageId ? `message ${artifact.sourceMessageId.slice(0, 8)}` : ''}
        </div>
      </div>
      <MarkdownViewer content={message?.content || 'No Markdown content.'} />
    </div>
  );
}

export function ViewDecisionSummary({ decisions }: { decisions: PlanViewDecision[] }) {
  if (decisions.length === 0) return null;
  return (
    <div className="grid gap-2 rounded border border-slate-800 bg-slate-950/20 p-3 text-xs">
      <div className="font-semibold text-slate-100">View decisions</div>
      <div className="flex flex-wrap gap-2">
        {decisions.map((decision) => (
          <span
            key={`${decision.view}-${decision.decision}`}
            className={`rounded border px-2 py-1 ${
              decision.decision === 'include'
                ? 'border-emerald-500/40 bg-emerald-950/30 text-emerald-100'
                : 'border-slate-700 bg-slate-900/60 text-slate-300'
            }`}
          >
            {formatViewLabel(decision.view)}: {decision.decision}
            {decision.reason ? ` - ${decision.reason}` : ''}
          </span>
        ))}
      </div>
    </div>
  );
}

function StatusActionButton({
  label,
  busy,
  disabled,
  onClick,
  size = 'sm',
}: {
  label: string;
  busy: boolean;
  disabled?: boolean;
  onClick: () => void;
  size?: 'sm' | 'lg';
}) {
  return (
    <button
      type="button"
      className={`inline-flex items-center gap-1.5 rounded border border-cyan-500/60 bg-cyan-950/30 text-cyan-100 disabled:cursor-not-allowed disabled:opacity-45 ${
        size === 'lg' ? 'px-4 py-2 text-sm font-semibold' : 'px-2 py-1 text-xs'
      }`}
      disabled={busy || disabled}
      onClick={onClick}
    >
      {busy ? <LoaderCircle className="h-3 w-3 animate-spin" /> : null}
      {label}
    </button>
  );
}

function SummaryList({
  title,
  items,
  tone = 'slate',
}: {
  title: string;
  items: string[];
  tone?: 'slate' | 'amber';
}) {
  const textClass = tone === 'amber' ? 'text-amber-100' : 'text-slate-300';
  return (
    <div className="rounded border border-slate-800 bg-slate-950/20 p-3 text-xs">
      <div className="mb-2 text-[11px] font-semibold uppercase text-slate-400">{title}</div>
      <ul className={`grid gap-1 ${textClass}`}>
        {items.map((item, index) => (
          <li key={`${title}-${index}`}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

type RelationEdge = {
  from: string;
  to: string;
  cardinality: string;
  reason: string;
};

export function buildMermaidErDiagram(
  tables: Array<Record<string, unknown>>,
  relations: Array<Record<string, unknown>>
) {
  const relationEdges = relations
    .map(toRelationEdge)
    .filter((edge): edge is RelationEdge => Boolean(edge));
  const tableNames = tables.map((table, index) => stringValue(table.name) || `table_${index + 1}`);
  const entityByTableName = new Map(
    tableNames.map((tableName) => [tableName, sanitizeMermaidIdentifier(tableName)])
  );
  const lines = ['erDiagram'];

  tables.forEach((table, index) => {
    const tableName = tableNames[index] || `table_${index + 1}`;
    const entityName = entityByTableName.get(tableName) || sanitizeMermaidIdentifier(tableName);
    const columns = toRecordArray(table.columns);
    lines.push(`  ${entityName} {`);
    if (columns.length === 0) {
      lines.push('    string no_columns');
    }
    columns.forEach((column, columnIndex) => {
      const columnName = stringValue(column.name) || `column_${columnIndex + 1}`;
      const type = sanitizeMermaidType(stringValue(column.type) || 'string');
      const keys = mermaidColumnKeys(tableName, column, relationEdges);
      const comment = mermaidColumnComment(column);
      lines.push(
        `    ${sanitizeMermaidIdentifier(columnName)} ${type}${keys ? ` ${keys}` : ''}${
          comment ? ` "${comment}"` : ''
        }`
      );
    });
    lines.push('  }');
  });

  relationEdges.forEach((relation) => {
    const fromTable = splitRelationEndpoint(relation.from)[0];
    const toTable = splitRelationEndpoint(relation.to)[0];
    const fromEntity = entityByTableName.get(fromTable) || sanitizeMermaidIdentifier(fromTable);
    const toEntity = entityByTableName.get(toTable) || sanitizeMermaidIdentifier(toTable);
    if (!fromEntity || !toEntity) return;
    lines.push(
      `  ${fromEntity} ${mermaidCardinality(relation.cardinality)} ${toEntity} : ${sanitizeMermaidLabel(
        relation.reason || 'relates'
      )}`
    );
  });

  return lines.join('\n');
}

function toRelationEdge(relation: Record<string, unknown>): RelationEdge | null {
  const from = stringValue(relation.from);
  const to = stringValue(relation.to);
  if (!from || !to) return null;
  return {
    from,
    to,
    cardinality: stringValue(relation.cardinality),
    reason: stringValue(relation.reason),
  };
}

function mermaidColumnKeys(
  tableName: string,
  column: Record<string, unknown>,
  relations: RelationEdge[]
) {
  const flags = [];
  const columnName = stringValue(column.name);
  if (column.primaryKey === true) flags.push('PK');
  if (isForeignKeyColumn(tableName, columnName, relations)) flags.push('FK');
  if (column.unique === true) flags.push('UK');
  return flags.join(', ');
}

function mermaidColumnComment(column: Record<string, unknown>) {
  const notes = [];
  if (column.nullable === false) notes.push('not null');
  const defaultValue = stringValue(column.defaultValue);
  if (defaultValue) notes.push(`default ${defaultValue}`);
  return notes.join(', ');
}

function isForeignKeyColumn(tableName: string, columnName: string, relations: RelationEdge[]) {
  if (!columnName) return false;
  return relations.some((relation) => {
    return endpointMatchesColumn(relation.from, tableName, columnName);
  });
}

function endpointMatchesColumn(endpoint: string, tableName: string, columnName: string) {
  const [endpointTable, endpointColumn] = splitRelationEndpoint(endpoint);
  if (!endpointColumn) return false;
  return endpointTable === tableName && endpointColumn === columnName;
}

function splitRelationEndpoint(endpoint: string) {
  const trimmed = endpoint.trim();
  const dotIndex = trimmed.lastIndexOf('.');
  if (dotIndex > 0 && dotIndex < trimmed.length - 1) {
    return [trimmed.slice(0, dotIndex), trimmed.slice(dotIndex + 1)] as const;
  }
  return [trimmed, ''] as const;
}

function mermaidCardinality(value: string) {
  const labels: Record<string, string> = {
    one_to_one: '||--||',
    one_to_many: '||--o{',
    many_to_one: '}o--||',
    many_to_many: '}o--o{',
  };
  return labels[value] || '--';
}

function sanitizeMermaidIdentifier(value: string) {
  const sanitized = value
    .trim()
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/^([0-9])/, '_$1')
    .replace(/_+/g, '_');
  return sanitized || 'unnamed';
}

function sanitizeMermaidType(value: string) {
  const sanitized = value
    .trim()
    .split(/\s+/)[0]
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/^([0-9])/, 't_$1')
    .replace(/_+/g, '_');
  return sanitized || 'string';
}

function sanitizeMermaidLabel(value: string) {
  const label =
    value.replace(/["`:]/g, ' ').replace(/\s+/g, ' ').trim().split(' ').slice(0, 10).join(' ') ||
    'relates';
  return `"${label}"`;
}

function firstRecord(...values: unknown[]) {
  return values.find(isRecord) || null;
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function formatCanonicalSource(value: string) {
  const labels: Record<string, string> = {
    ddl: 'DDL',
    json_shape: 'JSON shape',
    typescript_type: 'TypeScript type',
    zod_schema: 'Zod schema',
    storage_contract: 'Storage contract',
  };
  return labels[value] || value;
}

function isAdditionalView(value: string): value is AdditionalPlanView {
  return (ADDITIONAL_PLAN_VIEWS as readonly string[]).includes(value);
}

function formatViewLabel(value: string) {
  const labels: Record<string, string> = {
    questionnaire: 'Questionnaire',
    blueprint: 'Blueprint',
    data_model: 'Data Model',
    api_io_contract: 'API / I/O',
    state_model: 'State',
    activity_flow: 'Activity',
    sequence_flow: 'Sequence',
    zod_schema_design: 'Zod',
    user_flow: 'User Flow',
  };
  return labels[value] || value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function toRecordArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}
