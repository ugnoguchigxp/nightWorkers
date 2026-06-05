import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getResourceRoot } from '../../runtime/paths';
import type { TaskType } from '../task-intake';
import { taskTypes } from '../task-intake/types';
import type { ProcedureDefinition, ProcedureSectionName, ProcedureSnapshot } from './types';

const allowedSections: ProcedureSectionName[] = [
  'Use When',
  'Workflow',
  'Completion Gate',
  'Verification Strategy',
  'Report Contract',
];

const defaultBuiltinDirectory = path.join(getResourceRoot(), 'api/services/procedures/builtin');

let cachedProcedures: ProcedureDefinition[] | null = null;

export async function listBuiltinProcedures(
  directory = defaultBuiltinDirectory
): Promise<ProcedureDefinition[]> {
  if (directory === defaultBuiltinDirectory && cachedProcedures) return cachedProcedures;
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const markdownFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => entry.name)
    .sort();
  const procedures = await Promise.all(
    markdownFiles.map(async (fileName) => {
      const raw = await fs.readFile(path.join(directory, fileName), 'utf8');
      return parseProcedureMarkdown(raw);
    })
  );
  const sorted = procedures.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  if (directory === defaultBuiltinDirectory) cachedProcedures = sorted;
  return sorted;
}

export async function selectProcedureForTaskType(
  taskType: TaskType | string,
  directory = defaultBuiltinDirectory
): Promise<ProcedureDefinition> {
  const procedures = await listBuiltinProcedures(directory);
  const normalizedTaskType = isTaskType(taskType) ? taskType : 'investigation';
  return (
    procedures.find((procedure) => procedure.taskTypes.includes(normalizedTaskType)) ||
    procedures.find((procedure) => procedure.taskTypes.includes('investigation')) ||
    procedures[0]
  );
}

export function toProcedureSnapshot(procedure: ProcedureDefinition): ProcedureSnapshot {
  return {
    source: procedure.source,
    id: procedure.id,
    title: procedure.title,
    version: procedure.version,
    digest: procedure.digest,
    sections: procedure.sections,
  };
}

export function parseProcedureMarkdown(raw: string): ProcedureDefinition {
  const { frontmatter, body } = splitFrontmatter(raw);
  const id = requireFrontmatterString(frontmatter, 'id');
  const taskTypeValues = requireFrontmatterList(frontmatter, 'taskTypes');
  const parsedTaskTypes = taskTypeValues.filter(isTaskType);
  if (parsedTaskTypes.length === 0) {
    throw new Error(`Procedure ${id} must declare at least one valid taskType.`);
  }
  const priority = Number.parseInt(frontmatter.priority || '0', 10) || 0;
  const title = extractTitle(body) || id;
  const sections = extractSections(body);
  const digest = digestProcedure({
    id,
    title,
    taskTypes: parsedTaskTypes,
    priority,
    sections,
  });
  return {
    id,
    title,
    taskTypes: parsedTaskTypes,
    priority,
    source: 'builtin',
    version: 1,
    digest,
    sections,
  };
}

function splitFrontmatter(raw: string): { frontmatter: Record<string, string>; body: string } {
  const normalized = raw.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) {
    throw new Error('Procedure markdown must start with frontmatter.');
  }
  const end = normalized.indexOf('\n---\n', 4);
  if (end < 0) throw new Error('Procedure markdown frontmatter is not closed.');
  const frontmatterText = normalized.slice(4, end).trim();
  const body = normalized.slice(end + '\n---\n'.length).trim();
  const frontmatter: Record<string, string> = {};
  for (const line of frontmatterText.split('\n')) {
    const separator = line.indexOf(':');
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    frontmatter[key] = value;
  }
  return { frontmatter, body };
}

function requireFrontmatterString(frontmatter: Record<string, string>, key: string): string {
  const value = frontmatter[key]?.trim();
  if (!value) throw new Error(`Procedure frontmatter missing ${key}.`);
  return value;
}

function requireFrontmatterList(frontmatter: Record<string, string>, key: string): string[] {
  const value = requireFrontmatterString(frontmatter, key);
  const inlineList = value.match(/^\[(.*)\]$/)?.[1];
  const rawItems = inlineList ? inlineList.split(',') : value.split(',');
  return rawItems.map((item) => item.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
}

function extractTitle(body: string): string | null {
  const match = body.match(/^#\s+(.+)$/m);
  return match?.[1]?.trim() || null;
}

function extractSections(body: string): Record<ProcedureSectionName, string> {
  const sections = Object.fromEntries(allowedSections.map((section) => [section, ''])) as Record<
    ProcedureSectionName,
    string
  >;
  const headingPattern = /^##\s+(.+)$/gm;
  const headings: Array<{ name: string; index: number; contentStart: number }> = [];
  let match = headingPattern.exec(body);
  while (match) {
    headings.push({
      name: match[1].trim(),
      index: match.index,
      contentStart: headingPattern.lastIndex,
    });
    match = headingPattern.exec(body);
  }
  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index];
    if (!isAllowedSection(heading.name)) continue;
    const nextHeading = headings[index + 1];
    sections[heading.name] = body
      .slice(heading.contentStart, nextHeading?.index ?? body.length)
      .trim();
  }
  for (const section of allowedSections) {
    if (!sections[section]) throw new Error(`Procedure missing section: ${section}.`);
  }
  return sections;
}

function digestProcedure(value: {
  id: string;
  title: string;
  taskTypes: TaskType[];
  priority: number;
  sections: Record<ProcedureSectionName, string>;
}): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex')}`;
}

function isTaskType(value: unknown): value is TaskType {
  return typeof value === 'string' && taskTypes.includes(value as TaskType);
}

function isAllowedSection(value: string): value is ProcedureSectionName {
  return allowedSections.includes(value as ProcedureSectionName);
}
