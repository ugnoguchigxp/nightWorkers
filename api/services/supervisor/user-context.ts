import { describeArtifactContextRef, type SupervisorArtifactContextRef } from './artifact-contract';
import type { JobType } from './prompt';

export type Round2UserContextInput = {
  latestUserMessage: string;
  goal: string;
  currentJobType: JobType;
  workflow: string | null;
  safetyPolicy: unknown | null;
  todoPlan: unknown[];
  currentTodo: unknown | null;
  toolResults: unknown[];
  loadedProcedureSummaries: unknown[];
  artifactContextRefs: SupervisorArtifactContextRef[];
};

export function renderRound2UserContext(input: Round2UserContextInput) {
  return [
    '[Latest User Request]',
    input.latestUserMessage,
    '',
    '[Goal]',
    input.goal,
    '',
    '[Continuity Context]',
    JSON.stringify(
      {
        workflow: input.workflow,
        currentJobType: input.currentJobType,
      },
      null,
      2
    ),
    '',
    '[Current Execution State]',
    JSON.stringify(
      {
        todoPlan: input.todoPlan,
        currentTodo: input.currentTodo,
      },
      null,
      2
    ),
    '',
    '[Recent Tool Evidence]',
    JSON.stringify(input.toolResults, null, 2),
    '',
    '[Loaded Procedure Summaries]',
    JSON.stringify(input.loadedProcedureSummaries, null, 2),
    '',
    '[Artifact and Source References]',
    input.artifactContextRefs.length
      ? input.artifactContextRefs.map(describeArtifactContextRef).join('\n')
      : 'none',
    '',
    '[Safety Context]',
    JSON.stringify(input.safetyPolicy, null, 2),
  ].join('\n');
}

export function extractRound2UserContextSection(text: string, section: string) {
  const marker = `[${section}]`;
  const start = text.indexOf(marker);
  if (start < 0) return null;
  const bodyStart = start + marker.length;
  const next = text.slice(bodyStart).search(round2SectionBoundaryPattern(section));
  return (next < 0 ? text.slice(bodyStart) : text.slice(bodyStart, bodyStart + next)).trim();
}

export function parseRound2UserContextJsonSection<T = unknown>(text: string, section: string): T {
  const value = extractRound2UserContextSection(text, section);
  if (value === null) throw new Error(`Round2 user context section not found: ${section}`);
  return JSON.parse(value) as T;
}

function round2SectionBoundaryPattern(currentSection: string) {
  const sections = [
    'Latest User Request',
    'Goal',
    'Continuity Context',
    'Current Execution State',
    'Recent Tool Evidence',
    'Loaded Procedure Summaries',
    'Artifact and Source References',
    'Safety Context',
  ].filter((section) => section !== currentSection);
  return new RegExp(
    `\\n(?:${sections.map((section) => `\\[${escapeRegExp(section)}\\]`).join('|')})\\n`
  );
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
