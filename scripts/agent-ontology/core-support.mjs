import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

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

export function validateModuleIndexShape(value) {
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

export function validateManifestShape(value, expectedId) {
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

export function scoreModuleForGoal(normalizedGoal, module, manifest) {
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

export function inferChangeTypes(goal) {
  const normalized = normalizeText(goal);
  const types = [];
  if (/(ui|screen|画面|表示|button|modal|フォーム)/i.test(normalized)) types.push('ui');
  if (/(api|route|endpoint|schema|db|database|テーブル)/i.test(normalized)) types.push('api');
  if (/(test|coverage|検証|テスト)/i.test(normalized)) types.push('test');
  if (types.length === 0) types.push('code');
  return types;
}

export function inferRisk(goal) {
  const normalized = normalizeText(goal);
  if (/(migration|schema|auth|security|delete|destructive|認証|削除|移行)/i.test(normalized)) {
    return 'high';
  }
  if (/(api|db|database|route|settings|設定)/i.test(normalized)) return 'medium';
  return 'low';
}

export function likelyEmergingFeature(goal) {
  return /(作る|追加|create|build|implement|new feature|新規|機能)/i.test(goal);
}

export function collectLikelyFiles(repoRoot, manifest, limit) {
  const files = [];
  const allFiles = listRepoFiles(repoRoot, Number.MAX_SAFE_INTEGER);
  for (const file of allFiles) {
    if (matchesAny(file, manifest.ownedPaths)) files.push(file);
    if (files.length >= limit) break;
  }
  return files;
}

export function listRepoFiles(repoRoot, maxFiles) {
  try {
    const output = execFileSync(
      'git',
      ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    );
    return output
      .split('\0')
      .filter(Boolean)
      .map(normalizeRepoPath)
      .sort()
      .slice(0, maxFiles);
  } catch {
    // Non-Git repositories still receive deterministic filesystem evidence.
  }
  const results = [];
  const ignored = new Set(['.git', 'node_modules', 'dist', 'dist-api', 'coverage', '.turbo']);
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ignored.has(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      const relative = normalizeRepoPath(path.relative(repoRoot, fullPath));
      if (entry.isDirectory()) {
        walk(fullPath);
      } else {
        results.push(relative);
      }
    }
  }
  if (fs.existsSync(repoRoot)) walk(repoRoot);
  return results.sort().slice(0, maxFiles);
}

export function verificationCommands(items) {
  return arrayOfObjects(items)
    .map((item) => String(item.command || '').trim())
    .filter(Boolean);
}

export function normalizeTaskGenerationEvidence(value) {
  if (!value) {
    return {
      available: false,
      section: {
        available: false,
        source: null,
        reason: 'task generation evidence not provided',
      },
      warnings: [],
    };
  }
  if (value === true) {
    return {
      available: true,
      section: {
        available: true,
        source: 'caller_flag',
        raw: null,
        goals: [],
        taskCandidate: null,
        projectWideConstraints: [],
        acceptanceCriteria: [],
        verificationHints: [],
        planModeOpenQuestions: [],
        warnings: ['task generation evidence flag was provided without structured evidence'],
      },
      warnings: ['task generation evidence flag was provided without structured evidence'],
    };
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    return {
      available: false,
      section: {
        available: false,
        source: null,
        reason: 'task generation evidence was not an object',
      },
      warnings: ['task generation evidence was ignored because it was not an object'],
    };
  }

  const record = value;
  const taskCandidate = normalizeTaskCandidateEvidence(record.taskCandidate);
  const projectWideConstraints = arrayOfObjects(record.projectWideConstraints).map((item) => ({
    goalId: stringOrNull(item.goalId || item.id),
    title: String(item.title || '').trim(),
    intent: String(item.intent || '').trim() || 'unknown',
    reason: stringOrNull(item.reason),
  }));
  const planModeOpenQuestions = mergeUniqueStrings([
    ...arrayOfStrings(record.planModeOpenQuestions),
    ...(taskCandidate?.planModeOpenQuestions ?? []),
  ]);
  const warnings = arrayOfStrings(record.warnings);
  return {
    available: true,
    section: {
      available: true,
      source: String(record.source || 'caller').trim(),
      repositoryId: stringOrNull(record.repositoryId),
      missionId: stringOrNull(record.missionId),
      taskCandidateId: stringOrNull(record.taskCandidateId || taskCandidate?.id),
      selectedGoalIds: arrayOfStrings(record.selectedGoalIds),
      goals: arrayOfObjects(record.goals).map((goal) => ({
        id: String(goal.id || '').trim(),
        title: String(goal.title || '').trim(),
        scope: String(goal.scope || 'unknown').trim(),
        intent: String(goal.intent || 'unknown').trim(),
        confidencePercent: numberOrZero(goal.confidencePercent),
        reason: stringOrNull(goal.reason),
      })),
      taskCandidate,
      projectWideConstraints,
      acceptanceCriteria: arrayOfStrings(record.acceptanceCriteria),
      verificationHints: arrayOfStrings(record.verificationHints),
      planModeOpenQuestions,
      warnings,
      raw: record.raw ?? null,
    },
    warnings,
  };
}

export function normalizeTaskCandidateEvidence(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const routing = value.moduleRouting && typeof value.moduleRouting === 'object'
    ? value.moduleRouting
    : value;
  return {
    id: stringOrNull(value.id),
    title: String(value.title || '').trim(),
    kind: String(value.kind || value.candidateKind || 'feature_followup').trim(),
    primaryModule: stringOrNull(routing.primaryModule),
    secondaryModules: arrayOfStrings(routing.secondaryModules),
    routingConfidencePercent: numberOrZero(
      routing.routingConfidencePercent ?? routing.confidencePercent
    ),
    routingReason: stringOrNull(routing.routingReason ?? routing.reason),
    planModeOpenQuestions: arrayOfStrings(value.planModeOpenQuestions),
  };
}

export function normalizeMemoryEvidence(value) {
  if (!value) {
    return {
      available: false,
      section: { available: false, source: null, reason: 'memory evidence not provided' },
      warnings: [],
    };
  }
  return {
    available: true,
    section: {
      available: true,
      source: 'caller',
      summary: typeof value === 'string' ? value : null,
      raw: typeof value === 'string' ? null : value,
    },
    warnings: [],
  };
}

export function detectTaskGenerationContradictions(input) {
  const warnings = [];
  const taskCandidate = input.taskEvidence.taskCandidate;
  const hintedPrimary = taskCandidate?.primaryModule;
  if (hintedPrimary && hintedPrimary !== input.manifest.id) {
    warnings.push(
      `Task generation primaryModule ${hintedPrimary} differs from manifest-selected module ${input.manifest.id}; manifest ownership was kept.`
    );
  }
  for (const moduleId of [hintedPrimary, ...(taskCandidate?.secondaryModules ?? [])].filter(Boolean)) {
    if (input.indexAvailable && !moduleExists(input.repoRoot, moduleId)) {
      warnings.push(
        `Task generation referenced unknown module ${moduleId}; it was kept as an unconfirmed task hint.`
      );
    }
  }
  return warnings;
}

export function moduleExists(repoRoot, moduleId) {
  try {
    readManifestById(repoRoot, moduleId);
    return true;
  } catch {
    return false;
  }
}

export function buildTaskScopedSummary(input) {
  const lines = [input.domainSummary];
  const taskCandidate = input.taskEvidence?.taskCandidate;
  if (taskCandidate) {
    if (taskCandidate.title) lines.push(`Task candidate: ${taskCandidate.title}.`);
    if (taskCandidate.kind) lines.push(`Candidate kind: ${taskCandidate.kind}.`);
    if (taskCandidate.primaryModule) {
      lines.push(
        `Task generation hinted primary module ${taskCandidate.primaryModule} with confidence ${taskCandidate.routingConfidencePercent}%.`
      );
    }
    if (taskCandidate.routingReason) lines.push(`Routing hint reason: ${taskCandidate.routingReason}.`);
  }
  const constraints = input.taskEvidence?.projectWideConstraints ?? [];
  if (constraints.length > 0) {
    lines.push(
      `Project-wide constraints: ${constraints
        .map((item) => item.title || item.goalId)
        .filter(Boolean)
        .join(', ')}.`
    );
  }
  const questions = input.taskEvidence?.planModeOpenQuestions ?? [];
  if (questions.length > 0) {
    lines.push(`Plan mode open questions: ${questions.join(' / ')}`);
  }
  const acceptanceCriteria = input.taskEvidence?.acceptanceCriteria ?? [];
  if (acceptanceCriteria.length > 0) {
    lines.push(`Acceptance criteria: ${acceptanceCriteria.join(' / ')}`);
  }
  const verificationHints = input.taskEvidence?.verificationHints ?? [];
  if (verificationHints.length > 0) {
    lines.push(`Task verification hints: ${verificationHints.join(' / ')}`);
  }
  if ((input.verificationPlan ?? []).length > 0) {
    lines.push(`Focused verification: ${(input.verificationPlan ?? []).join(' | ')}`);
  }
  if ((input.boundaryWarnings ?? []).length > 0) {
    lines.push(`Boundary warnings: ${(input.boundaryWarnings ?? []).join(' ')}`);
  }
  return lines.filter(Boolean).join(' ');
}

export function buildOntologyTelemetry(input) {
  return {
    primaryModule: input.routing.primaryModule ?? null,
    secondaryModules: arrayOfStrings(input.routing.secondaryModules),
    boundaryDecision: null,
    unexplainedCrossingsCount: null,
    focusedVerificationCommands: arrayOfStrings(input.verificationPlan),
    taskGenerationEvidenceAvailable: Boolean(input.taskEvidence.available),
    taskCandidateId: input.taskEvidence.section?.taskCandidateId ?? null,
  };
}

export function numberOrZero(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function stringOrNull(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function mergeUniqueStrings(values) {
  return [...new Set(arrayOfStrings(values))];
}

export function isVerificationPath(file, manifest) {
  const commands = [
    ...verificationCommands(manifest.verification?.baseline),
    ...verificationCommands(manifest.verification?.focused),
    ...verificationCommands(manifest.verification?.full),
  ];
  return commands.some((command) => command.includes(file));
}

export function findAllowedCrossing(file, manifest) {
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

export function matchesAny(file, patterns) {
  return arrayOfStrings(patterns).some((pattern) => globMatches(file, pattern));
}

export function globMatches(file, pattern) {
  const normalizedFile = normalizeRepoPath(file);
  const normalizedPattern = normalizeRepoPath(pattern);
  if (normalizedPattern === normalizedFile) return true;
  const regex = new RegExp(`^${globToRegexSource(normalizedPattern)}$`);
  return regex.test(normalizedFile);
}

export function globToRegexSource(pattern) {
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

export function escapeRegexChar(value) {
  return /[|\\{}()[\]^$+?.]/.test(value) ? `\\${value}` : value;
}

export function normalizeRepoPath(value) {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/+/g, '/');
}

export function normalizeText(value) {
  return String(value || '').toLowerCase().replace(/[_\-/.]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function importantTokens(value) {
  return normalizeText(value)
    .split(' ')
    .filter((token) => token.length >= 4)
    .slice(0, 20);
}

export function arrayOfStrings(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || '').trim()).filter(Boolean);
}

export function arrayOfObjects(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => item && typeof item === 'object' && !Array.isArray(item));
}
