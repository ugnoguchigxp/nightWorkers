import { createHash } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { taskMessages, tasks } from '../../db/schema';
import * as repo from '../../modules/nightworkers/nightworkers.repository';
import type { WorkerToolResult } from './types';

export interface ReadCurrentSpecificationInput {
  taskId: string;
  view?: ReadCurrentSpecificationView;
}

export type ReadCurrentSpecificationView =
  | 'compact'
  | 'implementation'
  | 'migration'
  | 'ui'
  | 'verification'
  | 'full';

export interface ReadCurrentSpecificationOutput {
  taskId: string;
  found: boolean;
  messageId: string | null;
  title: string | null;
  content: string;
  view?: ReadCurrentSpecificationView;
  fullContentChars?: number;
  fullContentDigest?: string | null;
  compactWarning?: string;
  generatedAt: string | null;
  digest: string | null;
  sources: {
    questionnaireSessionId?: string;
    blueprintSummaryIncluded?: boolean;
    dataModelReferenceIncluded?: boolean;
    dbDdlReferenceIncluded?: boolean;
  };
}

export interface ListRecentSpecificationsInput {
  limit?: number;
}

export interface RecentSpecificationSummary {
  taskId: string;
  taskTitle: string;
  messageId: string;
  title: string;
  generatedAt: string;
  digest: string;
  contentPreview: string;
}

export interface ListRecentSpecificationsOutput {
  specifications: RecentSpecificationSummary[];
}

export async function readCurrentSpecificationTool(
  input: ReadCurrentSpecificationInput
): Promise<WorkerToolResult<ReadCurrentSpecificationOutput>> {
  const startedAt = new Date().toISOString();
  const taskId = String(input.taskId || '').trim();
  const view = normalizeSpecificationView(input.view);
  if (!taskId) {
    return failedReadCurrentSpecification(startedAt, 'INVALID_TOOL_ARGS', 'taskId is required.');
  }

  try {
    const messages = await repo.listTaskMessages(taskId);
    const latest = [...messages].reverse().find((message) => {
      const metadata = toRecord(message.metadataJson);
      return isPlanSpecificationMessage(message.messageType, metadata);
    });
    if (!latest) {
      return {
        ok: true,
        toolName: 'read_current_specification',
        startedAt,
        finishedAt: new Date().toISOString(),
        payload: {
          taskId,
          found: false,
          messageId: null,
          title: null,
          content: '',
          view,
          fullContentChars: 0,
          fullContentDigest: null,
          generatedAt: null,
          digest: null,
          sources: {},
        },
      };
    }

    const metadata = toRecord(latest.metadataJson);
    const markdownDocumentData = isRecord(metadata.markdownDocumentData)
      ? metadata.markdownDocumentData
      : {};
    const content =
      typeof markdownDocumentData.content === 'string'
        ? markdownDocumentData.content
        : latest.content;
    const title =
      typeof markdownDocumentData.title === 'string'
        ? markdownDocumentData.title
        : typeof metadata.title === 'string'
          ? metadata.title
          : 'Feature Plan';
    const digest = `sha256:${createHash('sha256').update(content).digest('hex')}`;
    const projectedContent = projectSpecificationContent(content, view);
    const generation = isRecord(metadata.generation) ? metadata.generation : {};
    const generationContext = isRecord(generation.context) ? generation.context : {};

    return {
      ok: true,
      toolName: 'read_current_specification',
      startedAt,
      finishedAt: new Date().toISOString(),
      payload: {
        taskId,
        found: true,
        messageId: latest.id,
        title,
        content: projectedContent.content,
        view,
        fullContentChars: content.length,
        fullContentDigest: digest,
        compactWarning: projectedContent.warning,
        generatedAt: String(latest.createdAt),
        digest,
        sources: {
          questionnaireSessionId:
            typeof metadata.questionnaireSessionId === 'string'
              ? metadata.questionnaireSessionId
              : undefined,
          blueprintSummaryIncluded:
            typeof generationContext.blueprintSummaryIncluded === 'boolean'
              ? generationContext.blueprintSummaryIncluded
              : undefined,
          dataModelReferenceIncluded: readOptionalBoolean(
            generationContext.dataModelReferenceIncluded,
            generationContext.dataModelDdlReferenceIncluded,
            generationContext.dbDdlReferenceIncluded
          ),
          dbDdlReferenceIncluded:
            typeof generationContext.dbDdlReferenceIncluded === 'boolean'
              ? generationContext.dbDdlReferenceIncluded
              : undefined,
        },
      },
    };
  } catch (error) {
    return failedReadCurrentSpecification(
      startedAt,
      'READ_SPECIFICATION_FAILED',
      error instanceof Error ? error.message : String(error)
    );
  }
}

export async function listRecentSpecificationsTool(
  input: ListRecentSpecificationsInput = {}
): Promise<WorkerToolResult<ListRecentSpecificationsOutput>> {
  const startedAt = new Date().toISOString();
  const limit = normalizeLimit(input.limit);

  try {
    const rows = await db
      .select({
        messageId: taskMessages.id,
        taskId: taskMessages.taskId,
        taskTitle: tasks.title,
        content: taskMessages.content,
        metadataJson: taskMessages.metadataJson,
        createdAt: taskMessages.createdAt,
        messageType: taskMessages.messageType,
      })
      .from(taskMessages)
      .innerJoin(tasks, eq(taskMessages.taskId, tasks.id))
      .orderBy(desc(taskMessages.createdAt))
      .limit(Math.max(limit * 4, 20));

    const specifications: RecentSpecificationSummary[] = [];
    for (const row of rows) {
      if (specifications.length >= limit) break;
      const metadata = toRecord(row.metadataJson);
      if (!isPlanSpecificationMessage(row.messageType, metadata)) continue;
      const markdownDocumentData = isRecord(metadata.markdownDocumentData)
        ? metadata.markdownDocumentData
        : {};
      const content =
        typeof markdownDocumentData.content === 'string'
          ? markdownDocumentData.content
          : row.content;
      const title =
        typeof markdownDocumentData.title === 'string'
          ? markdownDocumentData.title
          : typeof metadata.title === 'string'
            ? metadata.title
            : 'Feature Plan';
      specifications.push({
        taskId: row.taskId,
        taskTitle: row.taskTitle,
        messageId: row.messageId,
        title,
        generatedAt: String(row.createdAt),
        digest: `sha256:${createHash('sha256').update(content).digest('hex')}`,
        contentPreview: content.slice(0, 500),
      });
    }

    return {
      ok: true,
      toolName: 'list_recent_specifications',
      startedAt,
      finishedAt: new Date().toISOString(),
      payload: { specifications },
    };
  } catch (error) {
    return {
      ok: false,
      toolName: 'list_recent_specifications',
      startedAt,
      finishedAt: new Date().toISOString(),
      payload: { specifications: [] },
      error: {
        code: 'LIST_SPECIFICATIONS_FAILED',
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

function failedReadCurrentSpecification(
  startedAt: string,
  code: string,
  message: string
): WorkerToolResult<ReadCurrentSpecificationOutput> {
  return {
    ok: false,
    toolName: 'read_current_specification',
    startedAt,
    finishedAt: new Date().toISOString(),
    payload: {
      taskId: '',
      found: false,
      messageId: null,
      title: null,
      content: '',
      view: 'compact',
      fullContentChars: 0,
      fullContentDigest: null,
      generatedAt: null,
      digest: null,
      sources: {},
    },
    error: { code, message },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function toRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isPlanSpecificationMessage(messageType: unknown, metadata: Record<string, unknown>) {
  const intent = String(metadata.intent || '');
  return (
    messageType === 'markdown_document' && (intent === 'feature_plan' || intent === 'draft_spec')
  );
}

function readOptionalBoolean(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'boolean') return value;
  }
  return undefined;
}

function normalizeSpecificationView(value: unknown): ReadCurrentSpecificationView {
  return value === 'implementation' ||
    value === 'migration' ||
    value === 'ui' ||
    value === 'verification' ||
    value === 'full'
    ? value
    : 'compact';
}

function projectSpecificationContent(
  content: string,
  view: ReadCurrentSpecificationView
): { content: string; warning?: string } {
  if (view === 'full' || content.length <= 8000) return { content };
  const selected = selectSpecificationSections(content, view);
  if (selected.trim().length > 0) return { content: selected };
  return {
    content: [
      '[specification-compact-view]',
      '',
      content.slice(0, 3000),
      '',
      content.slice(-3000),
    ].join('\n'),
    warning: "Section extraction was uncertain. Use view='full' for the complete markdown.",
  };
}

function selectSpecificationSections(content: string, view: ReadCurrentSpecificationView) {
  const wanted =
    view === 'implementation'
      ? ['scope', 'implementation', 'acceptance', 'files', 'steps', 'todo']
      : view === 'migration'
        ? ['migration', 'schema', 'database', 'data model', 'rollback']
        : view === 'ui'
          ? ['ui', 'ux', 'screen', 'component', 'interaction']
          : view === 'verification'
            ? ['verification', 'test', 'acceptance', 'gate', 'expected']
            : ['purpose', 'goal', 'scope', 'acceptance', 'implementation', 'verification'];
  const lines = content.split(/\r?\n/);
  const selectedSections: string[] = [];
  let currentSection: string[] = [];
  let includeCurrentSection = false;
  let matched = false;
  const flushSection = () => {
    if (!includeCurrentSection || currentSection.length === 0) return;
    const section = currentSection.join('\n');
    selectedSections.push(
      section.length > 1800 ? `${section.slice(0, 1800)}\n[section-truncated]` : section
    );
  };
  for (const line of lines) {
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      flushSection();
      currentSection = [line];
      const normalized = heading[2].toLowerCase();
      includeCurrentSection = wanted.some((keyword) => normalized.includes(keyword));
      matched = matched || includeCurrentSection;
      continue;
    }
    if (includeCurrentSection) currentSection.push(line);
  }
  flushSection();
  if (!matched) return '';
  return ['[specification-compact-view]', `view: ${view}`, ...selectedSections]
    .join('\n')
    .slice(0, 8000);
}

function normalizeLimit(value: number | undefined) {
  if (!Number.isFinite(value)) return 10;
  return Math.min(Math.max(Math.trunc(value as number), 1), 50);
}
