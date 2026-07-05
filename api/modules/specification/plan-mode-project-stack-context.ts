import fs from 'node:fs';
import path from 'node:path';
import {
  detectProjectStackProfile,
  renderProjectStackContext,
} from '../../services/project-stack-context';
import * as nightworkersRepo from '../nightworkers/nightworkers.repository';

export async function resolvePlanModeProjectStackContext(repositoryId: string) {
  const repository = await nightworkersRepo.getRepository(repositoryId);
  if (!repository) return renderProjectStackContext(null);
  return [
    'Target Project Context',
    `- Project name: ${repository.name}`,
    `- Project root: ${repository.localPath}`,
    '',
    renderProjectStackContext(detectProjectStackProfile(repository.localPath)),
    '',
    renderPackageScriptsContext(repository.localPath),
  ].join('\n');
}

function renderPackageScriptsContext(repoRoot: string) {
  const scripts = readPackageScripts(repoRoot);
  if (scripts.length === 0) {
    return [
      'Project package scripts:',
      '- package.json scripts は未検出です。検証 command は推測で作らず、既存 tooling から確認してください。',
    ].join('\n');
  }
  const preferredOrder = [
    'verify',
    'verify:base',
    'verify:fast',
    'typecheck',
    'lint',
    'test',
    'test:unit',
    'test:e2e',
    'build',
  ];
  const scriptByName = new Map(scripts);
  const ordered = [
    ...preferredOrder.filter((name) => scriptByName.has(name)),
    ...scripts
      .map(([name]) => name)
      .filter((name) => !preferredOrder.includes(name))
      .slice(0, 10),
  ];
  return [
    'Project package scripts:',
    ...ordered.map((name) => `- ${name}: ${scriptByName.get(name)}`),
    '- Feature Plan の検証コマンドは、上記に存在する script 名だけを使ってください。存在しない script は推測しないでください。',
  ].join('\n');
}

function readPackageScripts(repoRoot: string): Array<[string, string]> {
  const packageJsonPath = path.join(repoRoot, 'package.json');
  if (!fs.existsSync(packageJsonPath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
    const scripts = (parsed as Record<string, unknown>).scripts;
    if (!scripts || typeof scripts !== 'object' || Array.isArray(scripts)) return [];
    return Object.entries(scripts).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string'
    );
  } catch {
    return [];
  }
}
