import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { defaultFlatSkillDirectory, type JobType, jobTypeDescriptions, jobTypes } from './prompt';

export type LoadedSkillSummary = {
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

export type SkillSearchMatch = {
  jobType: JobType;
  path: string;
  score: number;
  summary: string;
};

export function readSupervisorSkill(input: {
  jobType: JobType;
  loadedAtStep: number;
  directory?: string;
}): LoadedSkillSummary {
  const directory = input.directory || defaultFlatSkillDirectory();
  const filePath = path.join(directory, `${input.jobType}.md`);
  const markdown = fs.readFileSync(filePath, 'utf8');
  return {
    jobType: input.jobType,
    path: skillDisplayPath(input.jobType),
    digest: `sha256:${crypto.createHash('sha256').update(markdown).digest('hex')}`,
    summary: summarizeSkillMarkdown(markdown),
    loadedAtStep: input.loadedAtStep,
  };
}

export function searchSupervisorSkills(input: {
  query: string;
  maxResults?: number;
  directory?: string;
}): { matches: SkillSearchMatch[] } {
  const directory = input.directory || defaultFlatSkillDirectory();
  const terms = input.query
    .toLowerCase()
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean);
  const maxResults = Math.max(1, Math.min(input.maxResults ?? 5, 20));

  const matches = jobTypes
    .map((jobType) => {
      const markdown = readSkillMarkdownIfPresent(directory, jobType);
      if (!markdown) return null;
      const summary = summarizeSkillMarkdown(markdown).useWhen || jobTypeDescriptions[jobType];
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
        path: skillDisplayPath(jobType),
        score,
        summary,
      };
    })
    .filter((match): match is SkillSearchMatch => Boolean(match))
    .sort((a, b) => b.score - a.score || a.jobType.localeCompare(b.jobType))
    .slice(0, maxResults);

  return { matches };
}

function readSkillMarkdownIfPresent(directory: string, jobType: JobType): string | null {
  const filePath = path.join(directory, `${jobType}.md`);
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, 'utf8');
}

function summarizeSkillMarkdown(markdown: string): LoadedSkillSummary['summary'] {
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

function skillDisplayPath(jobType: JobType): string {
  return `skills/${jobType}.md`;
}
