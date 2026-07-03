import type {
  DesignQuestionnaire,
  DesignQuestionnaireAnswer,
} from '../../../shared/schemas/design-questionnaire.schema';
import type { PlanModeWorkspace } from '../../../shared/schemas/plan-mode-artifact.schema';
import { getSessionQuestions } from '../questionnaire/questionnaire-parser.service';

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

export function buildSpecificationDocumentContext(input: {
  task: TaskLike;
  session: QuestionnaireSessionLike | null;
  workspace: PlanModeWorkspace;
  messages: TaskMessageRow[];
  projectStackContext?: string | null;
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
    projectStackContext: input.projectStackContext?.trim() || 'Project stack は未検出です。',
    questionnaireDecisions: input.session
      ? renderQuestionnaireAnswerMarkdown(input.session)
      : '- Questionnaire は未生成です。',
    blueprintSummary: renderCompressedBlueprintNaturalLanguage(blueprint),
    dataModelDdl: renderDataModelDdlReference(dataModelArtifact),
    traceability: [
      input.session ? `Questionnaire session: ${input.session.id}` : 'Questionnaire session: none',
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
