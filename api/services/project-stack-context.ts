import fs from 'node:fs';
import path from 'node:path';
import type {
  ProjectStackProfile,
  ProjectStackTechnology,
} from '../../shared/schemas/project-detail.schema';

function readPackageJson(repoRoot: string): Record<string, unknown> | null {
  const packageJsonPath = path.join(repoRoot, 'package.json');
  if (!fs.existsSync(packageJsonPath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function stringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  );
}

function readPackageDependencies(
  packageJson: Record<string, unknown> | null
): Record<string, string> {
  const entries = [
    ...Object.entries(stringRecord(packageJson?.dependencies)),
    ...Object.entries(stringRecord(packageJson?.devDependencies)),
  ];
  return Object.fromEntries(entries);
}

export function detectProjectStackProfile(repoRoot: string): ProjectStackProfile {
  const manifestPath = path.join(repoRoot, 'package.json');
  const manifestExists = fs.existsSync(manifestPath);
  const packageJson = readPackageJson(repoRoot);
  const manifestStatus = packageJson ? 'found' : manifestExists ? 'parse_failed' : 'missing';
  const dependencies = readPackageDependencies(packageJson);
  const lockfiles = [
    'bun.lock',
    'bun.lockb',
    'pnpm-lock.yaml',
    'yarn.lock',
    'package-lock.json',
  ].filter((file) => fs.existsSync(path.join(repoRoot, file)));
  const packageManager =
    typeof packageJson?.packageManager === 'string'
      ? packageJson.packageManager
      : lockfiles.includes('bun.lock') || lockfiles.includes('bun.lockb')
        ? 'bun'
        : lockfiles.includes('pnpm-lock.yaml')
          ? 'pnpm'
          : lockfiles.includes('yarn.lock')
            ? 'yarn'
            : lockfiles.includes('package-lock.json')
              ? 'npm'
              : null;
  const technologies: ProjectStackTechnology[] = [];
  const addDependencyTechnology = (
    name: string,
    category: ProjectStackTechnology['category'],
    packageNames: string[]
  ) => {
    const packageName = packageNames.find((candidate) => dependencies[candidate]);
    if (!packageName) return;
    technologies.push({
      name,
      category,
      packageName,
      version: dependencies[packageName] ?? null,
      source: 'package_json',
      confidence: 'high',
    });
  };

  if (dependencies.typescript || fs.existsSync(path.join(repoRoot, 'tsconfig.json'))) {
    technologies.push({
      name: 'TypeScript',
      category: 'language',
      packageName: dependencies.typescript ? 'typescript' : null,
      version: dependencies.typescript ?? null,
      source: dependencies.typescript ? 'package_json' : 'file',
      confidence: dependencies.typescript ? 'high' : 'medium',
    });
  }
  addDependencyTechnology('React', 'frontend', ['react']);
  addDependencyTechnology('Next.js', 'frontend', ['next']);
  addDependencyTechnology('Vite', 'tooling', ['vite']);
  addDependencyTechnology('Hono', 'backend', ['hono']);
  addDependencyTechnology('SQLite', 'database', ['better-sqlite3', '@libsql/client']);
  addDependencyTechnology('Drizzle ORM', 'orm', ['drizzle-orm']);
  addDependencyTechnology('i18next', 'tooling', ['react-i18next', 'i18next']);
  addDependencyTechnology('Tailwind CSS', 'frontend', [
    'tailwindcss',
    '@tailwindcss/vite',
    '@tailwindcss/cli',
  ]);
  addDependencyTechnology('Vitest', 'testing', ['vitest']);
  addDependencyTechnology('Playwright', 'testing', ['@playwright/test']);
  addDependencyTechnology('Tauri', 'desktop', ['@tauri-apps/api', '@tauri-apps/cli']);
  if (fs.existsSync(path.join(repoRoot, 'components.json'))) {
    technologies.push({
      name: 'shadcn/ui',
      category: 'frontend',
      packageName: null,
      version: null,
      source: 'file',
      confidence: 'medium',
    });
  }
  if (packageManager) {
    technologies.push({
      name: packageManager.split('@')[0] || packageManager,
      category: 'runtime',
      packageName: null,
      version: packageManager.includes('@') ? packageManager.split('@').slice(1).join('@') : null,
      source: typeof packageJson?.packageManager === 'string' ? 'package_json' : 'lockfile',
      confidence: 'medium',
    });
  }

  const summaryNames = ['TypeScript', 'React', 'Vite', 'Hono'].filter((name) =>
    technologies.some((technology) => technology.name === name)
  );
  const fallbackNames = technologies
    .filter((technology) => technology.category !== 'runtime')
    .map((technology) => technology.name)
    .slice(0, 4);
  const summary = (summaryNames.length > 0 ? summaryNames : fallbackNames).join(' + ');

  return {
    summary,
    manifestStatus,
    manifestPath,
    packageManager,
    technologies,
  };
}

export function renderProjectStackContext(profile: ProjectStackProfile | null): string {
  if (!profile || profile.manifestStatus !== 'found' || profile.technologies.length === 0) {
    return [
      '- Project stack は未検出です。',
      '- 技術スタックやテンプレートが context から確定できない場合だけ、ユーザーに確認してください。',
    ].join('\n');
  }
  const technologies = profile.technologies
    .filter((technology) => technology.category !== 'runtime')
    .slice(0, 10)
    .map(
      (technology) =>
        `- ${technology.name}: ${technology.category}, source=${technology.source}, confidence=${technology.confidence}`
    );
  return [
    `- 既存 Project stack: ${profile.summary || '未検出'}`,
    profile.packageManager ? `- Package manager: ${profile.packageManager}` : null,
    '- この stack は既存コードベースの前提です。ユーザーが変更を明示しない限り、別 stack / starter template 選択を質問しないでください。',
    '- 依存関係の全量ではなく、生成判断に必要な主要技術だけを示しています。',
    ...technologies,
  ]
    .filter(Boolean)
    .join('\n');
}
