import { createHash } from 'node:crypto';
import * as repo from '../../modules/nightworkers/nightworkers.repository';
import type { WorkerToolResult } from './types';

export interface ReadCurrentSpecificationInput {
  taskId: string;
}

export interface ReadCurrentSpecificationOutput {
  taskId: string;
  found: boolean;
  messageId: string | null;
  title: string | null;
  content: string;
  generatedAt: string | null;
  digest: string | null;
  sources: {
    questionnaireSessionId?: string;
    blueprintSummaryIncluded?: boolean;
    dbDdlReferenceIncluded?: boolean;
  };
}

export async function readCurrentSpecificationTool(
  input: ReadCurrentSpecificationInput
): Promise<WorkerToolResult<ReadCurrentSpecificationOutput>> {
  const startedAt = new Date().toISOString();
  const taskId = String(input.taskId || '').trim();
  if (!taskId) {
    return failedReadCurrentSpecification(startedAt, 'INVALID_TOOL_ARGS', 'taskId is required.');
  }

  try {
    const messages = await repo.listTaskMessages(taskId);
    const latest = [...messages].reverse().find((message) => {
      const metadata = toRecord(message.metadataJson);
      return message.messageType === 'markdown_document' && metadata.intent === 'draft_spec';
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
          : 'Specification';
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
        content,
        generatedAt: String(latest.createdAt),
        digest: `sha256:${createHash('sha256').update(content).digest('hex')}`,
        sources: {
          questionnaireSessionId:
            typeof metadata.questionnaireSessionId === 'string'
              ? metadata.questionnaireSessionId
              : undefined,
          blueprintSummaryIncluded:
            typeof generationContext.blueprintSummaryIncluded === 'boolean'
              ? generationContext.blueprintSummaryIncluded
              : undefined,
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
      generatedAt: null,
      digest: null,
      sources: {},
    },
    error: { code, message },
  };
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function toRecord(value: unknown): Record<string, any> {
  return isRecord(value) ? value : {};
}
