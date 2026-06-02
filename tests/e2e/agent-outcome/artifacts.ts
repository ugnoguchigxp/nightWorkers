import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { APIRequestContext } from '@playwright/test';
import type { RunDetails, ScenarioHandles } from './api-fixtures';
import { fetchJsonlExport, fetchRunDetails } from './api-fixtures';

export async function collectFailureArtifacts(input: {
  request: APIRequestContext;
  scenarioId: string;
  workspacePath?: string;
  handles: Partial<ScenarioHandles>;
  runDetails?: RunDetails;
}) {
  const outputDir = path.resolve('test-results/nightworkers-agent-outcome', input.scenarioId);
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(
    path.join(outputDir, 'ids.json'),
    JSON.stringify(input.handles, null, 2),
    'utf-8'
  );

  let runDetails = input.runDetails;
  if (!runDetails && input.handles.runId) {
    try {
      runDetails = await fetchRunDetails(input.request, input.handles.runId);
    } catch (err) {
      await fs.writeFile(path.join(outputDir, 'run-fetch-error.txt'), String(err), 'utf-8');
    }
  }

  if (runDetails) {
    await fs.writeFile(
      path.join(outputDir, 'run-details.json'),
      JSON.stringify(runDetails, null, 2),
      'utf-8'
    );
    await fs.writeFile(
      path.join(outputDir, 'events.jsonl'),
      runDetails.events.map((event) => JSON.stringify(event)).join('\n'),
      'utf-8'
    );
  }

  if (input.handles.runId) {
    try {
      await fs.writeFile(
        path.join(outputDir, 'run-export.jsonl'),
        await fetchJsonlExport(input.request, input.handles.runId),
        'utf-8'
      );
    } catch (err) {
      await fs.writeFile(path.join(outputDir, 'jsonl-fetch-error.txt'), String(err), 'utf-8');
    }
  }

  if (input.workspacePath) {
    try {
      const diff = execFileSync('git', ['diff', 'HEAD', '--', '.'], {
        cwd: input.workspacePath,
      }).toString('utf-8');
      const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard'], {
        cwd: input.workspacePath,
      })
        .toString('utf-8')
        .trim();
      await fs.writeFile(path.join(outputDir, 'workspace.diff'), diff, 'utf-8');
      await fs.writeFile(path.join(outputDir, 'workspace-untracked.txt'), untracked, 'utf-8');
    } catch (err) {
      await fs.writeFile(path.join(outputDir, 'workspace-diff-error.txt'), String(err), 'utf-8');
    }
  }

  try {
    const traceLog = path.resolve('logs/supervisor-trace.log');
    const content = await fs.readFile(traceLog, 'utf-8');
    const runId = input.handles.runId;
    const related = runId
      ? content
          .split('\n')
          .filter((line) => line.includes(runId))
          .join('\n')
      : content.split('\n').slice(-200).join('\n');
    await fs.writeFile(path.join(outputDir, 'supervisor-trace.log'), related, 'utf-8');
  } catch {
    // Trace log is optional.
  }

  return outputDir;
}
