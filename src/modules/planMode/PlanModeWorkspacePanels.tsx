import { Check, Download, LoaderCircle } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { BlueprintPreview, mockBlueprintToPreviewBlueprintSafely } from '../blueprint-preview';
import { MarkdownViewer } from '../nightworkers/components/ArtifactFileViewers';
import type {
  ActivityArtifact,
  DesignQuestionnaireSession,
  PlanModeCapability,
  PlanModeSettings,
  PlanModeWorkspace,
  PlanModeWorkspaceArtifact,
  TaskMessage,
} from '../nightworkers/types';
import { toMs } from '../nightworkers/workbenchSelectorUtils';
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

export const PLAN_MODE_SEQUENTIAL_AUTO_GENERATE_STORAGE_KEY =
  'nightworkers.planMode.sequentialAutoGenerate';

export function readPlanModeSequentialAutoGeneratePreference(storage?: Storage | null) {
  try {
    const source = storage ?? (typeof window === 'undefined' ? null : window.localStorage);
    return source?.getItem(PLAN_MODE_SEQUENTIAL_AUTO_GENERATE_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function writePlanModeSequentialAutoGeneratePreference(
  enabled: boolean,
  storage?: Storage | null
) {
  try {
    const source = storage ?? (typeof window === 'undefined' ? null : window.localStorage);
    if (!source) return;
    source.setItem(PLAN_MODE_SEQUENTIAL_AUTO_GENERATE_STORAGE_KEY, enabled ? 'true' : 'false');
  } catch {
    // localStorage is a UI preference only; the Status flow still works without persistence.
  }
}

export function WorkspaceBlueprintPreview({
  sessionId,
  message,
  activityArtifacts = [],
  empty = 'No Blueprint artifact.',
}: {
  sessionId: string | null;
  message: TaskMessage | null;
  activityArtifacts?: ActivityArtifact[];
  empty?: string;
}) {
  const source = previewBlueprintFromSources({ message, activityArtifacts });
  const blueprint = source.blueprint;
  if (!isRecord(blueprint)) {
    if (source.isMockBlueprintCandidate) {
      return <BlueprintPreviewUnavailable />;
    }
    return <MarkdownViewer content={message?.content || empty} />;
  }
  const screens = toRecordArray(blueprint.screens);
  const validation = source.validation;
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

export function previewBlueprintFromSources({
  message,
  activityArtifacts,
}: {
  message: TaskMessage | null;
  activityArtifacts: ActivityArtifact[];
}) {
  const metadata = isRecord(message?.metadataJson) ? message.metadataJson : {};
  const linkedArtifact = findMessageActivityArtifact(message, activityArtifacts);
  const linkedMetadata = isRecord(linkedArtifact?.metadataJson) ? linkedArtifact.metadataJson : {};
  const linkedContent = parseJsonRecord(linkedArtifact?.contentText);

  const sources = [
    { payload: metadata.mockBlueprint, validation: metadata.validation },
    { payload: linkedMetadata.mockBlueprint, validation: linkedMetadata.validation },
    { payload: linkedContent, validation: linkedMetadata.validation },
    ...(!message
      ? latestBlueprintActivityArtifact(activityArtifacts).map((artifact) => {
          const artifactMetadata = isRecord(artifact.metadataJson) ? artifact.metadataJson : {};
          return {
            payload:
              artifactMetadata.mockBlueprint ||
              artifactMetadata.appBlueprint ||
              parseJsonRecord(artifact.contentText),
            validation: artifactMetadata.validation,
          };
        })
      : []),
    { payload: metadata.appBlueprint, validation: metadata.validation },
  ];

  let sawInvalidMockBlueprint = false;
  for (const source of sources) {
    if (!isRecord(source.payload)) continue;
    if (isMockBlueprintCandidate(source.payload)) {
      const blueprint = mockBlueprintToPreviewBlueprintSafely(source.payload);
      if (!isRecord(blueprint)) {
        sawInvalidMockBlueprint = true;
        continue;
      }
      return {
        blueprint,
        validation: source.validation,
        isMockBlueprintCandidate: true,
      };
    }
    return {
      blueprint: source.payload,
      validation: source.validation,
      isMockBlueprintCandidate: false,
    };
  }
  return { blueprint: null, validation: null, isMockBlueprintCandidate: sawInvalidMockBlueprint };
}

export function findMessageActivityArtifact(
  message: TaskMessage | null,
  activityArtifacts: ActivityArtifact[]
) {
  const metadata = isRecord(message?.metadataJson) ? message.metadataJson : {};
  const artifactRef = isRecord(metadata.artifactRef) ? metadata.artifactRef : {};
  const artifactId = typeof artifactRef.artifactId === 'string' ? artifactRef.artifactId : null;
  if (artifactId) {
    const artifact = activityArtifacts.find((item) => item.id === artifactId);
    if (artifact) return artifact;
  }
  return activityArtifacts.find((artifact) => {
    const artifactMetadata = isRecord(artifact.metadataJson) ? artifact.metadataJson : {};
    return typeof message?.id === 'string' && artifactMetadata.messageId === message.id;
  });
}

export function latestBlueprintActivityArtifact(activityArtifacts: ActivityArtifact[]) {
  return [...activityArtifacts]
    .filter((artifact) => artifact.kind === 'app_blueprint')
    .sort((a, b) => toMs(b.createdAt) - toMs(a.createdAt))
    .slice(0, 1);
}

export function parseJsonRecord(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function isMockBlueprintCandidate(value: unknown) {
  return isRecord(value) && value.artifactKind === 'mock_blueprint';
}

function BlueprintPreviewUnavailable() {
  return (
    <div className="rounded border border-amber-700/70 bg-amber-950/20 p-3 text-xs text-amber-100">
      Blueprint preview is unavailable.
    </div>
  );
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

function MermaidDiagram({
  chart,
  idPrefix = 'data-model',
  downloadName = 'data-model-mermaid.svg',
}: {
  chart: string;
  idPrefix?: string;
  downloadName?: string;
}) {
  const rawId = useId();
  const diagramId = useMemo(
    () => `${idPrefix}-${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`,
    [idPrefix, rawId]
  );
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
    link.download = downloadName;
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
  const [sequentialAutoGenerate, setSequentialAutoGenerate] = useState(
    readPlanModeSequentialAutoGeneratePreference
  );
  const autoGenerateInFlightStepRef = useRef<string | null>(null);
  const autoGenerateBlockedStepRef = useRef<string | null>(null);
  const answeredCount = questionnaireSession?.answers.length || 0;
  const questionCount = questionnaireSession ? getQuestionCount(questionnaireSession) : 0;
  const hasBlueprint = Boolean(workspace?.blueprintArtifacts.length);
  const hasDataModel = Boolean(workspace?.dataModelArtifacts.length);
  const hasRoutingDecisions = viewDecisions.length > 0;
  const decisionByView = new Map(viewDecisions.map((item) => [item.view, item]));
  const isIncluded = (view: string) => decisionByView.get(view)?.decision === 'include';
  const isOmitted = (view: string) => decisionByView.get(view)?.decision === 'omit';
  const shouldShowDefault = (
    view: string,
    enabled: boolean,
    exists: boolean,
    defaultWhenUnrouted = false
  ) =>
    !isOmitted(view) &&
    (exists || isIncluded(view) || (!hasRoutingDecisions && defaultWhenUnrouted && enabled));
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
  const disabledReason = 'Plan Mode capability is disabled in Settings.';
  const questionnaireDone = Boolean(
    questionnaireSession &&
      (questionnaireSession.status === 'review_ready' || questionnaireSession.status === 'accepted')
  );
  const steps = [
    shouldShowDefault(
      'questionnaire',
      capabilities.questionnaire,
      Boolean(questionnaireSession),
      true
    )
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
          autoGenerate: false,
          autoGenerateKey: 'questionnaire',
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
          autoGenerate: true,
          autoGenerateKey: 'blueprint',
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
          autoGenerate: true,
          autoGenerateKey: 'data-model',
        }
      : null,
    ...includedAdditionalViews.map((item, index) => {
      const view = item.view;
      const label = formatViewLabel(view);
      const generated = generatedAdditionalViews.has(view);
      const enabled = capabilities[view];
      return {
        number: 4 + index,
        title: `${label}を作成します`,
        detail: generated
          ? `${label}が作成済みです。`
          : item.reason || `${label}をPlan Mode Artifactとして作成します。`,
        done: generated,
        buttonLabel: generated ? `${label}を再生成` : `${label}作成`,
        busy: busyAction === `view:${view}`,
        disabled: isImplementationLocked || !enabled,
        disabledReason: enabled ? null : disabledReason,
        onClick: () => onGenerateDedicatedViews([view]),
        autoGenerate: true,
        autoGenerateKey: `view:${view}`,
      };
    }),
    {
      number: 5,
      title: '仕様書を作成します',
      detail: hasFeaturePlan
        ? '仕様書が作成済みです。'
        : '利用可能なPlan Mode Artifactを要約して仕様書を生成します。',
      done: hasFeaturePlan,
      buttonLabel: hasFeaturePlan ? '仕様書を再生成' : '仕様書作成',
      busy: busyAction === 'feature-plan',
      disabled: isImplementationLocked || !capabilities.feature_plan,
      disabledReason: !capabilities.feature_plan ? disabledReason : null,
      onClick: onGenerateFeaturePlan,
      autoGenerate: true,
      autoGenerateKey: 'feature-plan',
    },
  ].filter((step): step is NonNullable<typeof step> => Boolean(step));
  const allStepsDone = steps.every((step) => step.done);
  const nextAutoGenerateStep = steps.find(
    (step) => step.autoGenerate && !step.done && !step.disabled
  );

  useEffect(() => {
    if (!sequentialAutoGenerate || busyAction || !nextAutoGenerateStep) {
      if (!nextAutoGenerateStep) autoGenerateBlockedStepRef.current = null;
      return;
    }
    if (autoGenerateInFlightStepRef.current) return;
    if (autoGenerateBlockedStepRef.current === nextAutoGenerateStep.autoGenerateKey) return;
    autoGenerateInFlightStepRef.current = nextAutoGenerateStep.autoGenerateKey;
    void Promise.resolve(nextAutoGenerateStep.onClick()).finally(() => {
      autoGenerateInFlightStepRef.current = null;
      autoGenerateBlockedStepRef.current = nextAutoGenerateStep.autoGenerateKey;
    });
  }, [busyAction, nextAutoGenerateStep, sequentialAutoGenerate]);

  function handleSequentialAutoGenerateChange(enabled: boolean) {
    setSequentialAutoGenerate(enabled);
    writePlanModeSequentialAutoGeneratePreference(enabled);
    autoGenerateBlockedStepRef.current = null;
  }

  return (
    <div className="grid gap-3 text-xs">
      <div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-slate-100">Status</h2>
          <label className="inline-flex items-center gap-2 text-[11px] text-slate-300">
            <input
              type="checkbox"
              checked={sequentialAutoGenerate}
              onChange={(event) => handleSequentialAutoGenerateChange(event.target.checked)}
            />
            順次自動生成
          </label>
        </div>
        <p className="mt-1 text-slate-400">必要なArtifactを確認し、仕様書を作成します。</p>
      </div>
      <ViewDecisionSummary decisions={viewDecisions} />
      <div className="grid gap-3">
        {steps.map((step, index) => {
          const displayNumber = index + 1;
          return (
            <div
              key={`${step.number}-${step.title}`}
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
  if (!artifact && !message) return <MarkdownViewer content="No plan view artifact." />;
  const metadata = isRecord(message?.metadataJson) ? message.metadataJson : {};
  const viewKind = String(artifact?.kind || metadata.view || '');
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

function isDiagramDedicatedView(view: string) {
  return (
    view === 'user_flow' ||
    view === 'activity_flow' ||
    view === 'state_model' ||
    view === 'sequence_flow'
  );
}

function isFlowchartPlanView(view: string) {
  return view === 'user_flow' || view === 'activity_flow';
}

function extractMermaidChart(content: string) {
  const match = content.match(/```mermaid\s*([\s\S]*?)```/i);
  return match?.[1]?.trim() || null;
}

function stripMermaidBlocks(content: string) {
  return content.replace(/```mermaid\s*[\s\S]*?```/gi, '').trim();
}

export function buildFlowchartFromMarkdown(content: string, viewKind = '') {
  const labels = extractMarkdownFlowLabels(content).filter(
    (label) => viewKind !== 'user_flow' || isUserFlowLabel(label)
  );
  if (labels.length === 0) return null;
  if (viewKind === 'user_flow' && labels.length < 2) return null;
  const nodes = labels.map((label, index) => `  step${index + 1}["${sanitizeFlowLabel(label)}"]`);
  const edges = labels.slice(1).map((_, index) => `  step${index + 1} --> step${index + 2}`);
  return ['flowchart TD', ...nodes, ...edges].join('\n');
}

function isUserFlowLabel(label: string) {
  const normalized = label.replace(/`([^`]*)`/g, '$1').trim();
  if (
    /\b[\w-]+\.(css|ts|tsx|js|jsx|json|md|sql|rs|go|py|rb|java|kt|swift|html)\b/i.test(normalized)
  ) {
    return false;
  }
  if (/\b(src|api|tests?|shared|components|modules)\//i.test(normalized)) return false;
  return true;
}

function extractMarkdownFlowLabels(content: string) {
  const lines = content
    .replace(/```[\s\S]*?```/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const listItems = lines
    .map((line) =>
      line
        .replace(/^\d+[.)]\s+/, '')
        .replace(/^[-*]\s+\[[ xX]\]\s+/, '')
        .replace(/^[-*]\s+/, '')
        .trim()
    )
    .filter((line, index) => line !== lines[index] && line.length > 0);
  if (listItems.length > 0) return listItems;
  return lines
    .filter((line) => !line.startsWith('#'))
    .map((line) => line.replace(/^#+\s*/, '').trim())
    .filter(Boolean);
}

function sanitizeFlowLabel(label: string) {
  return label
    .replace(/`([^`]*)`/g, '$1')
    .replace(/`/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_~]/g, '')
    .replace(/[{}<>]/g, ' ')
    .replaceAll('[', ' ')
    .replaceAll(']', ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');
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
