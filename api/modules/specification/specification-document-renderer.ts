import type {
  DesignQuestionnaire,
  DesignQuestionnaireAnswer,
} from '../../../shared/schemas/design-questionnaire.schema';
import type { PlanModeWorkspace } from '../../../shared/schemas/plan-mode-artifact.schema';
import {
  getAnswerableSessionQuestions,
  getSessionQuestions,
} from '../questionnaire/questionnaire-parser.service';

type JsonRecord = Record<string, unknown>;
type TaskMessageRow = { id: string; metadataJson?: unknown | null };
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

type SpecificationDecision = {
  question: string;
  answer: string;
  why: string;
  section: string;
  deferred: boolean;
};

export function buildSpecificationDocumentContext(input: {
  task: TaskLike;
  session: QuestionnaireSessionLike;
  workspace: PlanModeWorkspace;
  messages: TaskMessageRow[];
}) {
  const latestBlueprint = findLatestBlueprintMessage(input.messages, 'blueprint');
  const latestDataModel = findLatestDataModelMessage(input.messages);
  const blueprint = getMessageBlueprint(latestBlueprint);
  const dataModelArtifact = getMessageDataModelArtifact(latestDataModel);
  return {
    task: [
      `Title: ${input.task.title || 'Untitled'}`,
      input.task.description ? `Description: ${input.task.description}` : null,
      input.task.objective ? `Objective: ${input.task.objective}` : null,
    ]
      .filter(Boolean)
      .join('\n'),
    questionnaireDecisions: renderQuestionnaireAnswerMarkdown(input.session),
    blueprintSummary: renderCompressedBlueprintNaturalLanguage(blueprint),
    dataModelDdl: renderDataModelDdlReference(dataModelArtifact),
    traceability: [
      `Questionnaire session: ${input.session.id}`,
      latestBlueprint
        ? `Blueprint message: ${latestBlueprint.id}`
        : 'Blueprint message: not generated',
      latestDataModel
        ? `Data Model message: ${latestDataModel.id}`
        : 'Data Model message: not generated',
      `Workspace counts: blueprint=${input.workspace.blueprintArtifacts.length}, dataModel=${input.workspace.dataModelArtifacts.length}`,
    ].join('\n'),
  };
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
  return parts.join(' ');
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

function _renderSpecificationDesignDocument(input: {
  task: TaskLike;
  session: QuestionnaireSessionLike;
  workspace: PlanModeWorkspace;
  messages: TaskMessageRow[];
}) {
  const latestBlueprint = findLatestBlueprintMessage(input.messages, 'blueprint');
  const latestDataModel = findLatestDataModelMessage(input.messages);
  const blueprint = getMessageBlueprint(latestBlueprint);
  const dataModelArtifact = getMessageDataModelArtifact(latestDataModel);
  const decisionRows = collectQuestionnaireDecisions(input.session);
  const screens = toRecordArray(blueprint?.screens);
  const implementationTasks = toRecordArray(blueprint?.implementationTasks);
  const dataSource = dataModelArtifact || blueprint;
  const tables = dataModelArtifact
    ? toRecordArray(dataModelArtifact.derivedTables)
    : toRecordArray(isRecord(dataSource?.databaseSchema) ? dataSource.databaseSchema.tables : []);
  const relations = dataModelArtifact
    ? toRecordArray(dataModelArtifact.relations)
    : toRecordArray(
        isRecord(dataSource?.databaseSchema) ? dataSource.databaseSchema.relations : []
      );
  const bindings = dataModelArtifact ? [] : toRecordArray(dataSource?.dataBindings);
  return [
    `# ${input.task.title || 'Specification'}`,
    '',
    '## 1. 目的',
    renderSpecificationPurpose(input.task, blueprint),
    '',
    '## 2. 決定済みスコープ',
    renderDecisionSummary(decisionRows),
    '',
    '## 3. 画面仕様',
    renderScreenSpecification(screens),
    '',
    '## 4. 機能要件',
    renderFunctionalRequirements(screens, implementationTasks),
    '',
    '## 5. データ/API 方針',
    renderDataSpecification({
      tables,
      relations,
      bindings,
      hasDataModel: Boolean(latestDataModel),
    }),
    '',
    '## 6. 非対象・後続判断',
    renderOutOfScope(decisionRows, Boolean(latestDataModel)),
    '',
    '## 7. 受け入れ条件',
    renderAcceptanceCriteria(screens, decisionRows),
    '',
    '## 8. トレーサビリティ',
    renderTraceability({
      session: input.session,
      workspace: input.workspace,
      latestBlueprint,
      latestDataModel,
    }),
    '',
    '## Appendix. Questionnaire Decisions',
    renderQuestionnaireAnswerMarkdown(input.session),
  ].join('\n');
}

function findLatestBlueprintMessage(messages: TaskMessageRow[], kind: 'blueprint') {
  return [...messages].reverse().find((message) => {
    const metadata = isRecord(message.metadataJson) ? message.metadataJson : {};
    if (metadata.intent !== 'app_blueprint' || !metadata.appBlueprint) return false;
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

function getMessageBlueprint(message: TaskMessageRow | undefined): JsonRecord | null {
  const metadata = isRecord(message?.metadataJson) ? message.metadataJson : {};
  const blueprint = metadata.appBlueprint;
  return isRecord(blueprint) ? blueprint : null;
}

function getMessageDataModelArtifact(message: TaskMessageRow | undefined): JsonRecord | null {
  const metadata = isRecord(message?.metadataJson) ? message.metadataJson : {};
  const artifact = metadata.dataModelArtifact;
  if (isRecord(artifact)) return artifact;
  return null;
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

function collectQuestionnaireDecisions(session: QuestionnaireSessionLike): SpecificationDecision[] {
  const answerByQuestionId = new Map(session.answers.map((item) => [item.questionId, item]));
  return toRecordArray(getSessionQuestions(session)).map((question) => {
    const answer = answerByQuestionId.get(String(question.id));
    return {
      question: String(question.question || question.text || question.id),
      answer: renderQuestionnaireAnswer(question, answer?.answer),
      why: typeof question.why === 'string' ? question.why : '',
      section: typeof question.outputSection === 'string' ? question.outputSection : '',
      deferred: Boolean(answer?.answer?.deferred),
    };
  });
}

function renderSpecificationPurpose(task: TaskLike, blueprint: JsonRecord | null) {
  const lines = [
    task.description ? `- 背景: ${task.description}` : null,
    task.objective ? `- 目的: ${task.objective}` : null,
    blueprint?.description ? `- 画面方針: ${blueprint.description}` : null,
    blueprint?.name ? `- 対象 Blueprint: ${blueprint.name}` : null,
  ].filter(Boolean);
  return lines.length > 0
    ? lines.join('\n')
    : '- 実装前に確定した質問回答と Blueprint をもとに、初期実装の仕様を定義する。';
}

function renderDecisionSummary(decisions: SpecificationDecision[]) {
  const answered = decisions.filter((decision) => decision.answer !== '未回答');
  if (answered.length === 0) return '- まだ仕様判断は記録されていない。';
  return answered
    .flatMap((decision, index) => [
      `### 2.${index + 1}. ${decision.question}`,
      `- 決定: ${decision.answer}`,
      decision.deferred ? '- 状態: 後続判断' : '- 状態: 確定',
    ])
    .join('\n');
}

function renderScreenSpecification(screens: JsonRecord[]) {
  if (screens.length === 0) return '- Blueprint が未生成のため、画面仕様は未定義。';
  return screens
    .map((screen, screenIndex) => {
      const sections = toRecordArray(screen.sections);
      return [
        `### 3.${screenIndex + 1}. ${String(screen.name || screen.id || `Screen ${screenIndex + 1}`)}`,
        `- パス: ${String(screen.path || '/')}`,
        `- 画面種別: ${String(screen.componentName || 'Page')}`,
        sections.length > 0 ? '- セクション:' : '- セクション: 未定義',
        ...sections.map((section, sectionIndex) => {
          const props = isRecord(section.props) ? section.props : {};
          const label = String(
            section.name || section.title || section.id || `Section ${sectionIndex + 1}`
          );
          const component = String(section.componentName || 'Section');
          const description = String(
            props.description || section.visualIntent || section.intent || ''
          ).trim();
          return `  - ${label}: ${component}${description ? `。${description}` : ''}`;
        }),
      ].join('\n');
    })
    .join('\n\n');
}

function renderFunctionalRequirements(screens: JsonRecord[], implementationTasks: JsonRecord[]) {
  const sectionRequirements = screens.flatMap((screen) =>
    toRecordArray(screen.sections).map((section) => {
      const props = isRecord(section.props) ? section.props : {};
      const title = String(section.name || props.title || section.id || 'Section');
      const component = String(section.componentName || 'Section');
      const description = String(
        props.description || section.intent || section.visualIntent || ''
      ).trim();
      return `- ${title} を ${component} として実装し、${description || '画面目的に沿った表示と操作を提供する。'}`;
    })
  );
  const taskRequirements = implementationTasks.map((task) => {
    const title = String(task.title || task.id || 'Implementation task');
    const description = String(task.description || '').trim();
    return `- ${title}${description ? `: ${description}` : ''}`;
  });
  const requirements = [...sectionRequirements, ...taskRequirements];
  return requirements.length > 0 ? requirements.join('\n') : '- Blueprint の機能要件は未生成。';
}

function renderDataSpecification(input: {
  tables: JsonRecord[];
  relations: JsonRecord[];
  bindings: JsonRecord[];
  hasDataModel: boolean;
}) {
  if (input.tables.length === 0 && input.bindings.length === 0) {
    return input.hasDataModel
      ? '- Data Model は生成済みだが、table / binding はまだ定義されていない。'
      : '- Data Model は未生成。現時点では Blueprint の画面仕様を優先し、物理 DB / DDL / migration は確定しない。';
  }
  const lines = [
    input.hasDataModel
      ? '- Data Model artifact の内容をデータ方針として採用する。'
      : '- Blueprint 内の暫定 data schema を参考情報として扱う。Data Model で確定する。',
  ];
  if (input.tables.length > 0) {
    lines.push('- Tables:');
    lines.push(
      ...input.tables.map((table) => {
        const columns = toRecordArray(table.columns)
          .map((column) => String(column.name || column.key || column.label || '').trim())
          .filter(Boolean);
        return `  - ${String(table.label || table.name || 'table')}${columns.length ? `: ${columns.join(', ')}` : ''}`;
      })
    );
  }
  if (input.relations.length > 0) lines.push(`- Relations: ${input.relations.length} 件`);
  if (input.bindings.length > 0) {
    lines.push('- UI Bindings:');
    lines.push(
      ...input.bindings.map((binding) => {
        const fields = Array.isArray(binding.fields) ? binding.fields.join(', ') : '';
        return `  - ${String(binding.name || binding.id || 'binding')}${fields ? `: ${fields}` : ''}`;
      })
    );
  }
  return lines.join('\n');
}

function renderOutOfScope(decisions: SpecificationDecision[], hasDataModel: boolean) {
  const deferred = decisions.filter((decision) => decision.deferred);
  const lines = [
    hasDataModel
      ? null
      : '- DB の物理設計、DDL、migration、詳細な relation 設計は Data Model 生成後に確定する。',
    ...deferred.map((decision) => `- 後続判断: ${decision.question}`),
  ].filter(Boolean);
  return lines.length > 0 ? lines.join('\n') : '- 現時点で明示的な非対象事項はない。';
}

function renderAcceptanceCriteria(screens: JsonRecord[], decisions: SpecificationDecision[]) {
  const criteria = [
    decisions.length > 0
      ? '- Questionnaire の回答内容が画面構成と機能範囲に反映されていること。'
      : null,
    screens.length > 0
      ? '- Blueprint に定義された主要画面とセクションが実装計画に落とせる粒度で説明されていること。'
      : null,
    '- 仕様書だけを読んで、初期実装の対象・非対象・後続判断が区別できること。',
  ].filter(Boolean);
  return criteria.join('\n');
}

function renderTraceability(input: {
  session: QuestionnaireSessionLike;
  workspace: PlanModeWorkspace;
  latestBlueprint: TaskMessageRow | undefined;
  latestDataModel: TaskMessageRow | undefined;
}) {
  return [
    `- Questionnaire session: ${input.session.id}`,
    `- Questionnaire: ${input.session.answers.length}/${getAnswerableSessionQuestions(input.session, input.session.answers).length}`,
    `- Blueprint artifacts: ${input.workspace.blueprintArtifacts.length}`,
    input.latestBlueprint
      ? `- Blueprint source message: ${input.latestBlueprint.id}`
      : '- Blueprint source message: 未生成',
    `- Data Model artifacts: ${input.workspace.dataModelArtifacts.length}`,
    input.latestDataModel
      ? `- Data Model source message: ${input.latestDataModel.id}`
      : '- Data Model source message: 未生成',
    '',
  ]
    .filter((line) => line !== '')
    .join('\n');
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
  const selected = [...answer.selectedOptionIds, ...answer.rankedOptionIds]
    .map((id) => options.get(id) || id)
    .filter(Boolean);
  return selected.length > 0 ? selected.join(', ') : '未回答';
}
