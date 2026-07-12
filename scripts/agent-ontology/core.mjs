import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  validateModuleIndexShape,
  validateManifestShape,
  scoreModuleForGoal,
  inferChangeTypes,
  inferRisk,
  likelyEmergingFeature,
  collectLikelyFiles,
  listRepoFiles,
  verificationCommands,
  normalizeTaskGenerationEvidence,
  normalizeTaskCandidateEvidence,
  normalizeMemoryEvidence,
  detectTaskGenerationContradictions,
  moduleExists,
  buildTaskScopedSummary,
  buildOntologyTelemetry,
  numberOrZero,
  stringOrNull,
  mergeUniqueStrings,
  isVerificationPath,
  findAllowedCrossing,
  matchesAny,
  globMatches,
  globToRegexSource,
  escapeRegexChar,
  normalizeRepoPath,
  normalizeText,
  importantTokens,
  arrayOfStrings,
  arrayOfObjects,
} from './core-support.mjs';

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
  const taskEvidence = normalizeTaskGenerationEvidence(input.taskGenerationEvidence);
  const memoryEvidence = normalizeMemoryEvidence(input.memoryEvidence);
  const routing =
    indexAvailable && input.primaryModule && input.primaryModule !== 'unknown'
      ? {
          primaryModule: input.primaryModule,
          secondaryModules: arrayOfStrings(input.secondaryModules),
          confidence: typeof input.confidence === 'number' ? input.confidence : undefined,
          reason: typeof input.reason === 'string' ? input.reason : undefined,
          source: 'explicit',
        }
      : classifyGoal({ repoRoot, goal });

  if (routing.primaryModule === 'unknown' || routing.primaryModule === 'emerging') {
    const warnings = [
      'module routing is low confidence',
      ...taskEvidence.warnings,
      ...memoryEvidence.warnings,
    ];
    const summaryType = 'task_scoped';
    const domainSummary =
      routing.primaryModule === 'emerging'
        ? 'No stable module manifest owns this goal yet. Treat this as an emerging module and define a proposed boundary before editing.'
        : 'No stable module manifest could be selected. Investigate or ask for clarification before editing.';
    return {
      module: routing.primaryModule,
      summaryType,
      domainSummary,
      evidenceSources: {
        manifestDigest: null,
        codeEvidenceDigest: null,
        taskGenerationEvidence: taskEvidence.available,
        memoryEvidence: memoryEvidence.available,
      },
      moduleManifest: {
        available: false,
        source: 'manifest',
        digest: null,
        module: routing.primaryModule,
        manifestPath: null,
        summary: null,
        responsibilities: [],
        ownedPaths: [],
        readMostlyPaths: [],
        invariants: [],
        forbiddenMutations: [],
        verification: null,
      },
      codeEvidence: {
        source: 'repository',
        digest: null,
        likelyFiles: [],
      },
      taskGenerationEvidence: taskEvidence.section,
      memoryEvidence: memoryEvidence.section,
      llmSynthesis: {
        used: false,
        reason: 'deterministic fallback summary only',
      },
      summary: {
        canonicalDomainSummary: null,
        taskScopedSummary: buildTaskScopedSummary({
          domainSummary,
          routing,
          taskEvidence: taskEvidence.section,
          boundaryWarnings: ['Do not perform repository-wide edits until a module boundary is selected.'],
        }),
      },
      telemetry: buildOntologyTelemetry({
        routing,
        taskEvidence,
        verificationPlan: [],
      }),
      relevantConcepts: [],
      relevantInvariants: [],
      likelyFiles: [],
      boundaryWarnings: ['Do not perform repository-wide edits until a module boundary is selected.'],
      knownPitfalls: [],
      verificationPlan: [],
      routing,
      warnings,
    };
  }

  const loaded = readManifestById(repoRoot, routing.primaryModule);
  const manifest = loaded.manifest;
  const likelyFiles = collectLikelyFiles(repoRoot, manifest, 12);
  const codeEvidenceDigest = hashText(JSON.stringify({ module: manifest.id, likelyFiles }));
  const secondaryModules = arrayOfStrings(routing.secondaryModules);
  const verificationPlan = verificationCommands(manifest.verification?.focused);
  const boundaryWarnings = arrayOfStrings(manifest.forbiddenMutations).map(
    (mutation) => `Do not change ${mutation} from ${manifest.id} work.`
  );
  const warnings = [
    ...taskEvidence.warnings,
    ...memoryEvidence.warnings,
    ...detectTaskGenerationContradictions({
      manifest,
      routing,
      taskEvidence: taskEvidence.section,
      indexAvailable,
      repoRoot,
    }),
  ];
  const crossingText =
    secondaryModules.length > 0
      ? ` Secondary modules for this task: ${secondaryModules.join(', ')}.`
      : '';
  const canonicalDomainSummary = manifest.summary;
  const domainSummary = `${manifest.summary}${crossingText}`;
  const summaryType = input.summaryType || (taskEvidence.available ? 'task_scoped' : 'canonical');

  return {
    module: manifest.id,
    summaryType,
    domainSummary,
    evidenceSources: {
      manifestDigest: loaded.digest,
      codeEvidenceDigest,
      taskGenerationEvidence: taskEvidence.available,
      memoryEvidence: memoryEvidence.available,
    },
    moduleManifest: {
      available: true,
      source: 'manifest',
      digest: loaded.digest,
      module: manifest.id,
      manifestPath: loaded.manifestPath,
      summary: manifest.summary,
      responsibilities: arrayOfStrings(manifest.responsibilities),
      ownedPaths: arrayOfStrings(manifest.ownedPaths),
      readMostlyPaths: arrayOfStrings(manifest.readMostlyPaths),
      invariants: arrayOfObjects(manifest.invariants),
      forbiddenMutations: arrayOfStrings(manifest.forbiddenMutations),
      verification: manifest.verification ?? null,
    },
    codeEvidence: {
      source: 'repository',
      digest: codeEvidenceDigest,
      likelyFiles,
    },
    taskGenerationEvidence: taskEvidence.section,
    memoryEvidence: memoryEvidence.section,
    llmSynthesis: {
      used: false,
      reason: 'deterministic manifest and task evidence summary only',
    },
    summary: {
      canonicalDomainSummary,
      taskScopedSummary: buildTaskScopedSummary({
        domainSummary,
        routing,
        taskEvidence: taskEvidence.section,
        boundaryWarnings,
        verificationPlan,
      }),
    },
    telemetry: buildOntologyTelemetry({
      routing,
      taskEvidence,
      verificationPlan,
    }),
    relevantConcepts: arrayOfObjects(manifest.ubiquitousLanguage)
      .map((item) => String(item.name || '').trim())
      .filter(Boolean),
    relevantInvariants: arrayOfObjects(manifest.invariants)
      .map((item) => String(item.id || '').trim())
      .filter(Boolean),
    likelyFiles,
    boundaryWarnings,
    knownPitfalls: [],
    verificationPlan,
    routing,
    warnings,
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
