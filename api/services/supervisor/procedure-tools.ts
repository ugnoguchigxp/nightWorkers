import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  defaultFlatProcedureDirectory,
  type JobType,
  jobTypeDescriptions,
  jobTypes,
} from './prompt';

export type LoadedProcedureSummary = {
  jobType: JobType;
  path: string;
  digest: string;
  summary: {
    useWhen: string | null;
    procedure: string[];
    requiredRules: string[];
  };
  loadedAtStep: number;
};

export type ProcedureSearchMatch = {
  jobType: JobType;
  path: string;
  score: number;
  summary: string;
};

export function readSupervisorProcedure(input: {
  jobType: JobType;
  loadedAtStep: number;
  directory?: string;
}): LoadedProcedureSummary {
  const directory = input.directory || defaultFlatProcedureDirectory();
  const filePath = path.join(directory, `${input.jobType}.md`);
  const markdown = fs.readFileSync(filePath, 'utf8');
  return {
    jobType: input.jobType,
    path: procedureDisplayPath(input.jobType),
    digest: `sha256:${crypto.createHash('sha256').update(markdown).digest('hex')}`,
    summary: summarizeProcedureMarkdown(markdown),
    loadedAtStep: input.loadedAtStep,
  };
}

export function searchSupervisorProcedures(input: {
  query: string;
  maxResults?: number;
  directory?: string;
}): { matches: ProcedureSearchMatch[] } {
  const directory = input.directory || defaultFlatProcedureDirectory();
  const terms = input.query
    .toLowerCase()
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean);
  const maxResults = Math.max(1, Math.min(input.maxResults ?? 5, 20));

  const matches = jobTypes
    .map((jobType) => {
      const markdown = readProcedureMarkdownIfPresent(directory, jobType);
      if (!markdown) return null;
      const summary = summarizeProcedureMarkdown(markdown).useWhen || jobTypeDescriptions[jobType];
      const haystack = [jobType, jobTypeDescriptions[jobType], summary, markdown]
        .join('\n')
        .toLowerCase();
      const score =
        terms.length === 0
          ? 1
          : terms.reduce((total, term) => total + (haystack.includes(term) ? 1 : 0), 0);
      if (score <= 0) return null;
      return {
        jobType,
        path: procedureDisplayPath(jobType),
        score,
        summary,
      };
    })
    .filter((match): match is ProcedureSearchMatch => Boolean(match))
    .sort((a, b) => b.score - a.score || a.jobType.localeCompare(b.jobType))
    .slice(0, maxResults);

  return { matches };
}

function readProcedureMarkdownIfPresent(directory: string, jobType: JobType): string | null {
  const filePath = path.join(directory, `${jobType}.md`);
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, 'utf8');
}

function summarizeProcedureMarkdown(markdown: string): LoadedProcedureSummary['summary'] {
  return {
    useWhen: firstParagraph(section(markdown, 'Use When')),
    procedure: listItems(section(markdown, 'Procedure')),
    requiredRules: [
      ...listItems(section(markdown, 'Completion')),
      ...listItems(section(markdown, 'Output')),
    ],
  };
}

function section(markdown: string, heading: string): string {
  const lines = markdown.split('\n');
  const start = lines.findIndex(
    (line) => line.trim().toLowerCase() === `## ${heading.toLowerCase()}`
  );
  if (start < 0) return '';
  const end = lines.findIndex((line, index) => index > start && line.startsWith('## '));
  return lines
    .slice(start + 1, end < 0 ? undefined : end)
    .join('\n')
    .trim();
}

function firstParagraph(text: string): string | null {
  const paragraph = text
    .split(/\n\s*\n/)
    .map((item) => item.trim())
    .find(Boolean);
  return paragraph || null;
}

function listItems(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .map((line) => line.replace(/^[-*]\s+/, '').replace(/^\d+[.)]\s+/, ''))
    .filter(Boolean);
}

function procedureDisplayPath(jobType: JobType): string {
  return `procedures/${jobType}.md`;
}
