import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  resolveStandardTemplate,
  standardTemplateRegistry,
  type TemplateRegistry,
} from './template-registry';
import { enforcePathPolicy } from './tool-policy-enforcer';
import type { WorkerToolResult } from './types';

const execFileAsync = promisify(execFile);

const DEFAULT_EXCLUDES = new Set([
  '.git',
  '.DS_Store',
  'node_modules',
  '.venv',
  'venv',
  'dist',
  'dist-api',
  'dist-server',
  'build',
  '.next',
  'coverage',
  '.pytest_cache',
  '.mypy_cache',
  '.ruff_cache',
  '.pyright',
  'playwright-report',
  'test-results',
  '.env',
  '.env.local',
  '.env.development.local',
  '.env.test.local',
  '.env.production.local',
]);

const EMPTY_TARGET_IGNORES = new Set(['.git', '.DS_Store']);

export interface MaterializeTemplateInput {
  templateId: string;
  variant?: string;
  overlays?: string[];
  targetPath?: string;
  overwrite?: boolean;
  exclude?: string[];
  repoRoot: string;
  allowedPaths?: string[];
  deniedPaths?: string[];
  registry?: TemplateRegistry;
}

export interface MaterializeTemplateOutput {
  templateId: string;
  variant: string;
  ref: string;
  repoUrl: string;
  commit: string | null;
  targetPath: string;
  copiedFiles: number;
  skippedFiles: number;
  copiedDirectories: number;
  overlays: string[];
}

function emptyPayload(input: MaterializeTemplateInput, targetPath: string) {
  return {
    templateId: input.templateId,
    variant: input.variant || '',
    ref: '',
    repoUrl: '',
    commit: null,
    targetPath,
    copiedFiles: 0,
    skippedFiles: 0,
    copiedDirectories: 0,
    overlays: input.overlays || [],
  };
}

async function runGit(args: string[], cwd?: string) {
  const result = await execFileAsync('git', args, {
    cwd,
    timeout: 120_000,
    maxBuffer: 5 * 1024 * 1024,
  });
  return {
    stdout: String(result.stdout || '').trim(),
    stderr: String(result.stderr || '').trim(),
  };
}

async function targetHasMaterialContent(targetPath: string) {
  const entries = await fs.readdir(targetPath, { withFileTypes: true }).catch((error: any) => {
    if (error?.code === 'ENOENT') return [];
    throw error;
  });
  return entries.some((entry) => !EMPTY_TARGET_IGNORES.has(entry.name));
}

function isExcluded(relativePath: string, entryName: string, excludes: Set<string>) {
  if (excludes.has(entryName) || excludes.has(relativePath)) return true;
  return relativePath.split(path.sep).some((segment) => excludes.has(segment));
}

export async function materializeTemplateTool(
  input: MaterializeTemplateInput
): Promise<WorkerToolResult<MaterializeTemplateOutput>> {
  const startedAt = new Date().toISOString();
  const absoluteRepoRoot = path.resolve(input.repoRoot);
  const targetPath = path.resolve(absoluteRepoRoot, input.targetPath || '.');
  const failedPayload = emptyPayload(input, targetPath);
  const requestedVariant =
    typeof input.variant === 'string' ? input.variant.trim().toLowerCase().replace(/_/g, '-') : '';

  const resolved = resolveStandardTemplate({
    templateId: input.templateId,
    variant: input.variant,
    registry: input.registry || standardTemplateRegistry,
  });
  if (!resolved.ok) {
    return {
      ok: false,
      toolName: 'materialize_template',
      startedAt,
      finishedAt: new Date().toISOString(),
      payload: failedPayload,
      error: { code: resolved.code, message: resolved.message },
    };
  }

  const normalizedOverlays = (input.overlays || []).map((overlay) =>
    overlay.trim().toLowerCase().replace(/_/g, '-')
  );
  const hasNonDefaultVariant =
    Boolean(requestedVariant) &&
    requestedVariant !== resolved.template.defaultVariant &&
    requestedVariant !== 'baseline';
  const unknownOverlay = normalizedOverlays.find((overlay) => !resolved.template.overlays[overlay]);
  if (unknownOverlay) {
    return {
      ok: false,
      toolName: 'materialize_template',
      startedAt,
      finishedAt: new Date().toISOString(),
      payload: { ...failedPayload, repoUrl: resolved.template.repoUrl, ref: resolved.variant.ref },
      error: {
        code: 'UNKNOWN_TEMPLATE_OVERLAY',
        message: `Unknown ${resolved.template.id} overlay: ${unknownOverlay}`,
      },
    };
  }
  if (normalizedOverlays.length > 1) {
    return {
      ok: false,
      toolName: 'materialize_template',
      startedAt,
      finishedAt: new Date().toISOString(),
      payload: { ...failedPayload, repoUrl: resolved.template.repoUrl, ref: resolved.variant.ref },
      error: {
        code: 'MULTIPLE_TEMPLATE_OVERLAYS_NOT_IMPLEMENTED',
        message: 'materialize_template supports one overlay ref at a time.',
      },
    };
  }
  if (normalizedOverlays.length === 1 && hasNonDefaultVariant) {
    return {
      ok: false,
      toolName: 'materialize_template',
      startedAt,
      finishedAt: new Date().toISOString(),
      payload: { ...failedPayload, repoUrl: resolved.template.repoUrl, ref: resolved.variant.ref },
      error: {
        code: 'TEMPLATE_VARIANT_OVERLAY_CONFLICT',
        message:
          'materialize_template cannot combine a DB variant and an overlay snapshot in one operation.',
      },
    };
  }
  const overlay = normalizedOverlays[0] ? resolved.template.overlays[normalizedOverlays[0]] : null;
  const selectedRef = overlay?.ref || resolved.variant.ref;

  const targetPolicy = enforcePathPolicy(targetPath, {
    repoRoot: absoluteRepoRoot,
    allowedPaths: input.allowedPaths,
    deniedPaths: input.deniedPaths,
  });
  if (!targetPolicy.allowed) {
    return {
      ok: false,
      toolName: 'materialize_template',
      startedAt,
      finishedAt: new Date().toISOString(),
      payload: { ...failedPayload, repoUrl: resolved.template.repoUrl, ref: selectedRef },
      error: {
        code: 'ACCESS_DENIED',
        message:
          targetPolicy.message || `Template target is restricted by policy: ${input.targetPath}`,
      },
    };
  }

  const relativeTarget = path.relative(absoluteRepoRoot, targetPath);
  if (relativeTarget.startsWith('..') || path.isAbsolute(relativeTarget)) {
    return {
      ok: false,
      toolName: 'materialize_template',
      startedAt,
      finishedAt: new Date().toISOString(),
      payload: { ...failedPayload, repoUrl: resolved.template.repoUrl, ref: selectedRef },
      error: {
        code: 'ACCESS_DENIED',
        message: 'Template target must stay inside the project root.',
      },
    };
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nightworkers-template-'));
  try {
    await fs.mkdir(targetPath, { recursive: true });
    if (!input.overwrite && (await targetHasMaterialContent(targetPath))) {
      return {
        ok: false,
        toolName: 'materialize_template',
        startedAt,
        finishedAt: new Date().toISOString(),
        payload: { ...failedPayload, repoUrl: resolved.template.repoUrl, ref: selectedRef },
        error: {
          code: 'TARGET_NOT_EMPTY',
          message:
            'Template target already contains files. Pass overwrite=true only when replacing existing files is intended.',
        },
      };
    }

    const cloneDir = path.join(tempDir, 'repo');
    await runGit(
      ['clone', '--depth', '1', '--branch', selectedRef, resolved.template.repoUrl, cloneDir],
      tempDir
    );
    const commit = await runGit(['rev-parse', 'HEAD'], cloneDir).then(
      (result) => result.stdout || null
    );

    const excludes = new Set([...DEFAULT_EXCLUDES, ...(input.exclude || [])]);
    let copiedFiles = 0;
    let skippedFiles = 0;
    let copiedDirectories = 0;

    const copyRecursive = async (sourceDir: string, destinationDir: string, relativeDir = '') => {
      await fs.mkdir(destinationDir, { recursive: true });
      copiedDirectories += 1;
      const entries = await fs.readdir(sourceDir, { withFileTypes: true });
      for (const entry of entries) {
        const relativeEntry = relativeDir ? path.join(relativeDir, entry.name) : entry.name;
        if (isExcluded(relativeEntry, entry.name, excludes)) continue;
        const source = path.join(sourceDir, entry.name);
        const destination = path.join(destinationDir, entry.name);
        if (entry.isDirectory()) {
          await copyRecursive(source, destination, relativeEntry);
          continue;
        }
        if (!entry.isFile()) continue;
        const exists = await fs
          .stat(destination)
          .then(() => true)
          .catch(() => false);
        if (exists && !input.overwrite) {
          skippedFiles += 1;
          continue;
        }
        await fs.copyFile(source, destination);
        copiedFiles += 1;
      }
    };

    await copyRecursive(cloneDir, targetPath);
    return {
      ok: true,
      toolName: 'materialize_template',
      startedAt,
      finishedAt: new Date().toISOString(),
      payload: {
        templateId: resolved.template.id,
        variant: resolved.variant.name,
        ref: selectedRef,
        repoUrl: resolved.template.repoUrl,
        commit,
        targetPath,
        copiedFiles,
        skippedFiles,
        copiedDirectories,
        overlays: normalizedOverlays,
      },
    };
  } catch (error: any) {
    return {
      ok: false,
      toolName: 'materialize_template',
      startedAt,
      finishedAt: new Date().toISOString(),
      payload: { ...failedPayload, repoUrl: resolved.template.repoUrl, ref: selectedRef },
      error: {
        code: 'MATERIALIZE_TEMPLATE_FAILED',
        message: `Template materialization failed: ${error.message}`,
      },
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}
