import fs from 'node:fs';
import path from 'node:path';

export type ProjectQualityPrerequisiteName = 'verify' | 'test:coverage';

export type ProjectQualityPrerequisite = {
  name: ProjectQualityPrerequisiteName;
  present: boolean;
  command?: string;
};

export type ProjectQualityPrerequisiteResult = {
  packageJsonPath: string;
  packageJsonPresent: boolean;
  ready: boolean;
  prerequisites: ProjectQualityPrerequisite[];
};

const requiredScripts: ProjectQualityPrerequisiteName[] = ['verify', 'test:coverage'];

export function inspectProjectQualityPrerequisites(
  repoRoot: string
): ProjectQualityPrerequisiteResult {
  const packageJsonPath = path.join(path.resolve(repoRoot), 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    return {
      packageJsonPath,
      packageJsonPresent: false,
      ready: false,
      prerequisites: requiredScripts.map((name) => ({ name, present: false })),
    };
  }

  const parsed = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
    scripts?: Record<string, unknown>;
  };
  const scripts = parsed.scripts || {};
  const prerequisites = requiredScripts.map((name) => {
    const command = scripts[name];
    return {
      name,
      present: typeof command === 'string' && command.trim().length > 0,
      ...(typeof command === 'string' ? { command } : {}),
    };
  });

  return {
    packageJsonPath,
    packageJsonPresent: true,
    ready: prerequisites.every((script) => script.present),
    prerequisites,
  };
}
