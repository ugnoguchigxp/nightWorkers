import { type CloneGitRepoOutput, cloneGitRepoTool } from './clone-git-repo';
import { type MaterializeTemplateOutput, materializeTemplateTool } from './materialize-template';
import type { TemplateRegistry } from './template-registry';
import type { WorkerToolResult } from './types';

export interface ImportProjectInput {
  repoRoot: string;
  repoUrl?: string;
  templateId?: string;
  variant?: string;
  overlays?: string[];
  targetPath?: string;
  ref?: string;
  depth?: number;
  overwrite?: boolean;
  stripGitDir?: boolean;
  exclude?: string[];
  allowedPaths?: string[];
  deniedPaths?: string[];
  registry?: TemplateRegistry;
}

export interface ImportProjectOutput {
  mode: 'template' | 'git' | '';
  template?: MaterializeTemplateOutput | null;
  git?: CloneGitRepoOutput | null;
}

export async function importProjectTool(
  input: ImportProjectInput
): Promise<WorkerToolResult<ImportProjectOutput>> {
  const startedAt = new Date().toISOString();
  const repoUrl = input.repoUrl?.trim();
  const templateId = input.templateId?.trim();

  if (repoUrl && templateId) {
    return failedImportProject(
      startedAt,
      'INVALID_IMPORT_PROJECT_ARGS',
      'import_project accepts either repoUrl or templateId, not both.'
    );
  }
  if (!repoUrl && !templateId) {
    return failedImportProject(
      startedAt,
      'INVALID_IMPORT_PROJECT_ARGS',
      'import_project requires repoUrl for arbitrary Git imports or templateId for standard templates.'
    );
  }

  if (templateId) {
    const result = await materializeTemplateTool({
      templateId,
      variant: input.variant,
      overlays: input.overlays,
      targetPath: input.targetPath,
      overwrite: input.overwrite,
      exclude: input.exclude,
      repoRoot: input.repoRoot,
      allowedPaths: input.allowedPaths,
      deniedPaths: input.deniedPaths,
      registry: input.registry,
    });
    return {
      ok: result.ok,
      toolName: 'import_project',
      startedAt,
      finishedAt: result.finishedAt,
      payload: { mode: 'template', template: result.payload, git: null },
      error: result.error,
      artifactIds: result.artifactIds,
    };
  }

  const result = await cloneGitRepoTool({
    repoUrl: repoUrl || '',
    targetPath: input.targetPath,
    ref: input.ref,
    depth: input.depth,
    overwrite: input.overwrite,
    stripGitDir: input.stripGitDir,
    repoRoot: input.repoRoot,
    allowedPaths: input.allowedPaths,
    deniedPaths: input.deniedPaths,
  });
  return {
    ok: result.ok,
    toolName: 'import_project',
    startedAt,
    finishedAt: result.finishedAt,
    payload: { mode: 'git', template: null, git: result.payload },
    error: result.error,
    artifactIds: result.artifactIds,
  };
}

function failedImportProject(
  startedAt: string,
  code: string,
  message: string
): WorkerToolResult<ImportProjectOutput> {
  return {
    ok: false,
    toolName: 'import_project',
    startedAt,
    finishedAt: new Date().toISOString(),
    payload: { mode: '', template: null, git: null },
    error: { code, message },
  };
}
