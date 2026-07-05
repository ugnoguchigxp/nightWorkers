import type {
  DesignQuestionnaire,
  DesignQuestionnaireAnswer,
} from '../../../shared/schemas/design-questionnaire.schema';
import type { PlanModeWorkspace } from '../../../shared/schemas/plan-mode-artifact.schema';
import { getSessionQuestions } from '../questionnaire/questionnaire-parser.service';

type JsonRecord = Record<string, unknown>;
type TaskMessageRow = {
  id: string;
  content?: string | null;
  messageType?: string | null;
  metadataJson?: unknown | null;
};
type TaskLike = {
  title?: string | null;
  description?: string | null;
  objective?: string | null;
};
type QuestionnaireAnswerRow = {
  questionId: string;
  answer: DesignQuestionnaireAnswer;
};
type QuestionnaireSessionLike = {
  id: string;
  questionSets: Array<{ questionnaire: DesignQuestionnaire | null }>;
  answers: QuestionnaireAnswerRow[];
};

export function buildSpecificationDocumentContext(input: {
  task: TaskLike;
  session: QuestionnaireSessionLike | null;
  workspace: PlanModeWorkspace;
  messages: TaskMessageRow[];
  projectStackContext?: string | null;
}) {
  const latestBlueprint = findLatestBlueprintMessage(input.messages, 'blueprint');
  const latestDataModel = findLatestDataModelMessage(input.messages);
  const latestApiContract = findLatestPlanViewMessage(input.messages, 'api_io_contract');
  const latestZodSchema = findLatestPlanViewMessage(input.messages, 'zod_schema_design');
  const latestApiContractArtifact = findDedicatedViewArtifact(
    input.workspace,
    'api_io_contract',
    latestApiContract?.id
  );
  const latestZodSchemaArtifact = findDedicatedViewArtifact(
    input.workspace,
    'zod_schema_design',
    latestZodSchema?.id
  );
  const blueprint = getMessageBlueprint(latestBlueprint);
  const dataModelArtifact = getMessageDataModelArtifact(latestDataModel);
  const blueprintSummary = renderCompressedBlueprintNaturalLanguage(blueprint);
  const dataModelDdl = renderDataModelDdlReference(dataModelArtifact);
  const planViewReferences = renderPlanViewReferences({
    apiContract: getMessageApiContract(latestApiContract),
    zodSchema: getMessageZodSchema(latestZodSchema),
  });
  const planModeReferences = renderPlanModeReferences(input.workspace, input.messages);
  const projectStackContext = input.projectStackContext?.trim() || 'Project stack は未検出です。';
  const taskContext = [
    input.task.title,
    input.task.description,
    input.task.objective,
    projectStackContext,
    blueprintSummary,
    dataModelDdl,
    planViewReferences,
    planModeReferences,
  ]
    .filter(Boolean)
    .join('\n');
  return {
    task: [
      `Title: ${input.task.title || 'Untitled'}`,
      input.task.description ? `Description: ${input.task.description}` : null,
      input.task.objective ? `Objective: ${input.task.objective}` : null,
    ]
      .filter(Boolean)
      .join('\n'),
    projectStackContext,
    implementationPlanGuidance: buildImplementationPlanGuidance(taskContext),
    questionnaireDecisions: input.session
      ? renderQuestionnaireAnswerMarkdown(input.session)
      : '- Questionnaire は未生成です。',
    blueprintSummary,
    dataModelDdl,
    planViewReferences,
    planModeReferences,
    traceability: [
      input.session ? 'Questionnaire decisions: included' : 'Questionnaire decisions: none',
      latestBlueprint ? 'Blueprint summary: included' : 'Blueprint summary: not generated',
      latestDataModel ? 'Data Model DDL reference: included' : 'Data Model DDL reference: none',
      latestApiContract
        ? `API Contract: included${latestApiContractArtifact ? ' and indexed' : ''}`
        : 'API Contract: none',
      latestZodSchema
        ? `Zod Schema: included${latestZodSchemaArtifact ? ' and indexed' : ''}`
        : 'Zod Schema: none',
      `Workspace counts: blueprint=${workspaceArtifacts(input.workspace, 'blueprintArtifacts').length}, dataModel=${workspaceArtifacts(input.workspace, 'dataModelArtifacts').length}, dedicatedViews=${workspaceArtifacts(input.workspace, 'dedicatedViewArtifacts').length}`,
    ].join('\n'),
  };
}

export function sanitizeSpecificationTargetNaming(content: string, projectStackContext: string) {
  const targetProjectName = extractTargetProjectName(projectStackContext);
  if (isNightWorkersTargetProject(projectStackContext, targetProjectName)) return content;
  if (!/\bNightWorkers?\b/i.test(content)) return content;
  const replacement = targetProjectName
    ? `対象プロジェクト（${targetProjectName}）`
    : '対象プロジェクト';
  return content.replace(/\bNightWorkers?\b/gi, replacement);
}

function extractTargetProjectName(projectStackContext: string) {
  const match = projectStackContext.match(/^-\s*Project name:\s*(.+)$/im);
  const name = match?.[1]?.trim();
  return name || null;
}

function isNightWorkersTargetProject(
  projectStackContext: string,
  targetProjectName: string | null
) {
  return (
    /^nightworkers$/i.test(targetProjectName || '') ||
    /(^|\/)nightWorkers(\/|$)/.test(projectStackContext)
  );
}

function buildImplementationPlanGuidance(context: string) {
  const lower = context.toLowerCase();
  const hasUi = /react|vite|画面|screen|page|route|ui|frontend|component|form|table/.test(lower);
  const hasApi = /hono|api|endpoint|route|request|response|backend|server/.test(lower);
  const hasDb =
    /sqlite|postgres|drizzle|database|db|schema|migration|ddl|create table|alter table|table/.test(
      lower
    );
  const hasTests = /vitest|playwright|test|e2e|unit|verify|検証/.test(lower);
  const hasRiskyBoundary =
    /auth|permission|migration|schema|queue|runtime|worker|external|payment|security|認証|権限|移行|マイグレーション/.test(
      lower
    );
  const touchedLayers = [
    hasDb ? 'DB/schema' : null,
    hasApi ? 'API/backend' : null,
    hasUi ? 'UI/frontend' : null,
    hasTests ? 'test/verification' : null,
  ].filter(Boolean);
  const hasSchemaChange =
    hasDb && /create table|alter table|migration|schema|ddl|table/.test(lower);
  const classification =
    hasSchemaChange && touchedLayers.length >= 3
      ? '標準タスク（DB 変更部分は高リスク相当）'
      : hasRiskyBoundary && touchedLayers.length >= 3
        ? '高リスクタスク'
        : touchedLayers.length >= 2
          ? '標準タスク'
          : '軽量タスク';
  const lines = [
    `分類: ${classification}`,
    `理由: 変更候補レイヤーは ${touchedLayers.length > 0 ? touchedLayers.join(' / ') : '未検出'}。`,
    '出力方針: 重複説明を避け、実装者が決めるべき契約と順序だけを短く書く。',
    '採用判断: Questionnaire Decisions を優先する。DDL reference に含まれる将来拡張や対象外要素は実装対象にしない。',
    '判断方針: 既存資料から合理的に決められることは前提として固定し、open question は実装不能または危険な欠落だけに限定する。',
    '画面仕様: Blueprint Summary の画面 / section / component / copy / sample / props 要約から、再現に必要な構成と状態を `## 契約` の UI 項目へ短く反映する。',
  ];

  if (classification === '軽量タスク') {
    lines.push(
      '計画粒度: 対象、非対象、変更ファイル候補、確認コマンドに絞る。',
      '実装計画: 既存パターンに合わせた最小差分で、検証可能な完了条件を短く書く。'
    );
  } else {
    lines.push(
      '計画粒度: 実装順、層ごとの契約、非対象、検証計画、完了条件を本文に分けて書く。',
      '実装計画: DB/API/UI/test をまたぐ場合は、依存する順に番号付きで作業を並べる。'
    );
  }

  if (hasSchemaChange) {
    lines.push(
      'DB 変更: Data Model DDL reference は設計根拠として扱う。実装では既存 tooling に従って schema/migration を作成し、適用と検証を独立した手順にする。',
      'DB 変更の完了条件: migration の作成、適用、対象 table/index/constraint の確認、既存機能の回帰確認が済むこと。'
    );
  }

  if (hasApi) {
    lines.push(
      'API 契約: endpoint、method、request/response/error、validation schema、auth/permission 要否を具体名で明記する。'
    );
  }
  if (hasUi) {
    lines.push(
      'UI 契約: route、主要 state、loading/error/empty、作成/編集/削除などの操作導線を明記する。'
    );
  }
  lines.push(
    '検証: unit / typecheck / verify / E2E のうち、既存 package script と変更範囲に合うものを本文の完了条件へ組み込む。',
    '禁止: 元資料、Evidence、Questionnaire の raw answer を本文に再掲しない。背景説明より実装契約を優先する。'
  );
  return lines.join('\n');
}

function renderCompressedBlueprintNaturalLanguage(blueprint: JsonRecord | null) {
  if (!blueprint) return 'Blueprint は未生成です。';
  const lines = [
    `Blueprint "${String(blueprint.name || blueprint.id || 'App Blueprint')}" を採用しています。`,
  ];
  if (blueprint.description) {
    lines.push(`全体方針: ${compactText(String(blueprint.description), 280)}`);
  }
  const screens = toRecordArray(blueprint.screens).slice(0, 4);
  for (const screen of screens) {
    const screenName = String(screen.name || screen.id || 'Unnamed screen');
    const path = screen.path ? ` (${String(screen.path)})` : '';
    lines.push(
      `画面: ${screenName}${path}。画面種別は ${String(screen.componentName || 'Page')}。`
    );
    const sections = toRecordArray(screen.sections).slice(0, 8);
    for (const section of sections) {
      const props = isRecord(section.props) ? section.props : {};
      const label = String(section.name || props.title || section.id || 'Unnamed section');
      const component = String(section.componentName || 'Section');
      const description = compactText(
        String(props.description || section.visualIntent || section.intent || '').trim(),
        220
      );
      const details = summarizeSectionProps(section);
      lines.push(
        `- 採用 section: ${label}。component は ${component}。${description || 'この画面の主要確認対象です。'}${details ? ` ${details}` : ''}`
      );
    }
  }
  const tasks = toRecordArray(blueprint.implementationTasks).slice(0, 6);
  if (tasks.length > 0) {
    lines.push('実装時に意識する作業:');
    for (const task of tasks) {
      lines.push(
        `- ${compactText(String(task.title || task.id || ''), 90)}: ${compactText(String(task.description || ''), 180)}`
      );
    }
  }
  return lines.join('\n');
}

function summarizeSectionProps(section: JsonRecord) {
  const props = isRecord(section.props) ? section.props : {};
  const parts: string[] = [];
  const reason = compactText(String(section.reason || section.visualIntent || '').trim(), 120);
  const copy = compactText(String(props.title || props.heading || props.copy || '').trim(), 80);
  const dataset = compactText(String(props.dataset || section.dataset || '').trim(), 60);
  const sample = summarizeSampleValue(props.sample || props.samples || section.sample);
  if (reason) parts.push(`意図は ${reason}。`);
  if (copy) parts.push(`表示文言は ${copy}。`);
  if (dataset) parts.push(`データ種別は ${dataset}。`);
  if (sample) parts.push(`サンプルは ${sample}。`);
  if (Array.isArray(props.columns)) {
    const columns = props.columns
      .map((column: unknown) =>
        isRecord(column) ? String(column.title || column.name || column.id || '') : ''
      )
      .filter(Boolean)
      .slice(0, 5);
    if (columns.length) parts.push(`列は ${columns.join(' / ')}。`);
  }
  if (Array.isArray(props.items)) {
    const items = props.items
      .map((item: unknown) =>
        isRecord(item) ? String(item.label || item.title || item.name || '') : ''
      )
      .filter(Boolean)
      .slice(0, 5);
    if (items.length) parts.push(`表示項目は ${items.join(' / ')}。`);
  }
  if (Array.isArray(props.tabs)) {
    const tabs = props.tabs
      .map((item: unknown) =>
        isRecord(item) ? String(item.label || item.title || item.id || '') : String(item)
      )
      .filter(Boolean)
      .slice(0, 5);
    if (tabs.length) parts.push(`タブは ${tabs.join(' / ')}。`);
  }
  if (Array.isArray(props.filters)) {
    const filters = props.filters
      .map((item: unknown) =>
        isRecord(item) ? String(item.label || item.name || item.id || '') : String(item)
      )
      .filter(Boolean)
      .slice(0, 5);
    if (filters.length) parts.push(`フィルターは ${filters.join(' / ')}。`);
  }
  const interactions = summarizeInteractionHints(section, props);
  if (interactions.length > 0) parts.push(`操作は ${interactions.join(' / ')}。`);
  const states = summarizeStateHints(section, props);
  if (states.length > 0) parts.push(`状態表示は ${states.join(' / ')}。`);
  return parts.join(' ');
}

function summarizeInteractionHints(section: JsonRecord, props: JsonRecord) {
  const values = [
    props.actions,
    props.rowActions,
    props.primaryAction,
    props.secondaryAction,
    props.submitLabel,
    props.cancelLabel,
    section.actions,
  ];
  return values
    .flatMap((value) => labelArray(value))
    .filter(Boolean)
    .slice(0, 5);
}

function summarizeStateHints(section: JsonRecord, props: JsonRecord) {
  const stateKeys = [
    ['empty', props.emptyState || section.emptyState],
    ['loading', props.loadingState || section.loadingState],
    ['error', props.errorState || section.errorState],
    ['validation', props.validation || section.validation],
  ] as const;
  return stateKeys
    .map(([label, value]) => {
      const rendered = summarizeSampleValue(value);
      return rendered ? `${label}:${rendered}` : '';
    })
    .filter(Boolean)
    .slice(0, 4);
}

function labelArray(value: unknown): string[] {
  if (!value) return [];
  if (typeof value === 'string') return [compactText(value, 60)];
  if (Array.isArray(value)) {
    return value
      .map((item) =>
        isRecord(item)
          ? String(item.label || item.title || item.name || item.id || '')
          : String(item || '')
      )
      .filter(Boolean)
      .map((item) => compactText(item, 60));
  }
  if (isRecord(value)) {
    const label = String(value.label || value.title || value.name || value.id || '');
    return label ? [compactText(label, 60)] : [];
  }
  return [];
}

function summarizeSampleValue(value: unknown) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return compactText(value, 100);
  if (Array.isArray(value)) {
    const items = value
      .map((item) => sampleItemLabel(item))
      .filter(Boolean)
      .slice(0, 3);
    return compactText(items.join(' / '), 120);
  }
  if (isRecord(value)) {
    const entries = Object.entries(value)
      .map(([key, item]) => `${key}:${sampleItemLabel(item)}`)
      .filter((entry) => !entry.endsWith(':'))
      .slice(0, 4);
    return compactText(entries.join(' / '), 120);
  }
  return compactText(String(value), 100);
}

function sampleItemLabel(value: unknown) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (isRecord(value)) {
    return String(value.label || value.title || value.name || value.value || value.id || '');
  }
  return '';
}

function renderDataModelDdlReference(artifact: JsonRecord | null) {
  if (!artifact) return 'Data Model は未生成です。';
  const ddl = typeof artifact.ddl === 'string' ? artifact.ddl.trim() : '';
  if (ddl) return ddl;
  const tables = toRecordArray(artifact.derivedTables);
  const relations = toRecordArray(artifact.relations);
  if (tables.length === 0) return 'Data Model には table が定義されていません。';
  const lines: string[] = [];
  for (const table of tables) {
    const tableName = safeSqlIdentifier(String(table.name || table.id || 'table'));
    const columns = toRecordArray(table.columns);
    lines.push(`CREATE TABLE ${tableName} (`);
    if (columns.length === 0) {
      lines.push('  -- columns are not defined');
    } else {
      columns.forEach((column, index) => {
        const columnName = safeSqlIdentifier(
          String(column.name || column.id || `column_${index + 1}`)
        );
        const type = ddlType(column.type);
        const constraints = [
          column.primaryKey ? 'PRIMARY KEY' : null,
          column.nullable === false ? 'NOT NULL' : null,
          column.unique ? 'UNIQUE' : null,
        ].filter(Boolean);
        const suffix = index === columns.length - 1 ? '' : ',';
        lines.push(
          `  ${columnName} ${type}${constraints.length ? ` ${constraints.join(' ')}` : ''}${suffix}`
        );
      });
    }
    lines.push(');');
    if (Array.isArray(table.indexes)) {
      for (const index of table.indexes.slice(0, 4)) {
        const fields = Array.isArray(index)
          ? index.map((field) => safeSqlIdentifier(String(field)))
          : [];
        if (fields.length > 0) {
          lines.push(
            `CREATE INDEX idx_${tableName}_${fields.join('_')} ON ${tableName} (${fields.join(', ')});`
          );
        }
      }
    }
    lines.push('');
  }
  for (const relation of relations) {
    const fromTable = safeSqlIdentifier(String(relation.fromTable || ''));
    const fromColumn = safeSqlIdentifier(String(relation.fromColumn || ''));
    const toTable = safeSqlIdentifier(String(relation.toTable || ''));
    const toColumn = safeSqlIdentifier(String(relation.toColumn || ''));
    if (fromTable && fromColumn && toTable && toColumn) {
      lines.push(
        `ALTER TABLE ${fromTable} ADD FOREIGN KEY (${fromColumn}) REFERENCES ${toTable} (${toColumn});`
      );
    }
  }
  return lines.join('\n').trim();
}

function renderPlanViewReferences(input: {
  apiContract: JsonRecord | null;
  zodSchema: JsonRecord | null;
}) {
  const sections: string[] = [];
  const apiContract = renderApiContractReference(input.apiContract);
  if (apiContract) sections.push(apiContract);
  const zodSchema = renderZodSchemaReference(input.zodSchema);
  if (zodSchema) sections.push(zodSchema);
  return sections.length > 0 ? sections.join('\n\n') : 'API Contract / Zod Schema は未生成です。';
}

function renderPlanModeReferences(workspace: PlanModeWorkspace, messages: TaskMessageRow[]) {
  const messageById = new Map(messages.map((message) => [message.id, message]));
  const sections = [
    'Plan Mode で既に生成済みの関連資料です。最終文書に全件列挙せず、設計判断と契約の確定に使ってください。',
    renderWorkspaceArtifactSection(
      'Feature Plans',
      workspaceArtifacts(workspace, 'featurePlanArtifacts'),
      messageById,
      'feature_plan'
    ),
    renderQuestionnaireSessionReferences(workspace),
    renderWorkspaceArtifactSection(
      'Blueprints',
      workspaceArtifacts(workspace, 'blueprintArtifacts'),
      messageById,
      'blueprint'
    ),
    renderWorkspaceArtifactSection(
      'Dedicated Views',
      workspaceArtifacts(workspace, 'dedicatedViewArtifacts'),
      messageById,
      'dedicated_view'
    ),
    renderWorkspaceArtifactSection(
      'Decision Reviews',
      workspaceArtifacts(workspace, 'decisionReviews'),
      messageById,
      'decision_review'
    ),
    renderImplementationReferenceSection(workspace, messageById),
  ].filter(Boolean);
  return sections.join('\n\n');
}

function renderWorkspaceArtifactSection(
  title: string,
  artifacts: PlanModeWorkspace['dedicatedViewArtifacts'],
  messageById: Map<string, TaskMessageRow>,
  mode: 'feature_plan' | 'blueprint' | 'dedicated_view' | 'decision_review'
) {
  if (artifacts.length === 0) return `${title}: none`;
  const lines = [`${title}:`];
  for (const artifact of artifacts) {
    const message = messageById.get(artifact.sourceMessageId);
    lines.push(renderWorkspaceArtifactReference(artifact, message, mode));
  }
  return lines.join('\n');
}

function renderWorkspaceArtifactReference(
  artifact: PlanModeWorkspace['dedicatedViewArtifacts'][number],
  message: TaskMessageRow | undefined,
  mode: 'feature_plan' | 'blueprint' | 'dedicated_view' | 'decision_review'
) {
  const details = [
    `id=${artifact.id}`,
    `kind=${artifact.kind}`,
    `message=${artifact.sourceMessageId}`,
    artifact.adoptionState ? `adoption=${artifact.adoptionState}` : null,
    artifact.sourceArtifactMessageId ? `source=${artifact.sourceArtifactMessageId}` : null,
  ].filter(Boolean);
  const summary = compactText(renderMessageReferenceSummary(message, mode), 760);
  return `- ${artifact.title} (${details.join('; ')})${summary ? `\n  summary: ${summary}` : ''}`;
}

function renderQuestionnaireSessionReferences(workspace: PlanModeWorkspace) {
  const sessions = workspace.questionnaireSessions || [];
  if (sessions.length === 0) return 'Questionnaire Sessions: none';
  const lines = ['Questionnaire Sessions:'];
  for (const session of sessions) {
    const details = [
      `id=${session.id}`,
      `status=${session.status}`,
      `answered=${session.answeredCount}/${session.totalQuestionCount}`,
      session.sourceBlueprintMessageId
        ? `sourceBlueprint=${session.sourceBlueprintMessageId}`
        : null,
      session.latestReviewId ? `latestReview=${session.latestReviewId}` : null,
    ].filter(Boolean);
    lines.push(`- ${details.join('; ')}`);
  }
  return lines.join('\n');
}

function renderImplementationReferenceSection(
  workspace: PlanModeWorkspace,
  messageById: Map<string, TaskMessageRow>
) {
  const references = workspace.implementationReferences || [];
  if (references.length === 0) return 'Implementation References: none';
  const lines = ['Implementation References:'];
  for (const reference of references) {
    const message = reference.sourceMessageId
      ? messageById.get(reference.sourceMessageId)
      : undefined;
    const details = [
      `id=${reference.id}`,
      `task=${reference.taskId}`,
      reference.sourceMessageId ? `message=${reference.sourceMessageId}` : null,
    ].filter(Boolean);
    const summary = compactText(renderMessageReferenceSummary(message, 'feature_plan'), 760);
    lines.push(
      `- ${reference.title} (${details.join('; ')})${summary ? `\n  summary: ${summary}` : ''}`
    );
  }
  return lines.join('\n');
}

function renderMessageReferenceSummary(
  message: TaskMessageRow | undefined,
  mode: 'feature_plan' | 'blueprint' | 'dedicated_view' | 'decision_review'
) {
  if (!message || !isRecord(message.metadataJson)) return compactText(message?.content || '', 760);
  const metadata = message.metadataJson;
  if (mode === 'blueprint') {
    const blueprint = metadata.appBlueprint || metadata.mockBlueprint;
    return isRecord(blueprint) ? renderCompressedBlueprintNaturalLanguage(blueprint) : '';
  }
  if (mode === 'dedicated_view') {
    const apiContract = getMessageApiContract(message);
    if (apiContract) return renderApiContractReference(apiContract);
    const zodSchema = getMessageZodSchema(message);
    if (zodSchema) return renderZodSchemaReference(zodSchema);
    const dataModel = getMessageDataModelArtifact(message);
    if (dataModel) return renderDataModelSummary(dataModel);
    return String(metadata.markdown || message.content || '');
  }
  if (mode === 'decision_review') {
    return compactJson(
      metadata.designDecisionReview || metadata.markdownDocumentData || message.content
    );
  }
  return String(
    (isRecord(metadata.markdownDocumentData) ? metadata.markdownDocumentData.content : '') ||
      metadata.markdown ||
      message.content ||
      ''
  );
}

function renderDataModelSummary(artifact: JsonRecord) {
  const lines = [];
  if (artifact.summary) lines.push(`Summary: ${compactText(String(artifact.summary), 240)}`);
  const tables = toRecordArray(artifact.derivedTables)
    .map((table) => String(table.name || table.id || 'table'))
    .filter(Boolean)
    .slice(0, 12);
  if (tables.length > 0) lines.push(`Tables: ${tables.join(' / ')}`);
  const constraints = Array.isArray(artifact.constraints)
    ? artifact.constraints.map(String).filter(Boolean).slice(0, 6)
    : [];
  if (constraints.length > 0) lines.push(`Constraints: ${constraints.join(' / ')}`);
  const ddl = typeof artifact.ddl === 'string' ? compactText(artifact.ddl, 420) : '';
  if (ddl) lines.push(`DDL: ${ddl}`);
  return lines.join('\n');
}

function workspaceArtifacts<K extends keyof PlanModeWorkspace>(
  workspace: PlanModeWorkspace,
  key: K
): PlanModeWorkspace[K] extends unknown[] ? PlanModeWorkspace[K] : [] {
  const value = workspace[key];
  return (Array.isArray(value) ? value : []) as PlanModeWorkspace[K] extends unknown[]
    ? PlanModeWorkspace[K]
    : [];
}

function compactJson(value: unknown) {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function renderApiContractReference(artifact: JsonRecord | null) {
  if (!artifact) return '';
  const lines = [
    `API Contract: ${String(artifact.title || 'API Contract')}`,
    artifact.summary ? `Summary: ${compactText(String(artifact.summary), 180)}` : '',
  ].filter(Boolean);
  const openapi = isRecord(artifact.openapi) ? artifact.openapi : {};
  const paths = isRecord(openapi.paths) ? openapi.paths : {};
  const operations = Object.entries(paths).flatMap(([path, methods]) => {
    if (!isRecord(methods)) return [];
    return Object.entries(methods)
      .map(([method, operation]) => {
        const record = isRecord(operation) ? operation : {};
        const operationId = String(record.operationId || '');
        const summary = compactText(String(record.summary || record.description || ''), 100);
        const requestShape = summarizeRequestShape(record.requestBody, artifact);
        const responseShape = summarizeResponseShape(record.responses, artifact);
        return [
          `- ${method.toUpperCase()} ${path}${operationId ? ` (${operationId})` : ''}${summary ? `: ${summary}` : ''}`,
          requestShape ? `  request: ${requestShape}` : null,
          responseShape ? `  response/error: ${responseShape}` : null,
        ]
          .filter(Boolean)
          .join('\n');
      })
      .slice(0, 8);
  });
  if (operations.length > 0) {
    lines.push('Operations:', ...operations.slice(0, 10));
  }
  const validation = toRecordArray(artifact.validation).slice(0, 6);
  if (validation.length > 0) {
    lines.push(
      `Validation: ${validation
        .map((item) => String(item.schemaName || item.owner || 'schema'))
        .filter(Boolean)
        .join(' / ')}`
    );
  }
  return lines.join('\n');
}

function summarizeRequestShape(value: unknown, artifact: JsonRecord) {
  if (!isRecord(value)) return '';
  const schemaName = schemaNameFromContent(value);
  const shape = schemaName
    ? summarizeComponentSchema(artifact, schemaName)
    : summarizeJsonShape(value);
  const required =
    value.required === false ? 'optional' : value.required === true ? 'required' : '';
  return [schemaName, required, shape].filter(Boolean).join('; ');
}

function summarizeResponseShape(value: unknown, artifact: JsonRecord) {
  if (!isRecord(value)) return '';
  return Object.entries(value)
    .slice(0, 5)
    .map(([status, response]) => {
      const record = isRecord(response) ? response : {};
      const schemaName = schemaNameFromContent(record);
      const shape = schemaName
        ? summarizeComponentSchema(artifact, schemaName)
        : summarizeJsonShape(record);
      return `${status}${schemaName ? ` ${schemaName}` : ''}${shape ? ` {${shape}}` : ''}`;
    })
    .join(' / ');
}

function schemaNameFromContent(value: JsonRecord) {
  const content = isRecord(value.content) ? value.content : {};
  const json = isRecord(content['application/json']) ? content['application/json'] : {};
  const schema = isRecord(json.schema) ? json.schema : {};
  const ref = typeof schema.$ref === 'string' ? schema.$ref : '';
  return ref.split('/').pop() || '';
}

function summarizeComponentSchema(artifact: JsonRecord, schemaName: string) {
  const openapi = isRecord(artifact.openapi) ? artifact.openapi : {};
  const components = isRecord(openapi.components) ? openapi.components : {};
  const schemas = isRecord(components.schemas) ? components.schemas : {};
  const schema = isRecord(schemas[schemaName]) ? schemas[schemaName] : null;
  if (!schema) return '';
  const properties = isRecord(schema.properties) ? schema.properties : {};
  const required = new Set(Array.isArray(schema.required) ? schema.required.map(String) : []);
  const fields = Object.entries(properties)
    .slice(0, 8)
    .map(([name, field]) => {
      const record = isRecord(field) ? field : {};
      const type = Array.isArray(record.enum)
        ? `enum(${record.enum.map(String).join('|')})`
        : String(record.type || 'unknown');
      return `${name}:${type}${required.has(name) ? '' : '?'}`;
    });
  return fields.join(', ');
}

function summarizeJsonShape(value: JsonRecord) {
  const schema = isRecord(value.schema) ? value.schema : value;
  const properties = isRecord(schema.properties) ? schema.properties : {};
  if (Object.keys(properties).length === 0) return '';
  const required = new Set(Array.isArray(schema.required) ? schema.required.map(String) : []);
  return Object.entries(properties)
    .slice(0, 8)
    .map(([name, field]) => {
      const record = isRecord(field) ? field : {};
      const type = Array.isArray(record.enum)
        ? `enum(${record.enum.map(String).join('|')})`
        : String(record.type || 'unknown');
      return `${name}:${type}${required.has(name) ? '' : '?'}`;
    })
    .join(', ');
}

function renderZodSchemaReference(artifact: JsonRecord | null) {
  if (!artifact) return '';
  const lines = [
    `Zod Schema: ${String(artifact.schemaName || artifact.title || 'Zod Schema')}`,
    artifact.summary ? `Summary: ${compactText(String(artifact.summary), 180)}` : '',
    artifact.owner ? `Owner: ${String(artifact.owner)}` : '',
  ].filter(Boolean);
  const fields = toRecordArray(artifact.fields).slice(0, 10);
  if (fields.length > 0) {
    lines.push(
      `Fields: ${fields
        .map((field) => {
          const name = String(field.name || '');
          const type = String(field.type || 'unknown');
          const required = field.required === false ? 'optional' : 'required';
          const enumOptions = Array.isArray(field.enumOptions)
            ? field.enumOptions.map(String).filter(Boolean)
            : [];
          return `${name}:${type}/${required}${enumOptions.length ? `(${enumOptions.join('|')})` : ''}`;
        })
        .filter(Boolean)
        .join(' / ')}`
    );
  }
  const zodSource = typeof artifact.zodSource === 'string' ? artifact.zodSource : '';
  const inferredShape = summarizeZodSourceShape(zodSource);
  if (inferredShape) lines.push(`JSON shape: ${inferredShape}`);
  return lines.join('\n');
}

function summarizeZodSourceShape(source: string) {
  if (!source.trim()) return '';
  const objectMatch = source.match(/z\.object\(\s*\{([\s\S]*?)\}\s*\)/);
  const body = objectMatch?.[1] || '';
  if (!body.trim()) return '';
  const fields = [...body.matchAll(/([A-Za-z_$][\w$]*)\s*:\s*z\.([A-Za-z]+)([\s\S]*?)(?:,|\n|$)/g)]
    .slice(0, 8)
    .map((match) => {
      const name = match[1];
      const type = match[2];
      const chain = match[3] || '';
      return `${name}:${type}${chain.includes('.optional()') ? '?' : ''}`;
    });
  return fields.join(', ');
}

function ddlType(value: unknown) {
  if (value === 'number' || value === 'integer') return 'INTEGER';
  if (value === 'boolean') return 'BOOLEAN';
  if (value === 'date' || value === 'datetime' || value === 'timestamp') return 'DATETIME';
  if (value === 'json') return 'JSON';
  return 'TEXT';
}

function safeSqlIdentifier(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function compactText(value: string, limit: number) {
  const text = value.replace(/\s+/g, ' ').trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 1)).trim()}…`;
}

function findLatestBlueprintMessage(messages: TaskMessageRow[], kind: 'blueprint') {
  return [...messages].reverse().find((message) => {
    const metadata = isRecord(message.metadataJson) ? message.metadataJson : {};
    const hasBlueprint =
      (metadata.intent === 'app_blueprint' && metadata.appBlueprint) ||
      (metadata.intent === 'mock_blueprint' && metadata.mockBlueprint);
    if (!hasBlueprint) return false;
    if (isDataModelMessageMetadata(metadata)) return false;
    return kind === 'blueprint';
  });
}

function findLatestDataModelMessage(messages: TaskMessageRow[]) {
  return [...messages].reverse().find((message) => {
    const metadata = isRecord(message.metadataJson) ? message.metadataJson : {};
    return isDataModelMessageMetadata(metadata);
  });
}

function findLatestPlanViewMessage(
  messages: TaskMessageRow[],
  view: 'api_io_contract' | 'zod_schema_design'
) {
  return [...messages].reverse().find((message) => {
    const metadata = isRecord(message.metadataJson) ? message.metadataJson : {};
    return Boolean(
      metadata.view === view &&
        (metadata.artifactKind === 'plan_mode_api_contract' ||
          metadata.artifactKind === 'plan_mode_zod_schema' ||
          metadata.artifactKind === 'plan_mode_dedicated_view' ||
          metadata.intent === 'plan_mode_dedicated_view' ||
          metadata.apiContract ||
          metadata.zodSchema)
    );
  });
}

function findDedicatedViewArtifact(
  workspace: PlanModeWorkspace,
  view: 'api_io_contract' | 'zod_schema_design',
  sourceMessageId: string | undefined
) {
  return [...workspaceArtifacts(workspace, 'dedicatedViewArtifacts')].reverse().find((artifact) => {
    if (artifact.kind !== view) return false;
    if (!sourceMessageId) return true;
    return artifact.sourceMessageId === sourceMessageId || artifact.id === sourceMessageId;
  });
}

function getMessageBlueprint(message: TaskMessageRow | undefined): JsonRecord | null {
  const metadata = isRecord(message?.metadataJson) ? message.metadataJson : {};
  const blueprint = metadata.appBlueprint || metadata.mockBlueprint;
  return isRecord(blueprint) ? blueprint : null;
}

function getMessageDataModelArtifact(message: TaskMessageRow | undefined): JsonRecord | null {
  const metadata = isRecord(message?.metadataJson) ? message.metadataJson : {};
  const artifact = metadata.dataModelArtifact;
  if (isRecord(artifact)) return artifact;
  return null;
}

function getMessageApiContract(message: TaskMessageRow | undefined): JsonRecord | null {
  if (!message || !isRecord(message.metadataJson)) return null;
  const metadata = message.metadataJson;
  if (isRecord(metadata.apiContract)) return metadata.apiContract;
  if (isRecord(metadata.artifactPayload)) return metadata.artifactPayload;
  return metadata.artifactKind === 'plan_mode_api_contract' ? metadata : null;
}

function getMessageZodSchema(message: TaskMessageRow | undefined): JsonRecord | null {
  if (!message || !isRecord(message.metadataJson)) return null;
  const metadata = message.metadataJson;
  if (isRecord(metadata.zodSchema)) return metadata.zodSchema;
  if (isRecord(metadata.artifactPayload)) return metadata.artifactPayload;
  return metadata.artifactKind === 'plan_mode_zod_schema' ? metadata : null;
}

function isDataModelMessageMetadata(metadata: JsonRecord) {
  return (
    (metadata.artifactKind === 'plan_mode_dedicated_view' && metadata.view === 'data_model') ||
    metadata.source === 'data-model' ||
    metadata.artifactType === 'data_model'
  );
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function toRecordArray(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

export function renderQuestionnaireAnswerMarkdown(session: QuestionnaireSessionLike) {
  const answerByQuestionId = new Map(session.answers.map((item) => [item.questionId, item]));
  const lines: string[] = [];
  for (const question of toRecordArray(getSessionQuestions(session))) {
    const answer = answerByQuestionId.get(String(question.id));
    lines.push(`- ${question.question}`);
    lines.push(`  - Answer: ${renderQuestionnaireAnswer(question, answer?.answer)}`);
    if (question.why) lines.push(`  - Why: ${question.why}`);
    if (question.outputSection) lines.push(`  - Section: ${question.outputSection}`);
  }
  return lines.length > 0 ? lines.join('\n') : '- No questionnaire answers.';
}

function renderQuestionnaireAnswer(
  question: JsonRecord,
  answer: DesignQuestionnaireAnswer | undefined
) {
  if (!answer) return '未回答';
  if (answer.deferred) return '後で決める';
  if (typeof answer.booleanValue === 'boolean') return answer.booleanValue ? 'はい' : 'いいえ';
  if (answer.freeText?.trim()) return answer.freeText.trim();
  const options = new Map(
    toRecordArray(question.options).map((option) => [
      String(option.id),
      String(option.label || option.id),
    ])
  );
  const selected = [
    ...(Array.isArray(answer.selectedOptionIds) ? answer.selectedOptionIds : []),
    ...(Array.isArray(answer.rankedOptionIds) ? answer.rankedOptionIds : []),
  ]
    .map((id) => options.get(id) || id)
    .filter(Boolean);
  return selected.length > 0 ? selected.join(', ') : '未回答';
}
