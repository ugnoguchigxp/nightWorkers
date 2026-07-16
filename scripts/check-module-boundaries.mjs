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
			/^(api|src|shared)\/modules\/([^/]+)(?:\/(.*))?$/,
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

function containingConfiguredRoot(relativePath, configuredRoots) {
	for (const root of configuredRoots) {
		if (relativePath === root || relativePath.startsWith(`${root}/`)) {
			return root;
		}
	}
	return null;
}

function roleNameForRoot(root) {
	if (!root) return null;
	return path.posix.basename(root);
}

function startsWithConfiguredPrefix(relativePath, prefixes) {
	return prefixes.some(
		(prefix) =>
			relativePath === prefix.replace(/\/$/, "") ||
			relativePath.startsWith(prefix),
	);
}

export function evaluateModuleBoundaries(repoRoot = process.cwd()) {
  const policyPath = path.join(repoRoot, '.agent-ontology/boundary-policy.json');
  const policy = JSON.parse(fs.readFileSync(policyPath, 'utf8'));
  const errors = [];
  const enforcedRoots = new Set(policy.enforcedPublicApiRoots ?? []);
  const roleModuleRoots = new Set(policy.roleModuleRoots ?? []);
  const agentSharedModuleRoots = new Set(
		policy.agentSharedModuleRoots ?? [],
	);
  const roleOwnedPathRules = policy.roleOwnedPathRules ?? [];
  const forbiddenProductionPathPrefixes =
		policy.forbiddenProductionPathPrefixes ?? [];
  const forbiddenImports = policy.domainForbiddenImports ?? [];
  const files = [
    ...walk(path.join(repoRoot, 'api')),
    ...walk(path.join(repoRoot, 'src')),
    ...walk(path.join(repoRoot, 'shared')),
  ];

  if (policy.version !== 1) errors.push('boundary policy version must be 1');

  for (const absolutePath of files) {
    const relativePath = path.relative(repoRoot, absolutePath).replaceAll(path.sep, '/');
    const source = fs.readFileSync(absolutePath, 'utf8');
    const imports = ts.preProcessFile(source, true, true).importedFiles.map(
      (entry) => entry.fileName,
    );

		if (
			startsWithConfiguredPrefix(
				relativePath,
				forbiddenProductionPathPrefixes,
			)
		) {
			errors.push(
				`${relativePath}: production code is forbidden under a retired path`,
			);
		}
		for (const rule of roleOwnedPathRules) {
			const hasRoleMarker = (rule.markers ?? []).some((marker) =>
				relativePath.includes(marker),
			);
			if (!hasRoleMarker) continue;
			if (
				startsWithConfiguredPrefix(
					relativePath,
					rule.exemptPrefixes ?? [],
				)
			) {
				continue;
			}
			const ownedByRole = (rule.allowedRoots ?? []).some(
				(root) =>
					relativePath === root ||
					relativePath.startsWith(`${root}/`),
			);
			if (!ownedByRole) {
				errors.push(
					`${relativePath}: ${rule.role} production code must live under its role module`,
				);
			}
		}

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
			const sourceRoleRoot = containingConfiguredRoot(
				relativePath,
				roleModuleRoots,
			);
			const targetRoleRoot = target
				? containingConfiguredRoot(target.root, roleModuleRoots)
				: null;
			const sourceRoleName = roleNameForRoot(sourceRoleRoot);
			const targetRoleName = roleNameForRoot(targetRoleRoot);
			const sourceAgentSharedRoot = containingConfiguredRoot(
				relativePath,
				agentSharedModuleRoots,
			);
			if (
				sourceRoleRoot &&
				targetRoleRoot &&
				sourceRoleName !== targetRoleName
			) {
				errors.push(
					`${relativePath}: direct import between role modules is forbidden (${sourceRoleRoot} -> ${targetRoleRoot}: ${specifier})`,
				);
			}
			if (sourceAgentSharedRoot && targetRoleRoot) {
				errors.push(
					`${relativePath}: agentsShare must not depend on a role module (${sourceAgentSharedRoot} -> ${targetRoleRoot}: ${specifier})`,
				);
			}
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
