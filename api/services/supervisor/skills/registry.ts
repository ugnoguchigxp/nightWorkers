import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  defaultSupervisorRoutingHypothesis,
  type SupervisorMode,
  type SupervisorOverlay,
  type SupervisorPhase,
  type SupervisorRoutingHypothesis,
  type SupervisorSkillDocument,
  type SupervisorSkillDocumentKind,
  type SupervisorSkillSectionName,
  type SupervisorWorkKind,
  supervisorModes,
  supervisorOverlays,
  supervisorPhases,
  supervisorWorkKinds,
} from './types';

const requiredSections: SupervisorSkillSectionName[] = [
  'Use When',
  'Required Behavior',
  'Stop Conditions',
  'Report Contract',
];

const optionalSections: SupervisorSkillSectionName[] = [
  'Tool Guidance',
  'Verification Guidance',
  'Risk Notes',
];

const allowedSections = [...requiredSections, ...optionalSections];

export const defaultSupervisorSkillsDirectory = path.join(
  process.cwd(),
  'api/services/supervisor/skills/builtin'
);

const cache = new Map<string, SupervisorSkillDocument[]>();

export function getSupervisorSkillsDirectory(directory?: string): string {
  return directory || process.env.SUPERVISOR_SKILLS_DIR || defaultSupervisorSkillsDirectory;
}

export function clearSupervisorSkillDocumentCache(): void {
  cache.clear();
}

export function listSupervisorSkillDocuments(directory?: string): SupervisorSkillDocument[] {
  const resolvedDirectory = getSupervisorSkillsDirectory(directory);
  const cached = cache.get(resolvedDirectory);
  if (cached) return cached;

  const source = resolvedDirectory === defaultSupervisorSkillsDirectory ? 'builtin' : 'configured';
  const documents = expectedSkillPaths().map((entry) => {
    const filePath = path.join(resolvedDirectory, entry.relativePath);
    if (!fs.existsSync(filePath)) {
      throw new Error(
        `Supervisor skill markdown missing: directory=${resolvedDirectory} relativePath=${entry.relativePath} axis=${entry.kind}`
      );
    }
    const raw = fs.readFileSync(filePath, 'utf8');
    return parseSupervisorSkillMarkdown(raw, {
      id: entry.id,
      kind: entry.kind,
      relativePath: entry.relativePath,
      source,
    });
  });
  cache.set(resolvedDirectory, documents);
  return documents;
}

export function resolveSupervisorSkillDocuments(
  routing: Partial<SupervisorRoutingHypothesis> | null | undefined,
  directory?: string
): SupervisorSkillDocument[] {
  const normalized = normalizeSupervisorRoutingHypothesis(routing);
  const documents = listSupervisorSkillDocuments(directory);
  const byPath = new Map(documents.map((document) => [document.relativePath, document]));
  const selectedPaths = new Set<string>([
    'SKILL.md',
    'references/router.md',
    `references/phases/${normalized.phase}.md`,
    `references/modes/${normalized.primaryMode}.md`,
    ...normalized.secondaryModes.map((mode) => `references/modes/${mode}.md`),
    ...normalized.workKinds.map((workKind) => `references/work_kinds/${workKind}.md`),
    ...normalized.overlays.map((overlay) => `references/overlays/${overlay}.md`),
  ]);
  for (const relativePath of normalized.nextSkillFiles) {
    if (byPath.has(relativePath)) selectedPaths.add(relativePath);
  }

  return [...selectedPaths].map((relativePath) => {
    const document = byPath.get(relativePath);
    if (!document) {
      throw new Error(`Supervisor skill reference is not allowed or missing: ${relativePath}`);
    }
    return document;
  });
}

export function renderSupervisorSkillDocuments(documents: SupervisorSkillDocument[]): string {
  return documents
    .map((document) => {
      const sections = allowedSections
        .filter((section) => document.sections[section])
        .map((section) => `## ${section}\n\n${document.sections[section]}`)
        .join('\n\n');
      return [
        `[Skill Document: ${document.relativePath}]`,
        `id=${document.id} kind=${document.kind} source=${document.source} digest=${document.digest}`,
        `# ${document.title}`,
        sections,
      ].join('\n');
    })
    .join('\n\n---\n\n');
}

export function summarizeSupervisorSkillDocuments(documents: SupervisorSkillDocument[]) {
  return documents.map((document) => ({
    id: document.id,
    kind: document.kind,
    source: document.source,
    relativePath: document.relativePath,
    digest: document.digest,
  }));
}

export function normalizeSupervisorRoutingHypothesis(
  value: Partial<SupervisorRoutingHypothesis> | null | undefined
): SupervisorRoutingHypothesis {
  const routing = value || {};
  const primaryMode = isSupervisorMode(routing.primaryMode)
    ? routing.primaryMode
    : defaultSupervisorRoutingHypothesis.primaryMode;
  const phase = isSupervisorPhase(routing.phase)
    ? routing.phase
    : defaultSupervisorRoutingHypothesis.phase;
  return {
    primaryMode,
    secondaryModes: normalizeArray(routing.secondaryModes).filter(isSupervisorMode),
    phase,
    workKinds: normalizeArray(routing.workKinds).filter(isSupervisorWorkKind),
    overlays: normalizeArray(routing.overlays).filter(isSupervisorOverlay),
    subtype:
      typeof routing.subtype === 'string' && routing.subtype.trim() ? routing.subtype : undefined,
    requiredEvidence: normalizeArray(routing.requiredEvidence),
    nextSkillFiles: normalizeArray(routing.nextSkillFiles),
    confidence:
      typeof routing.confidence === 'number' && Number.isFinite(routing.confidence)
        ? Math.max(0, Math.min(1, routing.confidence))
        : defaultSupervisorRoutingHypothesis.confidence,
  };
}

function parseSupervisorSkillMarkdown(
  raw: string,
  metadata: {
    id: string;
    kind: SupervisorSkillDocumentKind;
    relativePath: string;
    source: 'builtin' | 'configured';
  }
): SupervisorSkillDocument {
  const normalized = raw.replace(/\r\n/g, '\n').trim();
  const title = normalized.match(/^#\s+(.+)$/m)?.[1]?.trim() || titleFromId(metadata.id);
  const sections = extractSections(normalized, metadata.relativePath);
  const digestInput = {
    id: metadata.id,
    kind: metadata.kind,
    title,
    sections,
    raw: normalized,
  };
  return {
    id: metadata.id,
    kind: metadata.kind,
    title,
    version: 1,
    source: metadata.source,
    relativePath: metadata.relativePath,
    digest: `sha256:${createHash('sha256').update(JSON.stringify(digestInput), 'utf8').digest('hex')}`,
    sections,
  };
}

function extractSections(
  body: string,
  relativePath: string
): Partial<Record<SupervisorSkillSectionName, string>> {
  const sections: Partial<Record<SupervisorSkillSectionName, string>> = {};
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
  for (const section of requiredSections) {
    if (!sections[section]) {
      throw new Error(
        `Supervisor skill markdown missing section: ${section}. relativePath=${relativePath}`
      );
    }
  }
  return sections;
}

function expectedSkillPaths(): Array<{
  id: string;
  kind: SupervisorSkillDocumentKind;
  relativePath: string;
}> {
  return [
    { id: 'root', kind: 'root', relativePath: 'SKILL.md' },
    { id: 'router', kind: 'router', relativePath: 'references/router.md' },
    ...supervisorPhases.map((id) => ({
      id,
      kind: 'phase' as const,
      relativePath: `references/phases/${id}.md`,
    })),
    ...supervisorModes.map((id) => ({
      id,
      kind: 'mode' as const,
      relativePath: `references/modes/${id}.md`,
    })),
    ...supervisorWorkKinds.map((id) => ({
      id,
      kind: 'work_kind' as const,
      relativePath: `references/work_kinds/${id}.md`,
    })),
    ...supervisorOverlays.map((id) => ({
      id,
      kind: 'overlay' as const,
      relativePath: `references/overlays/${id}.md`,
    })),
  ];
}

function normalizeArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function isSupervisorPhase(value: unknown): value is SupervisorPhase {
  return typeof value === 'string' && supervisorPhases.includes(value as SupervisorPhase);
}

function isSupervisorMode(value: unknown): value is SupervisorMode {
  return typeof value === 'string' && supervisorModes.includes(value as SupervisorMode);
}

function isSupervisorWorkKind(value: unknown): value is SupervisorWorkKind {
  return typeof value === 'string' && supervisorWorkKinds.includes(value as SupervisorWorkKind);
}

function isSupervisorOverlay(value: unknown): value is SupervisorOverlay {
  return typeof value === 'string' && supervisorOverlays.includes(value as SupervisorOverlay);
}

function isAllowedSection(value: string): value is SupervisorSkillSectionName {
  return allowedSections.includes(value as SupervisorSkillSectionName);
}

function titleFromId(value: string): string {
  return value
    .split('_')
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(' ');
}
