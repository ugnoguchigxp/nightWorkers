import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AgentOutcomeScenario } from './scenarios';

export type ScratchWorkspace = {
  path: string;
  cleanup: () => Promise<void>;
  diff: () => string;
};

export async function createScratchWorkspace(
  scenario: AgentOutcomeScenario
): Promise<ScratchWorkspace> {
  const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), `nightworkers-${scenario.id}-`));
  for (const seed of scenario.workspaceSeed) {
    const target = path.join(workspaceDir, seed.path);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, seed.content, 'utf-8');
  }

  execFileSync('git', ['init'], { cwd: workspaceDir, stdio: 'ignore' });
  execFileSync('git', ['add', '.'], { cwd: workspaceDir, stdio: 'ignore' });
  execFileSync(
    'git',
    [
      '-c',
      'user.email=e2e@example.test',
      '-c',
      'user.name=NightWorkers E2E',
      'commit',
      '-m',
      'initial fixture',
    ],
    { cwd: workspaceDir, stdio: 'ignore' }
  );

  return {
    path: workspaceDir,
    cleanup: async () => {
      if (process.env.KEEP_E2E_WORKSPACE === '1') return;
      try {
        await fs.rm(workspaceDir, { recursive: true, force: true });
      } catch (err) {
        console.warn(`Failed to clean scratch workspace ${workspaceDir}:`, err);
      }
    },
    diff: () => {
      const diff = execFileSync('git', ['diff', 'HEAD', '--', '.'], {
        cwd: workspaceDir,
      }).toString('utf-8');
      const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard'], {
        cwd: workspaceDir,
      })
        .toString('utf-8')
        .trim();
      return [diff, untracked ? `Untracked files:\n${untracked}\n` : ''].filter(Boolean).join('\n');
    },
  };
}
