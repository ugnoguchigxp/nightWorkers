import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildTaskGenerationEvidence } from '../../modules/project-detail/task-generation-evidence.service';

type AgentOntologyCore = {
  listModules: (repoRoot?: string) => unknown;
  readManifestById: (repoRoot: string | undefined, moduleId: string) => unknown;
  classifyGoal: (input: Record<string, unknown>) => unknown;
  compileModuleContext: (input: Record<string, unknown>) => unknown;
  checkBoundary: (input: Record<string, unknown>) => unknown;
  getVerificationPlan: (input: Record<string, unknown>) => unknown;
};

async function loadCore(): Promise<AgentOntologyCore> {
  const coreModuleUrl = pathToFileURL(
    path.join(defaultOntologyRepoRoot(), 'scripts/agent-ontology/core.mjs')
  ).href;
  return (await import(coreModuleUrl)) as AgentOntologyCore;
}

export function defaultOntologyRepoRoot() {
  return path.resolve(process.cwd());
}

export async function listOntologyModules(input: { repoPath?: string } = {}) {
  const core = await loadCore();
  return core.listModules(input.repoPath || defaultOntologyRepoRoot());
}

export async function getModuleOntology(input: { repoPath?: string; module: string }) {
  const core = await loadCore();
  return core.readManifestById(input.repoPath || defaultOntologyRepoRoot(), input.module);
}

export async function classifyOntologyGoal(input: { repoPath?: string; goal: string }) {
  const core = await loadCore();
  return core.classifyGoal({
    repoRoot: input.repoPath || defaultOntologyRepoRoot(),
    goal: input.goal,
  });
}

export async function compileOntologyModuleContext(input: {
  repoPath?: string;
  goal: string;
  primaryModule?: string;
  secondaryModules?: string[];
  taskGenerationEvidence?: unknown;
  repositoryId?: string;
  missionId?: string;
  taskCandidateId?: string;
  taskId?: string;
  memoryEvidence?: unknown;
  summaryType?: string;
}) {
  const core = await loadCore();
  const repoPath = input.repoPath || defaultOntologyRepoRoot();
  const taskGenerationEvidence =
    input.taskGenerationEvidence ??
    (input.repositoryId || input.taskCandidateId || input.missionId || input.taskId
      ? await buildTaskGenerationEvidence({
          repoPath,
          repositoryId: input.repositoryId,
          missionId: input.missionId,
          taskCandidateId: input.taskCandidateId,
          taskId: input.taskId,
        })
      : undefined);
  return core.compileModuleContext({
    repoRoot: repoPath,
    goal: input.goal,
    primaryModule: input.primaryModule,
    secondaryModules: input.secondaryModules,
    taskGenerationEvidence,
    memoryEvidence: input.memoryEvidence,
    summaryType: input.summaryType,
  });
}

export async function checkOntologyBoundary(input: {
  repoPath?: string;
  primaryModule: string;
  secondaryModules?: string[];
  plannedFiles?: string[];
}) {
  const core = await loadCore();
  return core.checkBoundary({
    repoRoot: input.repoPath || defaultOntologyRepoRoot(),
    primaryModule: input.primaryModule,
    secondaryModules: input.secondaryModules,
    plannedFiles: input.plannedFiles,
  });
}

export async function getOntologyVerificationPlan(input: {
  repoPath?: string;
  primaryModule: string;
  secondaryModules?: string[];
}) {
  const core = await loadCore();
  return core.getVerificationPlan({
    repoRoot: input.repoPath || defaultOntologyRepoRoot(),
    primaryModule: input.primaryModule,
    secondaryModules: input.secondaryModules,
  });
}
