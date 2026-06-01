import { exec } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { isPathSafe } from './path-policy';
import type { WorkerToolResult } from './types';

const execAsync = promisify(exec);

export interface ApplyPatchInput {
  patchContent: string;
  repoRoot: string;
  readFiles?: string[]; // Relative paths of files read in this run
  allowedPaths?: string[];
  deniedPaths?: string[];
  requireReadBeforeEdit?: boolean;
}

export interface ApplyPatchOutput {
  applied: boolean;
  changedFiles: string[];
  stdout?: string;
  stderr?: string;
}

export async function applyPatchTool(
  input: ApplyPatchInput
): Promise<WorkerToolResult<ApplyPatchOutput>> {
  const startedAt = new Date().toISOString();
  const {
    patchContent,
    repoRoot,
    readFiles = [],
    allowedPaths,
    deniedPaths,
    requireReadBeforeEdit = false,
  } = input;

  const absoluteRepoRoot = path.resolve(repoRoot);
  const tempPatchFile = path.join(
    absoluteRepoRoot,
    `.temp-patch-${Math.random().toString(36).substring(7)}.patch`
  );

  try {
    // 1. Write the patch content to a temp file
    await fs.writeFile(tempPatchFile, patchContent, 'utf-8');

    // 2. Dry run with git apply to parse target files and check if it's safe
    let targets: string[] = [];
    try {
      const { stdout } = await execAsync(`git apply --numstat ${tempPatchFile}`, {
        cwd: absoluteRepoRoot,
      });
      // Parse modified files from numstat output: "added\tdeleted\tpath"
      targets = stdout
        .split('\n')
        .map((line) => line.split('\t')[2])
        .filter((p) => p && p.trim().length > 0);
    } catch (_dryError: any) {
      // If git numstat fails, fallback to parsing diff header manually
      const lines = patchContent.split('\n');
      for (const line of lines) {
        if (line.startsWith('--- a/') || line.startsWith('+++ b/')) {
          const filePart = line.substring(6).trim();
          if (filePart && filePart !== '/dev/null' && !targets.includes(filePart)) {
            targets.push(filePart);
          }
        }
      }
    }

    // 3. Verify safety policies on all target files
    for (const relativePath of targets) {
      const absolutePath = path.resolve(absoluteRepoRoot, relativePath);

      // Workspace boundaries check
      if (!isPathSafe(absolutePath, absoluteRepoRoot, allowedPaths, deniedPaths)) {
        await fs.unlink(tempPatchFile).catch(() => {});
        return {
          ok: false,
          toolName: 'apply_patch',
          startedAt,
          finishedAt: new Date().toISOString(),
          payload: { applied: false, changedFiles: [] },
          error: {
            code: 'ACCESS_DENIED',
            message: `Patch target lies outside allowed workspace directories: ${relativePath}`,
          },
        };
      }

      // Read-before-edit check
      if (requireReadBeforeEdit) {
        const hasBeenRead = readFiles.some((read) => {
          const absRead = path.resolve(absoluteRepoRoot, read);
          return absRead === absolutePath;
        });

        if (!hasBeenRead) {
          await fs.unlink(tempPatchFile).catch(() => {});
          return {
            ok: false,
            toolName: 'apply_patch',
            startedAt,
            finishedAt: new Date().toISOString(),
            payload: { applied: false, changedFiles: [] },
            error: {
              code: 'READ_BEFORE_EDIT_VIOLATION',
              message: `You must read the file contents using read_file before you edit it: ${relativePath}`,
            },
          };
        }
      }
    }

    // 4. Apply the patch using git apply
    const { stdout, stderr } = await execAsync(`git apply --whitespace=fix ${tempPatchFile}`, {
      cwd: absoluteRepoRoot,
    });

    // 5. Clean up temp patch file
    await fs.unlink(tempPatchFile).catch(() => {});

    return {
      ok: true,
      toolName: 'apply_patch',
      startedAt,
      finishedAt: new Date().toISOString(),
      payload: {
        applied: true,
        changedFiles: targets,
        stdout,
        stderr,
      },
    };
  } catch (err: any) {
    // Clean up temp patch file on failure
    await fs.unlink(tempPatchFile).catch(() => {});

    return {
      ok: false,
      toolName: 'apply_patch',
      startedAt,
      finishedAt: new Date().toISOString(),
      payload: {
        applied: false,
        changedFiles: [],
        stdout: '',
        stderr: err.stderr || '',
      },
      error: {
        code: 'PATCH_FAILED',
        message: `Failed to apply patch: ${err.message}`,
      },
    };
  }
}
