import { compactLineSections, selectWindow, uniqueLines } from './markers';
import { buildCompressionMetadata } from './metadata';
import type { ToolOutputCompressionMetadata } from './types';

const MAX_INLINE_CHARS = 20_000;
const IMPORTANT_LINE_RE =
  /\b(error|fatal|exception|failed|failure|panic|traceback|assertion|timeout|timed out|cannot|not found)\b/i;
const SUMMARY_LINE_RE =
  /\b(tests?|suites?|passed|failed|skipped|errors?|warnings?|summary|duration|completed)\b/i;

export interface CompressedStream {
  content: string;
  truncated: boolean;
  compression?: ToolOutputCompressionMetadata;
}

export function compressCommandStream(input: {
  streamName: 'stdout' | 'stderr';
  content: string;
  command: string;
  exitCode: number;
  artifactPath?: string;
}): CompressedStream {
  if (input.content.length <= MAX_INLINE_CHARS) {
    return { content: input.content, truncated: false };
  }

  const lines = input.content.split(/\r?\n/);
  const important: string[] = [];
  const summary: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (IMPORTANT_LINE_RE.test(line)) {
      important.push(...selectWindow(lines, index, 2));
    } else if (SUMMARY_LINE_RE.test(line)) {
      summary.push(line);
    }
  }

  const head = lines.slice(0, 20);
  const tail = lines.slice(-80);
  const body = compactLineSections([
    { title: `${input.streamName}: important lines`, lines: uniqueLines(important).slice(0, 120) },
    { title: `${input.streamName}: summary`, lines: uniqueLines(summary).slice(0, 80) },
    { title: `${input.streamName}: head`, lines: head },
    { title: `${input.streamName}: tail`, lines: tail },
  ]);
  const marker = [
    `[... ${input.streamName} truncated by tool limit ...]`,
    '[command-output-compressed]',
    `stream: ${input.streamName}`,
    `command: ${input.command}`,
    `exitCode: ${input.exitCode}`,
    `originalChars: ${input.content.length}`,
    input.artifactPath ? `fullOutputArtifact: ${input.artifactPath}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  const returned = `${marker}\n\n${body}`.slice(0, MAX_INLINE_CHARS);

  return {
    content: returned,
    truncated: true,
    compression: buildCompressionMetadata({
      strategy: 'log_error_tail',
      original: input.content,
      returned,
      compressed: true,
      artifactPath: input.artifactPath,
      omittedReason: 'large_command_output',
    }),
  };
}
