import fs from 'node:fs/promises';
import path from 'node:path';
import { unknownErrorMessage } from '../../../../shared/json-record';
import { buildCompressionMetadata } from '../output-compression';
import { enforcePathPolicy } from '../tool-policy-enforcer';
import type { WorkerToolResult } from '../types';
import { inspectJsonShape } from './json-shape';
import { inspectSourceSymbols } from './source-symbols';
import type { InspectStructureInput, InspectStructureOutput } from './types';

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs']);
const JSON_EXTENSIONS = new Set(['.json']);

export async function inspectStructureTool(
  input: InspectStructureInput
): Promise<WorkerToolResult<InspectStructureOutput>> {
  const startedAt = new Date().toISOString();
  const { filePath, repoRoot, allowedPaths, externalAllowedPaths, deniedPaths } = input;
  const absoluteRepoRoot = path.resolve(repoRoot);
  const targetPath = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(absoluteRepoRoot, filePath);

  const pathDecision = enforcePathPolicy(targetPath, {
    repoRoot: absoluteRepoRoot,
    allowedPaths,
    externalAllowedPaths,
    deniedPaths,
  });
  if (!pathDecision.allowed) {
    return failure(startedAt, {
      code: 'ACCESS_DENIED',
      message: pathDecision.message || `Access to path is denied by security policies: ${filePath}`,
    });
  }

  try {
    const content = await fs.readFile(targetPath, 'utf-8');
    const extension = path.extname(targetPath);
    const output = inspectByExtension({
      extension,
      filePath,
      content,
      includeImports: input.includeImports ?? true,
      previewPrimitives: input.previewPrimitives ?? false,
      maxPaths: input.maxPaths ?? 200,
    });

    return {
      ok: true,
      toolName: 'inspect_structure',
      startedAt,
      finishedAt: new Date().toISOString(),
      payload: withCompression(content, output),
    };
  } catch (err) {
    return failure(startedAt, {
      code: 'INSPECT_STRUCTURE_FAILED',
      message: `Failed to inspect structure: ${unknownErrorMessage(err)}`,
    });
  }
}

function inspectByExtension(input: {
  extension: string;
  filePath: string;
  content: string;
  includeImports: boolean;
  previewPrimitives: boolean;
  maxPaths: number;
}): InspectStructureOutput {
  if (SOURCE_EXTENSIONS.has(input.extension)) {
    return inspectSourceSymbols({
      filePath: input.filePath,
      content: input.content,
      includeImports: input.includeImports,
    });
  }
  if (JSON_EXTENSIONS.has(input.extension)) {
    return inspectJsonShape({
      filePath: input.filePath,
      content: input.content,
      previewPrimitives: input.previewPrimitives,
      maxPaths: input.maxPaths,
    });
  }
  throw new Error(`Unsupported structure file type: ${input.extension || '(none)'}`);
}

function withCompression(
  originalContent: string,
  output: InspectStructureOutput
): InspectStructureOutput {
  const returned = JSON.stringify(output);
  const compression = buildCompressionMetadata({
    strategy: 'read_file_summary',
    original: originalContent,
    returned,
    compressed: true,
    omittedReason: output.kind === 'json' ? 'json_shape_only' : 'source_ast_symbols_only',
  });
  return { ...output, compression };
}

function failure(
  startedAt: string,
  error: { code: string; message: string }
): WorkerToolResult<InspectStructureOutput> {
  return {
    ok: false,
    toolName: 'inspect_structure',
    startedAt,
    finishedAt: new Date().toISOString(),
    payload: {
      kind: 'json',
      filePath: '',
      paths: [],
      truncated: false,
    },
    error,
  };
}
