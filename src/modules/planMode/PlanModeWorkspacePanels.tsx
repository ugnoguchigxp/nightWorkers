import { Check, LoaderCircle } from 'lucide-react';
import { BlueprintPreview } from '../blueprint-preview';
import { MarkdownViewer } from '../nightworkers/components/ArtifactFileViewers';
import type {
  DesignQuestionnaireSession,
  PlanModeSettings,
  PlanModeWorkspace,
  PlanModeWorkspaceArtifact,
  TaskMessage,
} from '../nightworkers/types';
import { getQuestionCount } from './PlanModeQuestionnaire';

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
  const blueprint = metadata.appBlueprint;
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
  const constraints = stringArray(dataModel.constraints);
  const openQuestions = stringArray(dataModel.openQuestions);

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
      {ddl ? (
        <div className="rounded border border-slate-800 bg-slate-950/20 p-3">
          <div className="mb-2 text-[11px] font-semibold uppercase text-slate-400">DDL</div>
          <pre className="nightworkers-code-block overflow-x-auto rounded bg-slate-950 p-3 text-[11px] text-slate-200">
            <code>{ddl}</code>
          </pre>
        </div>
      ) : null}
      {tables.length > 0 ? (
        <div className="grid gap-2">
          <div className="text-[11px] font-semibold uppercase text-slate-400">Derived tables</div>
          {tables.map((table, index) => {
            const columns = toRecordArray(table.columns);
            return (
              <div
                key={`${stringValue(table.name) || index}`}
                className="rounded border border-slate-800 bg-slate-950/20 p-3"
              >
                <div className="font-semibold text-slate-100">
                  {stringValue(table.name) || 'Table'}
                </div>
                {stringValue(table.purpose) ? (
                  <div className="mt-1 text-slate-400">{stringValue(table.purpose)}</div>
                ) : null}
                {columns.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {columns.map((column, columnIndex) => (
                      <span
                        key={`${stringValue(column.name) || columnIndex}`}
                        className="rounded border border-slate-700 bg-slate-900 px-2 py-0.5 text-[11px] text-slate-300"
                      >
                        {stringValue(column.name) || 'column'}:{' '}
                        {stringValue(column.type) || 'unknown'}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
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
      {constraints.length > 0 ? <SummaryList title="Constraints" items={constraints} /> : null}
      {openQuestions.length > 0 ? (
        <SummaryList title="Open questions" items={openQuestions} tone="amber" />
      ) : null}
      {!ddl && tables.length === 0 && message?.content ? (
        <MarkdownViewer content={message.content} />
      ) : null}
    </div>
  );
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
  const includedAdditionalViews = viewDecisions.filter(
    (item) => item.decision === 'include' && isAdditionalView(item.view)
  );
  const includedAdditionalViewCount = includedAdditionalViews.length;
  const generatedAdditionalViewCount =
    (workspace?.dedicatedViewArtifacts || []).filter((artifact) => isAdditionalView(artifact.kind))
      .length || 0;
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
  const disabledReason = 'Plan Mode capability is disabled in Settings.';
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
          disabled: !questionnaireDone || isImplementationLocked || !capabilities.blueprint,
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
          detail: `${generatedAdditionalViewCount}/${includedAdditionalViewCount}件の追加 view が生成済みです。`,
          done: generatedAdditionalViewCount >= includedAdditionalViewCount,
          buttonLabel: '生成状況を確認',
          busy: Boolean(busyAction?.startsWith('view:')),
          disabled: false,
          disabledReason: null,
          onClick: () => undefined,
        }
      : null,
    {
      number: 5,
      title: 'Feature Plan Markdownを作ります。これによってすぐに実装に移れます',
      detail: hasFeaturePlan
        ? 'Feature Planが作成済みです。'
        : '回答、Blueprint、Data Modelを要約してFeature Planを生成します。',
      done: hasFeaturePlan,
      buttonLabel: hasFeaturePlan ? 'Feature Planを再生成' : 'Feature Plan作成',
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
        <p className="mt-1 text-slate-400">
          必要なArtifactを確認し、Feature Plan から実装開始へ進みます。
        </p>
      </div>
      <ViewDecisionSummary decisions={viewDecisions} />
      <div className="grid gap-3">
        {steps.map((step, index) => (
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
                  {step.done ? <Check className="h-3.5 w-3.5" /> : step.number}
                </div>
                {index < steps.length - 1 ? (
                  <div className="mt-2 min-h-8 w-px flex-1 bg-slate-800" />
                ) : null}
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-slate-100">
                  {step.number}. {step.title}
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
        ))}
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

function firstRecord(...values: unknown[]) {
  return values.find(isRecord) || null;
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
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

function isAdditionalView(value: string) {
  return [
    'api_io_contract',
    'state_model',
    'activity_flow',
    'sequence_flow',
    'zod_schema_design',
  ].includes(value);
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
