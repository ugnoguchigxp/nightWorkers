import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from '@typescript/typescript6';

export function analyzeImportCycles(repoRoot = process.cwd(), sourceFiles) {
  const files = sourceFiles ?? execFileSync(
    'git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { cwd: repoRoot, encoding: 'utf8' },
  ).split('\0').filter((file) =>
    /^(api|src|shared|packages)\/.*\.(ts|tsx)$/.test(file),
  );
  const fileSet = new Set(files.map((file) => path.resolve(repoRoot, file))
    .filter((file) => fs.existsSync(file)));
  const configPath = path.join(repoRoot, 'tsconfig.json');
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error) throw new Error(`Cannot read ${configPath}`);
  const { options, errors } = ts.parseJsonConfigFileContent(
    config.config, ts.sys, repoRoot, undefined, configPath,
  );
  if (errors.length) throw new Error(`Invalid compiler options in ${configPath}`);
  const cache = ts.createModuleResolutionCache(repoRoot, (file) => file, options);
  const graph = new Map();
  for (const file of fileSet) {
    const source = ts.createSourceFile(
      file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, false,
    );
    const edges = new Set();
    for (const node of source.statements) {
      if (!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) continue;
      if (!node.moduleSpecifier || !ts.isStringLiteral(node.moduleSpecifier)) continue;
      if (node.isTypeOnly || node.importClause?.isTypeOnly) continue;
      const bindings = node.importClause?.namedBindings ?? node.exportClause;
      if (bindings?.elements?.length && !node.importClause?.name &&
          bindings.elements.every((element) => element.isTypeOnly)) continue;
      const resolved = ts.resolveModuleName(
        node.moduleSpecifier.text, file, options, ts.sys, cache,
      ).resolvedModule?.resolvedFileName;
      if (resolved && fileSet.has(path.resolve(resolved))) edges.add(path.resolve(resolved));
    }
    graph.set(file, [...edges]);
  }
  const cycles = stronglyConnectedComponents(graph)
    .filter((group) => group.length > 1 || graph.get(group[0]).includes(group[0]))
    .map((group) => group.map((file) => path.relative(repoRoot, file).split(path.sep).join('/')).sort())
    .sort((left, right) => left[0].localeCompare(right[0]));
  return {
    checkedFiles: fileSet.size,
    cycles,
    edges: Object.fromEntries([...graph].map(([file, targets]) => [
      path.relative(repoRoot, file).split(path.sep).join('/'),
      targets.map((target) => path.relative(repoRoot, target).split(path.sep).join('/')),
    ])),
  };
}

function stronglyConnectedComponents(graph) {
  let nextIndex = 0;
  const indices = new Map();
  const lowLinks = new Map();
  const stack = [];
  const onStack = new Set();
  const groups = [];
  function visit(file) {
    indices.set(file, nextIndex);
    lowLinks.set(file, nextIndex++);
    stack.push(file);
    onStack.add(file);
    for (const target of graph.get(file)) {
      if (!indices.has(target)) {
        visit(target);
        lowLinks.set(file, Math.min(lowLinks.get(file), lowLinks.get(target)));
      } else if (onStack.has(target)) {
        lowLinks.set(file, Math.min(lowLinks.get(file), indices.get(target)));
      }
    }
    if (lowLinks.get(file) !== indices.get(file)) return;
    const group = [];
    let member;
    do {
      member = stack.pop();
      onStack.delete(member);
      group.push(member);
    } while (member !== file);
    groups.push(group);
  }
  for (const file of graph.keys()) if (!indices.has(file)) visit(file);
  return groups;
}

export function compareImportCycleBaseline(cycles, baseline) {
  if (baseline.version !== 1 || !Array.isArray(baseline.cycles)) {
    throw new Error('Import cycle baseline must have version 1 and a cycles array.');
  }
  const key = (group) => JSON.stringify([...group].sort());
  const actual = new Set(cycles.map(key));
  const expected = new Set(baseline.cycles.map(key));
  return [
    ...cycles.filter((group) => !expected.has(key(group)))
      .map((group) => `New or changed import cycle: ${group.join(', ')}`),
    ...baseline.cycles.filter((group) => !actual.has(key(group)))
      .map((group) => `Remove or update resolved import cycle baseline: ${group.join(', ')}`),
  ];
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const result = analyzeImportCycles();
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    const baseline = JSON.parse(fs.readFileSync('.agent-ontology/import-cycles.json', 'utf8'));
    const errors = compareImportCycleBaseline(result.cycles, baseline);
    if (errors.length) {
      for (const error of errors) console.error(`[architecture] ${error}`);
      process.exitCode = 1;
    } else {
      console.log(`[architecture] ${result.cycles.length} existing import cycles; no new or enlarged groups (${result.checkedFiles} files)`);
    }
  }
}
