import crypto from 'node:crypto';
import path from 'node:path';
import { compactLineSections, selectWindow, uniqueLines } from './markers';
import { buildCompressionMetadata, estimateTokens } from './metadata';
import type { ReadFileCacheEntry, ToolOutputCompressionMetadata } from './types';

const MAX_READ_INLINE_LINES = 260;
const IMPORTANT_SOURCE_RE =
  /\b(export|class|interface|type |function|const |let |var |async |describe\(|it\(|test\(|error|throw|TODO|FIXME)\b/;

export function hashContent(content: string): string {
  return `sha256:${crypto.createHash('sha256').update(content).digest('hex')}`;
}

export function getReadCacheKey(absolutePath: string): string {
  return path.resolve(absolutePath);
}

export function updateReadCache(input: {
  cache: Map<string, ReadFileCacheEntry>;
  absolutePath: string;
  content: string;
  totalLines: number;
  now: string;
}): { contentHash: string } {
  const contentHash = hashContent(input.content);
  const key = getReadCacheKey(input.absolutePath);
  const existing = input.cache.get(key);
  input.cache.set(key, {
    absolutePath: input.absolutePath,
    contentHash,
    totalLines: input.totalLines,
    tokenEstimate: estimateTokens(input.content),
    firstReadAt: existing?.firstReadAt ?? input.now,
    lastReadAt: input.now,
  });
  return { contentHash };
}

export function buildReadCacheMarker(input: { filePath: string; entry: ReadFileCacheEntry }): {
  content: string;
  compression: ToolOutputCompressionMetadata;
} {
  const marker = JSON.stringify(
    {
      status: 'cached',
      filePath: input.filePath,
      totalLines: input.entry.totalLines,
      contentReturned: false,
      contentHash: input.entry.contentHash,
      note: 'File content is unchanged and intentionally omitted from this repeated read. Use fresh=true or a line range only if exact content is needed again.',
    },
    null,
    2
  );
  return {
    content: marker,
    compression: buildCompressionMetadata({
      strategy: 'read_cache_marker',
      original: '',
      returned: marker,
      compressed: true,
      contentHash: input.entry.contentHash,
      omittedReason: 'unchanged_file_already_read',
    }),
  };
}

export function compressReadFileContent(input: {
  filePath: string;
  rawContent: string;
  lines: string[];
  contentHash?: string;
}): {
  content: string;
  linesReturned: number;
  compression?: ToolOutputCompressionMetadata;
} {
  if (input.lines.length <= MAX_READ_INLINE_LINES) {
    return {
      content: numberLines(input.lines, 1),
      linesReturned: input.lines.length,
    };
  }

  const important: string[] = [];
  for (let index = 0; index < input.lines.length; index += 1) {
    if (IMPORTANT_SOURCE_RE.test(input.lines[index])) {
      important.push(...selectWindow(input.lines, index, 1));
    }
  }

  const head = input.lines.slice(0, 80);
  const tail = input.lines.slice(-80);
  const body = compactLineSections([
    { title: 'important lines', lines: uniqueLines(important).slice(0, 120) },
    { title: 'head', lines: numberLinesArray(head, 1) },
    { title: 'tail', lines: numberLinesArray(tail, input.lines.length - tail.length + 1) },
  ]);
  const marker = [
    '[read-file-compressed]',
    `filePath: ${input.filePath}`,
    `totalLines: ${input.lines.length}`,
    input.contentHash ? `contentHash: ${input.contentHash}` : '',
    'Use compressionMode="off" or a line range when exact content is needed.',
  ]
    .filter(Boolean)
    .join('\n');
  const returned = `${marker}\n\n${body}`;

  return {
    content: returned,
    linesReturned: returned.split(/\r?\n/).length,
    compression: buildCompressionMetadata({
      strategy: 'read_file_summary',
      original: input.rawContent,
      returned,
      compressed: true,
      contentHash: input.contentHash,
      omittedReason: 'large_file_default_compression',
    }),
  };
}

function numberLines(lines: string[], startLine: number): string {
  return numberLinesArray(lines, startLine).join('\n');
}

function numberLinesArray(lines: string[], startLine: number): string[] {
  return lines.map((line, idx) => `${startLine + idx}: ${line}`);
}
