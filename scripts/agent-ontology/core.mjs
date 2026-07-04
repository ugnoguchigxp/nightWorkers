import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const ONTOLOGY_DIR = '.agent-ontology';
export const MODULE_INDEX_PATH = path.join(ONTOLOGY_DIR, 'modules.yaml');

const REQUIRED_MANIFEST_FIELDS = [
  'version',
  'id',
  'summary',
  'ubiquitousLanguage',
  'responsibilities',
  'ownedPaths',
  'invariants',
  'forbiddenMutations',
  'verification',
];

export function resolveRepoRoot(input = {}) {
  return path.resolve(input.repoRoot || process.cwd());
}

export function hashText(text) {
  return `sha256:${crypto.createHash('sha256').update(text, 'utf8').digest('hex')}`;
}

export function readJsonCompatibleYaml(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  try {
    return { value: JSON.parse(raw), raw };
  } catch (error) {
    throw new Error(
      `${path.relative(process.cwd(), filePath)} must be JSON-compatible YAML for the initial ontology implementation: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export function readModuleIndex(repoRoot = process.cwd()) {
  const resolvedRoot = resolveRepoRoot({ repoRoot });
  const indexPath = path.join(resolvedRoot, MODULE_INDEX_PATH);
  const { value, raw } = readJsonCompatibleYaml(indexPath);
  const errors = validateModuleIndexShape(value);
  if (errors.length > 0) {
    const error = new Error(`Invalid module index: ${errors.join('; ')}`);
    error.validationErrors = errors;
    throw error;
  }
  return {
    repoRoot: resolvedRoot,
    indexPath,
    digest: hashText(raw),
    index: value,
  };
}

export function moduleIndexExists(repoRoot = process.cwd()) {
  return fs.existsSync(path.join(resolveRepoRoot({ repoRoot }), MODULE_INDEX_PATH));
}

export function validateAllManifests(repoRoot = process.cwd()) {
  const startedAt = new Date().toISOString();
  const errors = [];
  let index = null;
  let modules = [];
  try {
    const result = readModuleIndex(repoRoot);
    index = {
      path: path.relative(result.repoRoot, result.indexPath),
      digest: result.digest,
      version: result.index.version,
    };
    modules = result.index.modules.map((entry) => {
      const manifestPath = path.join(result.repoRoot, ONTOLOGY_DIR, entry.manifest);
      if (!fs.existsSync(manifestPath)) {
        errors.push(`module ${entry.id} manifest missing: ${entry.manifest}`);
        return {
          id: entry.id,
          manifest: entry.manifest,
          ok: false,
          digest: null,
          errors: ['manifest missing'],
        };
      }
      const raw = fs.readFileSync(manifestPath, 'utf8');
      let manifest;
      try {
        manifest = JSON.parse(raw);
      } catch (error) {
        const message = `invalid JSON-compatible YAML: ${error instanceof Error ? error.message : String(error)}`;
        errors.push(`module ${entry.id} ${message}`);
        return {
          id: entry.id,
          manifest: entry.manifest,
          ok: false,
          digest: hashText(raw),
          errors: [message],
        };
      }
      const manifestErrors = validateManifestShape(manifest, entry.id);
      errors.push(...manifestErrors.map((message) => `module ${entry.id} ${message}`));
      return {
        id: entry.id,
        manifest: entry.manifest,
        ok: manifestErrors.length === 0,
        digest: hashText(raw),
        errors: manifestErrors,
      };
    });
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  return {
    ok: errors.length === 0,
    startedAt,
    finishedAt: new Date().toISOString(),
    index,
    modules,
    errors,
  };
}

export function listModules(repoRoot = process.cwd()) {
  if (!moduleIndexExists(repoRoot)) {
    return {
      version: 1,
      indexDigest: null,
      indexMissing: true,
      modules: [],
      warnings: ['module ontology index not found'],
    };
  }
  const result = readModuleIndex(repoRoot);
  const modules = result.index.modules.map((entry) => {
    const loaded = readManifestById(result.repoRoot, entry.id);
    return {
      id: entry.id,
      label: entry.label,
      aliases: arrayOfStrings(entry.aliases),
      manifest: entry.manifest,
      manifestDigest: loaded.digest,
      summary: loaded.manifest.summary,
    };
  });
  return {
    version: result.index.version,
    indexDigest: result.digest,
    modules,
  };
}

export function readManifestById(repoRoot = process.cwd(), moduleId) {
  const result = readModuleIndex(repoRoot);
  const entry = result.index.modules.find((candidate) => candidate.id === moduleId);
  if (!entry) {
    const error = new Error(`Unknown module: ${moduleId}`);
    error.code = 'UNKNOWN_MODULE';
    throw error;
  }
  const manifestPath = path.join(result.repoRoot, ONTOLOGY_DIR, entry.manifest);
  const { value, raw } = readJsonCompatibleYaml(manifestPath);
  const errors = validateManifestShape(value, entry.id);
  if (errors.length > 0) {
    const error = new Error(`Invalid manifest ${entry.id}: ${errors.join('; ')}`);
    error.validationErrors = errors;
    throw error;
  }
  return {
    module: entry.id,
    manifest: value,
    manifestPath: path.relative(result.repoRoot, manifestPath),
    digest: hashText(raw),
  };
}

export function classifyGoal(input = {}) {
  const repoRoot = resolveRepoRoot(input);
  const goal = String(input.goal || '').trim();
  if (!goal) {
    return {
      primaryModule: 'unknown',
      secondaryModules: [],
      changeTypes: [],
      risk: 'low',
      confidence: 0,
      reason: 'Goal is empty.',
      candidates: [],
    };
  }
  const index = listModules(repoRoot);
  if (index.indexMissing || index.modules.length === 0) {
    return {
      primaryModule: likelyEmergingFeature(goal) ? 'emerging' : 'unknown',
      secondaryModules: [],
      changeTypes: inferChangeTypes(goal),
      risk: inferRisk(goal),
      confidence: 0.2,
      reason: 'No module ontology index was found for this repository.',
      candidates: [],
      warnings: index.warnings || [],
    };
  }
  const normalizedGoal = normalizeText(goal);
  const candidates = index.modules
    .map((module) => {
      const loaded = readManifestById(repoRoot, module.id);
      const score = scoreModuleForGoal(normalizedGoal, module, loaded.manifest);
      return {
        module: module.id,
        label: module.label,
        score,
        matchedSignals: score.matchedSignals,
      };
    })
    .sort((a, b) => b.score.total - a.score.total);

  const top = candidates[0];
  if (!top || top.score.total <= 0) {
    return {
      primaryModule: likelyEmergingFeature(goal) ? 'emerging' : 'unknown',
      secondaryModules: [],
      changeTypes: inferChangeTypes(goal),
      risk: inferRisk(goal),
      confidence: 0.2,
      reason: 'No existing module matched manifest aliases, responsibilities, summary, or owned paths.',
      candidates,
    };
  }

  const secondaryModules = candidates
    .slice(1)
    .filter((candidate) => candidate.score.total > 0 && candidate.score.total >= top.score.total * 0.45)
    .map((candidate) => candidate.module)
    .slice(0, 3);
  const confidence = Math.min(0.95, Number((0.35 + top.score.total / 20).toFixed(2)));

  return {
    primaryModule: top.module,
    secondaryModules,
    changeTypes: inferChangeTypes(goal),
    risk: inferRisk(goal),
    confidence,
    reason: `Matched ${top.module} via ${top.score.matchedSignals.join(', ') || 'manifest content'}.`,
    candidates,
  };
}

export function compileModuleContext(input = {}) {
  const repoRoot = resolveRepoRoot(input);
  const goal = String(input.goal || '').trim();
  const indexAvailable = moduleIndexExists(repoRoot);
  const routing =
    indexAvailable && input.primaryModule && input.primaryModule !== 'unknown'
      ? {
          primaryModule: input.primaryModule,
          secondaryModules: arrayOfStrings(input.secondaryModules),
          confidence: typeof input.confidence === 'number' ? input.confidence : undefined,
        }
      : classifyGoal({ repoRoot, goal });

  if (routing.primaryModule === 'unknown' || routing.primaryModule === 'emerging') {
    return {
      module: routing.primaryModule,
      summaryType: 'task_scoped',
      domainSummary:
        routing.primaryModule === 'emerging'
          ? 'No stable module manifest owns this goal yet. Treat this as an emerging module and define a proposed boundary before editing.'
          : 'No stable module manifest could be selected. Investigate or ask for clarification before editing.',
      evidenceSources: {
        manifestDigest: null,
        codeEvidenceDigest: null,
        taskGenerationEvidence: Boolean(input.taskGenerationEvidence),
        memoryEvidence: false,
      },
      relevantConcepts: [],
      relevantInvariants: [],
      likelyFiles: [],
      boundaryWarnings: ['Do not perform repository-wide edits until a module boundary is selected.'],
      knownPitfalls: [],
      verificationPlan: [],
      routing,
      warnings: ['module routing is low confidence'],
    };
  }

  const loaded = readManifestById(repoRoot, routing.primaryModule);
  const manifest = loaded.manifest;
  const likelyFiles = collectLikelyFiles(repoRoot, manifest, 12);
  const codeEvidenceDigest = hashText(JSON.stringify({ module: manifest.id, likelyFiles }));
  const secondaryModules = arrayOfStrings(routing.secondaryModules);
  const crossingText =
    secondaryModules.length > 0
      ? ` Secondary modules for this task: ${secondaryModules.join(', ')}.`
      : '';

  return {
    module: manifest.id,
    summaryType: input.summaryType || (input.taskGenerationEvidence ? 'task_scoped' : 'canonical'),
    domainSummary: `${manifest.summary}${crossingText}`,
    evidenceSources: {
      manifestDigest: loaded.digest,
      codeEvidenceDigest,
      taskGenerationEvidence: Boolean(input.taskGenerationEvidence),
      memoryEvidence: Boolean(input.memoryEvidence),
    },
    relevantConcepts: arrayOfObjects(manifest.ubiquitousLanguage)
      .map((item) => String(item.name || '').trim())
      .filter(Boolean),
    relevantInvariants: arrayOfObjects(manifest.invariants)
      .map((item) => String(item.id || '').trim())
      .filter(Boolean),
    likelyFiles,
    boundaryWarnings: arrayOfStrings(manifest.forbiddenMutations).map(
      (mutation) => `Do not change ${mutation} from ${manifest.id} work.`
    ),
    knownPitfalls: [],
    verificationPlan: verificationCommands(manifest.verification?.focused),
    routing,
    warnings: [],
  };
}

export function getVerificationPlan(input = {}) {
  const repoRoot = resolveRepoRoot(input);
  const primary = String(input.primaryModule || input.module || '').trim();
  if (!primary) throw new Error('primaryModule is required.');
  if (!moduleIndexExists(repoRoot)) {
    return {
      primaryModule: primary,
      baseline: [],
      focused: [],
      full: [],
      secondary: [],
      warnings: ['module ontology index not found'],
    };
  }
  const loaded = readManifestById(repoRoot, primary);
  const secondaryModules = arrayOfStrings(input.secondaryModules);
  const secondary = secondaryModules
    .map((module) => {
      try {
        const manifest = readManifestById(repoRoot, module).manifest;
        return { module, verification: manifest.verification };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  return {
    primaryModule: primary,
    baseline: arrayOfObjects(loaded.manifest.verification?.baseline),
    focused: arrayOfObjects(loaded.manifest.verification?.focused),
    full: arrayOfObjects(loaded.manifest.verification?.full),
    secondary,
  };
}

export function checkBoundary(input = {}) {
  const repoRoot = resolveRepoRoot(input);
  const primary = String(input.primaryModule || input.module || '').trim();
  if (!primary) throw new Error('primaryModule is required.');
  const plannedFiles = arrayOfStrings(input.plannedFiles || input.files).map(normalizeRepoPath);
  if (!moduleIndexExists(repoRoot)) {
    return {
      decision: 'needs_user_confirmation',
      primaryModule: primary,
      allowed: [],
      crossings: [],
      forbiddenTouched: [],
      needsConfirmation: plannedFiles.map((file) => ({
        path: file,
        reason: 'module ontology index not found',
      })),
      warnings: ['module ontology index not found'],
    };
  }
  const secondaryModules = new Set(arrayOfStrings(input.secondaryModules));
  const loaded = readManifestById(repoRoot, primary);
  const manifest = loaded.manifest;
  const crossings = [];
  const forbiddenTouched = [];
  const needsConfirmation = [];
  const allowed = [];

  for (const file of plannedFiles) {
    if (!file) continue;
    if (matchesAny(file, manifest.ownedPaths)) {
      allowed.push({ path: file, reason: 'owned path' });
      continue;
    }
    if (isVerificationPath(file, manifest)) {
      allowed.push({ path: file, reason: 'verification path' });
      continue;
    }
    const allowedCrossing = findAllowedCrossing(file, manifest);
    if (allowedCrossing) {
      crossings.push({
        module: allowedCrossing.module,
        paths: [file],
        reason: allowedCrossing.reason,
        declaredSecondary: secondaryModules.has(allowedCrossing.module),
      });
      continue;
    }
    if (matchesAny(file, manifest.readMostlyPaths)) {
      needsConfirmation.push({ path: file, reason: 'readMostly path edited' });
      continue;
    }
    if (matchesAny(file, manifest.forbiddenPaths)) {
      forbiddenTouched.push({ path: file, reason: 'forbidden path' });
      continue;
    }
    needsConfirmation.push({ path: file, reason: 'unknown module path' });
  }

  const decision =
    forbiddenTouched.length > 0
      ? 'reject'
      : needsConfirmation.length > 0
        ? 'needs_user_confirmation'
        : crossings.length > 0
          ? 'allow_with_crossing'
          : 'allow';

  return {
    decision,
    primaryModule: primary,
    allowed,
    crossings,
    forbiddenTouched,
    needsConfirmation,
  };
}

export function cliArgs(argv = process.argv.slice(2)) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const values = [];
    while (argv[index + 1] && !argv[index + 1].startsWith('--')) {
      values.push(argv[index + 1]);
      index += 1;
    }
    if (values.length === 0) {
      args[key] = true;
      continue;
    }
    const value = values.length === 1 ? values[0] : values;
    if (args[key] === undefined) {
      args[key] = value;
    } else {
      args[key] = [...(Array.isArray(args[key]) ? args[key] : [args[key]]), ...values];
    }
  }
  return args;
}

export function printJsonAndExit(payload, exitCode = 0) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  process.exitCode = exitCode;
}

export function runCli(importMetaUrl, handler) {
  if (import.meta.url !== importMetaUrl) return;
  try {
    const result = handler(cliArgs());
    printJsonAndExit(result, result?.ok === false ? 1 : 0);
  } catch (error) {
    printJsonAndExit(
      {
        ok: false,
        error: {
          code: error?.code || 'AGENT_ONTOLOGY_ERROR',
          message: error instanceof Error ? error.message : String(error),
        },
      },
      1
    );
  }
}

export function isMain(importMetaUrl) {
  return process.argv[1] && importMetaUrl === pathToFileURL(process.argv[1]).href;
}

function validateModuleIndexShape(value) {
  const errors = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return ['index must be an object'];
  }
  if (value.version !== 1) errors.push('version must be 1');
  if (!Array.isArray(value.modules)) errors.push('modules must be an array');
  for (const [index, module] of Array.isArray(value.modules) ? value.modules.entries() : []) {
    if (!module || typeof module !== 'object') {
      errors.push(`modules[${index}] must be an object`);
      continue;
    }
    for (const key of ['id', 'label', 'manifest']) {
      if (typeof module[key] !== 'string' || !module[key].trim()) {
        errors.push(`modules[${index}].${key} is required`);
      }
    }
  }
  return errors;
}

function validateManifestShape(value, expectedId) {
  const errors = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return ['manifest must be an object'];
  }
  for (const key of REQUIRED_MANIFEST_FIELDS) {
    if (value[key] === undefined) errors.push(`${key} is required`);
  }
  if (value.version !== 1) errors.push('version must be 1');
  if (value.id !== expectedId) errors.push(`id must match module index id ${expectedId}`);
  for (const key of ['ubiquitousLanguage', 'responsibilities', 'ownedPaths', 'invariants', 'forbiddenMutations']) {
    if (!Array.isArray(value[key])) errors.push(`${key} must be an array`);
  }
  if (!value.verification || typeof value.verification !== 'object' || Array.isArray(value.verification)) {
    errors.push('verification must be an object');
  }
  return errors;
}

function scoreModuleForGoal(normalizedGoal, module, manifest) {
  const signals = [];
  let total = 0;
  for (const alias of arrayOfStrings(module.aliases)) {
    const normalized = normalizeText(alias);
    if (normalized && normalizedGoal.includes(normalized)) {
      total += 5;
      signals.push(`alias:${alias}`);
    }
  }
  for (const field of [manifest.id, manifest.label, manifest.summary]) {
    for (const token of importantTokens(field)) {
      if (normalizedGoal.includes(token)) {
        total += 1;
        signals.push(`text:${token}`);
      }
    }
  }
  for (const responsibility of arrayOfStrings(manifest.responsibilities)) {
    for (const token of importantTokens(responsibility)) {
      if (normalizedGoal.includes(token)) {
        total += 1;
        signals.push(`responsibility:${token}`);
      }
    }
  }
  return {
    total,
    matchedSignals: [...new Set(signals)].slice(0, 8),
  };
}

function inferChangeTypes(goal) {
  const normalized = normalizeText(goal);
  const types = [];
  if (/(ui|screen|画面|表示|button|modal|フォーム)/i.test(normalized)) types.push('ui');
  if (/(api|route|endpoint|schema|db|database|テーブル)/i.test(normalized)) types.push('api');
  if (/(test|coverage|検証|テスト)/i.test(normalized)) types.push('test');
  if (types.length === 0) types.push('code');
  return types;
}

function inferRisk(goal) {
  const normalized = normalizeText(goal);
  if (/(migration|schema|auth|security|delete|destructive|認証|削除|移行)/i.test(normalized)) {
    return 'high';
  }
  if (/(api|db|database|route|settings|設定)/i.test(normalized)) return 'medium';
  return 'low';
}

function likelyEmergingFeature(goal) {
  return /(作る|追加|create|build|implement|new feature|新規|機能)/i.test(goal);
}

function collectLikelyFiles(repoRoot, manifest, limit) {
  const files = [];
  const allFiles = listRepoFiles(repoRoot, 2000);
  for (const file of allFiles) {
    if (matchesAny(file, manifest.ownedPaths)) files.push(file);
    if (files.length >= limit) break;
  }
  return files;
}

function listRepoFiles(repoRoot, maxFiles) {
  const results = [];
  const ignored = new Set(['.git', 'node_modules', 'dist', 'dist-api', 'coverage', '.turbo']);
  function walk(dir) {
    if (results.length >= maxFiles) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ignored.has(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      const relative = normalizeRepoPath(path.relative(repoRoot, fullPath));
      if (entry.isDirectory()) {
        walk(fullPath);
      } else {
        results.push(relative);
      }
      if (results.length >= maxFiles) return;
    }
  }
  if (fs.existsSync(repoRoot)) walk(repoRoot);
  return results.sort();
}

function verificationCommands(items) {
  return arrayOfObjects(items)
    .map((item) => String(item.command || '').trim())
    .filter(Boolean);
}

function isVerificationPath(file, manifest) {
  const commands = [
    ...verificationCommands(manifest.verification?.baseline),
    ...verificationCommands(manifest.verification?.focused),
    ...verificationCommands(manifest.verification?.full),
  ];
  return commands.some((command) => command.includes(file));
}

function findAllowedCrossing(file, manifest) {
  for (const entry of arrayOfObjects(manifest.allowedCrossModule)) {
    if (matchesAny(file, entry.paths)) {
      return {
        module: String(entry.module || ''),
        reason: String(entry.reason || 'Allowed cross-module path.'),
      };
    }
  }
  return null;
}

function matchesAny(file, patterns) {
  return arrayOfStrings(patterns).some((pattern) => globMatches(file, pattern));
}

function globMatches(file, pattern) {
  const normalizedFile = normalizeRepoPath(file);
  const normalizedPattern = normalizeRepoPath(pattern);
  if (normalizedPattern === normalizedFile) return true;
  const regex = new RegExp(`^${globToRegexSource(normalizedPattern)}$`);
  return regex.test(normalizedFile);
}

function globToRegexSource(pattern) {
  let source = '';
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    const next = pattern[index + 1];
    if (char === '*' && next === '*') {
      source += '.*';
      index += 1;
      continue;
    }
    if (char === '*') {
      source += '[^/]*';
      continue;
    }
    source += escapeRegexChar(char);
  }
  return source;
}

function escapeRegexChar(value) {
  return /[|\\{}()[\]^$+?.]/.test(value) ? `\\${value}` : value;
}

function normalizeRepoPath(value) {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/+/g, '/');
}

function normalizeText(value) {
  return String(value || '').toLowerCase().replace(/[_\-/.]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function importantTokens(value) {
  return normalizeText(value)
    .split(' ')
    .filter((token) => token.length >= 4)
    .slice(0, 20);
}

function arrayOfStrings(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || '').trim()).filter(Boolean);
}

function arrayOfObjects(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => item && typeof item === 'object' && !Array.isArray(item));
}
