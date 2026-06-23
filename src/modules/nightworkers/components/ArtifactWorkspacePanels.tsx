import { Check, LoaderCircle } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { fetchBlueprintDesignSettings } from '../nightWorkersCommands';
import type {
  BlueprintSpecificationWorkspace,
  DesignQuestionnaireSession,
  PlanModeSettings,
  TaskMessage,
} from '../types';
import { MarkdownViewer } from './ArtifactFileViewers';
import { getQuestionCount } from './ArtifactQuestionnaire';
import { BlueprintDbDesignPanel, BlueprintPreview } from './blueprint-preview';
import {
  type BlueprintPreviewDesignSettings,
  createBlueprintPreviewDesignSettings,
} from './blueprint-preview/designSettings';

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

export function WorkspaceDbDesignPanel({
  sessionId,
  message,
  empty = 'No DB Design artifact.',
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
  return (
    <WorkspaceDbDesignPanelContent sessionId={sessionId} blueprint={blueprint} message={message} />
  );
}

function WorkspaceDbDesignPanelContent({
  sessionId,
  blueprint,
  message,
}: {
  sessionId: string | null;
  blueprint: Record<string, unknown>;
  message: TaskMessage | null;
}) {
  const tables =
    isRecord(blueprint.databaseSchema) && Array.isArray(blueprint.databaseSchema.tables)
      ? toRecordArray(blueprint.databaseSchema.tables)
      : [];
  const metadata = isRecord(message?.metadataJson) ? message.metadataJson : {};
  const validation = metadata.validation;
  const issues = isRecord(validation) ? toRecordArray(validation.issues) : [];
  const initialSettings = useMemo(
    () => createBlueprintPreviewDesignSettings(blueprint.designPreset),
    [blueprint.designPreset]
  );
  const [settings, setSettings] = useState<BlueprintPreviewDesignSettings>(initialSettings);

  useEffect(() => {
    setSettings(initialSettings);
    if (!sessionId) return;
    const controller = new AbortController();
    fetchBlueprintDesignSettings(sessionId, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) return null;
        return (await res.json()) as { settings?: unknown };
      })
      .then((data) => {
        if (controller.signal.aborted || !data?.settings) return;
        setSettings(createBlueprintPreviewDesignSettings(data.settings));
      })
      .catch((error) => {
        if (error?.name !== 'AbortError') {
          console.warn('Failed to load DB Design display settings', error);
        }
      });
    return () => controller.abort();
  }, [initialSettings, sessionId]);

  return (
    <div
      className="blueprint-preview grid gap-[var(--blueprint-preview-gap)] rounded-xl border border-border p-[var(--blueprint-preview-section-padding)] text-ui"
      data-blueprint-preview
      data-theme={settings.theme}
      data-density={settings.density}
      data-shape={settings.shape}
      data-shadow={settings.shadow}
      data-shadow-direction={settings.shadowDirection}
      data-font={settings.font}
      data-contrast={settings.contrast}
      data-motion={settings.motion}
      data-button-variant={settings.componentVariants.button}
      data-card-variant={settings.componentVariants.card}
      data-table-variant={settings.componentVariants.table}
      data-input-variant={settings.componentVariants.input}
    >
      <BlueprintDbDesignPanel
        id="specification-workspace-db-design"
        blueprint={blueprint}
        tables={tables}
        validationIssues={issues}
        adoption={null}
      />
    </div>
  );
}

export function SpecificationStatusView({
  workspace,
  questionnaireSession,
  busyAction,
  canGenerateDbDesign,
  hasSpecification,
  isImplementationLocked = false,
  planModeSettings,
  onOpenQuestionnaire,
  onGenerateBlueprint,
  onGenerateDbDesign,
  onGenerateSpecification,
  onQueueSession,
  onAddToQueue,
}: {
  workspace: BlueprintSpecificationWorkspace | null;
  questionnaireSession: DesignQuestionnaireSession | null;
  busyAction: string | null;
  canGenerateDbDesign: boolean;
  hasSpecification: boolean;
  isImplementationLocked?: boolean;
  planModeSettings?: PlanModeSettings;
  onOpenQuestionnaire: () => void;
  onGenerateBlueprint: () => void;
  onGenerateDbDesign: () => void;
  onGenerateSpecification: () => void;
  onQueueSession?: () => void;
  onAddToQueue?: () => void;
}) {
  const answeredCount = questionnaireSession?.answers.length || 0;
  const questionCount = questionnaireSession ? getQuestionCount(questionnaireSession) : 0;
  const hasBlueprint = Boolean(workspace?.blueprintArtifacts.length);
  const hasDbDesign = Boolean(workspace?.dbDesignArtifacts.length);
  const capabilities = planModeSettings?.capabilities ?? {
    questionnaire: true,
    blueprint: true,
    dbDesign: true,
    specification: true,
  };
  const disabledReason = 'Plan Mode capability is disabled in Settings.';
  const questionnaireDone = Boolean(
    questionnaireSession &&
      (questionnaireSession.status === 'review_ready' || questionnaireSession.status === 'accepted')
  );
  const steps = [
    {
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
    },
    {
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
    },
    {
      number: 3,
      title: 'どの様なデータモデルが必要になるかプレビュー出来ます',
      detail: hasDbDesign
        ? `${workspace?.dbDesignArtifacts.length || 0}件のDB Designがあります。`
        : 'DB Designでテーブル、カラム、リレーションを確認します。',
      done: hasDbDesign,
      buttonLabel: hasDbDesign ? 'DBデザインを再生成' : 'DBデザイン作成',
      busy: busyAction === 'db-design',
      disabled:
        !questionnaireDone ||
        !canGenerateDbDesign ||
        isImplementationLocked ||
        !capabilities.dbDesign,
      disabledReason: !capabilities.dbDesign ? disabledReason : null,
      onClick: onGenerateDbDesign,
    },
    {
      number: 4,
      title: '設計書Markdownを作ります。これによってすぐに実装に移れます',
      detail: hasSpecification
        ? 'Specificationが作成済みです。'
        : '回答、Blueprint、DB Designを要約して仕様書を生成します。',
      done: hasSpecification,
      buttonLabel: hasSpecification ? '仕様書を再生成' : '仕様書作成',
      busy: busyAction === 'design-doc',
      disabled: !questionnaireDone || isImplementationLocked || !capabilities.specification,
      disabledReason: !capabilities.specification ? disabledReason : null,
      onClick: onGenerateSpecification,
    },
  ];
  const allStepsDone = steps.every((step) => step.done);
  return (
    <div className="grid gap-3 text-xs">
      <div>
        <h2 className="text-base font-semibold text-slate-100">Status</h2>
        <p className="mt-1 text-slate-400">
          上から順に確認し、必要なArtifactを作成して仕様書へ進みます。
        </p>
      </div>
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function toRecordArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}
