import { createHash } from 'node:crypto';
import type { WorkerToolName } from '../tool-policy/types';
import type { SupervisorDecision } from './llm-provider';
import { normalizeSupervisorRoutingHypothesis } from './skills/registry';
import {
  defaultSupervisorRoutingHypothesis,
  type SupervisorPhase,
  type SupervisorRoutingHypothesis,
} from './skills/types';

export type SupervisorSessionMemoryEvidence = {
  kind: 'file' | 'diff' | 'command' | 'web' | 'tool' | 'user';
  source: string;
  summary: string;
  toolName?: string;
  eventId?: string;
};

export type SupervisorSessionMemoryVerification = {
  command?: string;
  ok: boolean;
  summary: string;
  eventId?: string;
};

export type SupervisorSessionMemoryBlocker = {
  reason: string;
  neededFromUser?: string;
};

export type SupervisorSessionMemory = {
  goal: {
    summary: string;
    source: 'round1' | 'round2' | 'user_update' | 'finalize';
    updatedAt: string;
  };
  phase: SupervisorPhase;
  routingHypothesis: SupervisorRoutingHypothesis;
  likelyTools: WorkerToolName[];
  evidence: SupervisorSessionMemoryEvidence[];
  changedFiles: string[];
  verification: SupervisorSessionMemoryVerification[];
  blockers: SupervisorSessionMemoryBlocker[];
  loop: {
    iteration: number;
    lastDecisionPhase?: string;
    lastToolNames: string[];
  };
  toolContext: {
    fullManualLoaded: boolean;
    capabilitySummaryVersion: number;
    lastToolContractVersion: number;
  };
};

export function createInitialSessionMemory(goalSummary: string): SupervisorSessionMemory {
  return {
    goal: {
      summary: goalSummary.slice(0, 500),
      source: 'round1',
      updatedAt: new Date().toISOString(),
    },
    phase: defaultSupervisorRoutingHypothesis.phase,
    routingHypothesis: defaultSupervisorRoutingHypothesis,
    likelyTools: [],
    evidence: [],
    changedFiles: [],
    verification: [],
    blockers: [],
    loop: {
      iteration: 0,
      lastToolNames: [],
    },
    toolContext: {
      fullManualLoaded: false,
      capabilitySummaryVersion: 1,
      lastToolContractVersion: 1,
    },
  };
}

export function mergeDecisionIntoSessionMemory(
  memory: SupervisorSessionMemory,
  decision: SupervisorDecision,
  input: { iteration: number; source: 'round1' | 'round2' | 'finalize' }
): SupervisorSessionMemory {
  const next: SupervisorSessionMemory = {
    ...memory,
    phase: decision.routingHypothesis?.phase || memory.phase,
    routingHypothesis: decision.routingHypothesis || memory.routingHypothesis,
    likelyTools: normalizeToolNames(decision.likelyTools),
    loop: {
      iteration: input.iteration,
      lastDecisionPhase: normalizeDecisionPhase(decision.phase),
      lastToolNames: decision.toolCall?.name ? [decision.toolCall.name as WorkerToolName] : [],
    },
  };

  const update = decision.sessionMemoryUpdate;
  if (update && typeof update === 'object' && !Array.isArray(update)) {
    if (typeof update.goal === 'string' && update.goal.trim()) {
      next.goal = {
        summary: update.goal.trim().slice(0, 500),
        source: input.source,
        updatedAt: new Date().toISOString(),
      };
    }
    if (isSupervisorPhase(update.phase)) next.phase = update.phase;
    if (update.routingHypothesis && typeof update.routingHypothesis === 'object') {
      next.routingHypothesis = normalizeSupervisorRoutingHypothesis({
        ...next.routingHypothesis,
        ...(update.routingHypothesis as Partial<SupervisorRoutingHypothesis>),
      });
      next.phase = next.routingHypothesis.phase;
    }
    if (Array.isArray(update.activeSkillFiles)) {
      next.routingHypothesis = {
        ...next.routingHypothesis,
        nextSkillFiles: stringArray(update.activeSkillFiles),
      };
    }
    if (Array.isArray(update.evidence)) {
      next.evidence = appendLimited(next.evidence, normalizeEvidence(update.evidence), 30);
    }
    if (Array.isArray(update.changedFiles)) {
      next.changedFiles = unique([...next.changedFiles, ...stringArray(update.changedFiles)]);
    }
    if (Array.isArray(update.verification)) {
      next.verification = appendLimited(
        next.verification,
        normalizeVerification(update.verification),
        20
      );
    }
    if (Array.isArray(update.blockers)) {
      next.blockers = appendLimited(next.blockers, normalizeBlockers(update.blockers), 20);
    }
  }

  return next;
}

export function mergeToolResultIntoSessionMemory(
  memory: SupervisorSessionMemory,
  input: {
    iteration: number;
    toolName: WorkerToolName;
    toolResult: any;
    observation: string;
    changedFiles: string[];
  }
): SupervisorSessionMemory {
  const evidence: SupervisorSessionMemoryEvidence = {
    kind: evidenceKindForTool(input.toolName),
    source: input.toolName,
    summary: input.observation.slice(0, 1000),
    toolName: input.toolName,
  };
  const verification =
    input.toolName === 'run_verification' || input.toolName === 'run_command'
      ? [
          {
            command:
              typeof input.toolResult?.payload?.command === 'string'
                ? input.toolResult.payload.command
                : undefined,
            ok: Boolean(input.toolResult?.ok),
            summary: input.observation.slice(0, 500),
          },
        ]
      : [];
  const blockers = input.toolResult?.ok
    ? []
    : [
        {
          reason:
            input.toolResult?.error?.message ||
            input.toolResult?.error?.code ||
            `Tool ${input.toolName} failed.`,
        },
      ];

  return {
    ...memory,
    evidence: appendLimited(memory.evidence, [evidence], 30),
    changedFiles: unique([...memory.changedFiles, ...input.changedFiles]),
    verification: appendLimited(memory.verification, verification, 20),
    blockers: appendLimited(memory.blockers, blockers, 20),
    loop: {
      ...memory.loop,
      iteration: input.iteration,
      lastToolNames: [input.toolName],
    },
  };
}

export function compactSessionMemoryForPrompt(memory: SupervisorSessionMemory) {
  return {
    ...memory,
    digest: digestSessionMemory(memory),
    evidence: memory.evidence.slice(-12),
    verification: memory.verification.slice(-8),
    blockers: memory.blockers.slice(-8),
  };
}

export function digestSessionMemory(memory: SupervisorSessionMemory): string {
  return createHash('sha256').update(JSON.stringify(memory)).digest('hex');
}

function normalizeDecisionPhase(phase: string): string {
  return phase === 'report' ? 'stop' : phase;
}

function evidenceKindForTool(toolName: WorkerToolName): SupervisorSessionMemoryEvidence['kind'] {
  if (toolName === 'read_file' || toolName === 'list_dir' || toolName === 'find_file')
    return 'file';
  if (toolName === 'git_diff') return 'diff';
  if (toolName === 'run_command' || toolName === 'run_verification') return 'command';
  if (toolName === 'search_web' || toolName === 'fetch_content') return 'web';
  return 'tool';
}

function normalizeToolNames(value: unknown): WorkerToolName[] {
  return stringArray(value) as WorkerToolName[];
}

function normalizeEvidence(value: unknown[]): SupervisorSessionMemoryEvidence[] {
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    const source = stringValue(record.source);
    const summary = stringValue(record.summary);
    if (!source || !summary) return [];
    return [
      {
        kind: isEvidenceKind(record.kind) ? record.kind : 'tool',
        source,
        summary,
        toolName: stringValue(record.toolName) || undefined,
        eventId: stringValue(record.eventId) || undefined,
      },
    ];
  });
}

function normalizeVerification(value: unknown[]): SupervisorSessionMemoryVerification[] {
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    const summary = stringValue(record.summary);
    if (!summary) return [];
    return [
      {
        command: stringValue(record.command) || undefined,
        ok: Boolean(record.ok),
        summary,
        eventId: stringValue(record.eventId) || undefined,
      },
    ];
  });
}

function normalizeBlockers(value: unknown[]): SupervisorSessionMemoryBlocker[] {
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    const reason = stringValue(record.reason);
    if (!reason) return [];
    return [
      {
        reason,
        neededFromUser: stringValue(record.neededFromUser) || undefined,
      },
    ];
  });
}

function isSupervisorPhase(value: unknown): value is SupervisorPhase {
  return (
    value === 'answer' ||
    value === 'analyze' ||
    value === 'plan' ||
    value === 'execute' ||
    value === 'review' ||
    value === 'investigate' ||
    value === 'verify' ||
    value === 'summarize'
  );
}

function isEvidenceKind(value: unknown): value is SupervisorSessionMemoryEvidence['kind'] {
  return (
    value === 'file' ||
    value === 'diff' ||
    value === 'command' ||
    value === 'web' ||
    value === 'tool' ||
    value === 'user'
  );
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return unique(value.filter((item): item is string => typeof item === 'string' && Boolean(item)));
}

function stringValue(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function appendLimited<T>(current: T[], additions: T[], limit: number): T[] {
  return [...current, ...additions].slice(-limit);
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}
