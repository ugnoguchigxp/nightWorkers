import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import ts from '@typescript/typescript6';

const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return walk(target);
    return sourceExtensions.has(path.extname(entry.name)) ? [target] : [];
  });
}

function isDomainFile(relativePath) {
  return /^api\/modules\/[^/]+\/domain\//.test(relativePath);
}

function matchesForbiddenImport(specifier, forbidden) {
  return forbidden.some(
    (item) => specifier === item || specifier.startsWith(`${item}/`),
  );
}

function targetRootForImport(specifier, sourcePath) {
  const frontend = specifier.match(/^@\/modules\/([^/]+)(?:\/(.*))?$/);
  if (frontend) {
    return { root: `src/modules/${frontend[1]}`, remainder: frontend[2] ?? '' };
  }
  const backend = specifier.match(/^@api\/modules\/([^/]+)(?:\/(.*))?$/);
	if (backend) {
    return { root: `api/modules/${backend[1]}`, remainder: backend[2] ?? '' };
	}
	if (specifier.startsWith(".")) {
		const resolved = path.posix.normalize(
			path.posix.join(path.posix.dirname(sourcePath), specifier),
		);
		const local = resolved.match(
			/^(api|src)\/modules\/([^/]+)(?:\/(.*))?$/,
		);
		if (local) {
			return {
				root: `${local[1]}/modules/${local[2]}`,
				remainder: local[3] ?? "",
			};
		}
	}
	return null;
}

export function evaluateModuleBoundaries(repoRoot = process.cwd()) {
  const policyPath = path.join(repoRoot, '.agent-ontology/boundary-policy.json');
  const policy = JSON.parse(fs.readFileSync(policyPath, 'utf8'));
  const errors = [];
  const enforcedRoots = new Set(policy.enforcedPublicApiRoots ?? []);
  const forbiddenImports = policy.domainForbiddenImports ?? [];
  const files = [...walk(path.join(repoRoot, 'api')), ...walk(path.join(repoRoot, 'src'))];

  if (policy.version !== 1) errors.push('boundary policy version must be 1');

  for (const absolutePath of files) {
    const relativePath = path.relative(repoRoot, absolutePath).replaceAll(path.sep, '/');
    const source = fs.readFileSync(absolutePath, 'utf8');
    const imports = ts.preProcessFile(source, true, true).importedFiles.map(
      (entry) => entry.fileName,
    );

    if (isDomainFile(relativePath)) {
      for (const specifier of imports) {
        if (matchesForbiddenImport(specifier, forbiddenImports)) {
          errors.push(`${relativePath}: domain layer imports forbidden package ${specifier}`);
        }
        if (/\/(application|infrastructure|presentation)(?:\/|$)/.test(specifier)) {
          errors.push(`${relativePath}: domain layer imports outer layer ${specifier}`);
        }
      }
    }

    for (const specifier of imports) {
			const target = targetRootForImport(specifier, relativePath);
      if (!target || !enforcedRoots.has(target.root)) continue;
      if (relativePath === `${target.root}/index.ts`) continue;
      if (relativePath.startsWith(`${target.root}/`)) continue;
      if (target.remainder) {
        errors.push(
          `${relativePath}: deep import into ${target.root} is forbidden (${specifier})`,
        );
      }
    }
  }

  return { ok: errors.length === 0, checkedFiles: files.length, errors };
}

function main() {
  const result = evaluateModuleBoundaries(process.cwd());
  if (!result.ok) {
    console.error('[architecture] module boundary check failed');
    for (const error of result.errors) console.error(`- ${error}`);
    process.exit(1);
  }
  console.log(`[architecture] module boundaries checked across ${result.checkedFiles} files`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
