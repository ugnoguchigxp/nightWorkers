import { analyzeCommand } from '../worker-tools/command-policy';
import {
  enforceCommandPolicy,
  enforcePathPolicy,
  resolveCommandTimeout,
} from '../worker-tools/tool-policy-enforcer';
import type { WorkerToolResult } from '../worker-tools/types';
import { TOOL_MANIFEST } from './tool-manifest';
import type { ToolCallRequest, ToolPolicyDecision, ToolPolicyGate } from './types';

const SECRET_PATTERN = /(?:api[_-]?key|token|password|secret)\s*[:=]\s*['"]?[^\s'"]+/i;

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function extractPatchTargets(patchContent: string): string[] {
  const targets = new Set<string>();
  for (const line of patchContent.split('\n')) {
    if (!line.startsWith('+++ b/') && !line.startsWith('--- a/')) continue;
    const p = line.slice(6).trim();
    if (!p || p === '/dev/null') continue;
    targets.add(p);
  }
  return [...targets];
}

function isDeniedPath(relPath: string, request: ToolCallRequest): boolean {
  const decision = enforcePathPolicy(relPath, {
    repoRoot: request.repoRoot,
    allowedPaths: request.safetyPolicy?.allowedPaths,
    externalAllowedPaths: request.safetyPolicy?.externalAllowedPaths,
    deniedPaths: request.safetyPolicy?.deniedPaths,
  });
  return !decision.allowed;
}

export class DefaultToolPolicyGate implements ToolPolicyGate {
  async beforeToolCall(request: ToolCallRequest): Promise<ToolPolicyDecision> {
    const args = toRecord(request.args);
    if (!args) {
      return {
        allowed: false,
        code: 'INVALID_TOOL_ARGS',
        message: 'Tool arguments must be an object.',
      };
    }

    const manifest = TOOL_MANIFEST[request.toolName];
    if (!manifest) {
      return {
        allowed: false,
        code: 'TOOL_NOT_ALLOWED',
        message: `Unsupported tool: ${request.toolName}`,
      };
    }

    for (const pathArg of manifest.pathArgs) {
      const value = args[pathArg];
      if (typeof value !== 'string' || value.length === 0) continue;
      const pathDecision = enforcePathPolicy(value, {
        repoRoot: request.repoRoot,
        allowedPaths: request.safetyPolicy?.allowedPaths,
        externalAllowedPaths: request.safetyPolicy?.externalAllowedPaths,
        deniedPaths: request.safetyPolicy?.deniedPaths,
      });
      if (!pathDecision.allowed) {
        return {
          allowed: false,
          code: 'ACCESS_DENIED',
          message: pathDecision.message || `Access denied: ${pathArg}`,
          evidence: { pathArg, value },
        };
      }
    }

    if (request.toolName === 'apply_patch') {
      const patchContent = args.patchContent;
      if (typeof patchContent !== 'string' || patchContent.trim().length === 0) {
        return {
          allowed: false,
          code: 'INVALID_TOOL_ARGS',
          message: 'apply_patch requires patchContent string.',
        };
      }
      const targets = extractPatchTargets(patchContent);
      for (const target of targets) {
        const pathDecision = enforcePathPolicy(target, {
          repoRoot: request.repoRoot,
          allowedPaths: request.safetyPolicy?.allowedPaths,
          externalAllowedPaths: request.safetyPolicy?.externalAllowedPaths,
          deniedPaths: request.safetyPolicy?.deniedPaths,
        });
        if (!pathDecision.allowed) {
          return {
            allowed: false,
            code: 'ACCESS_DENIED',
            message: pathDecision.message || `Patch target denied: ${target}`,
            evidence: { target },
          };
        }
      }
      return { allowed: true, normalizedArgs: args, preflight: { patchTargets: targets } };
    }

    if (request.toolName === 'replace_content') {
      const target = args.filePath;
      if (typeof target !== 'string' || target.trim().length === 0) {
        return {
          allowed: false,
          code: 'INVALID_TOOL_ARGS',
          message: 'replace_content requires filePath string.',
        };
      }
      return { allowed: true, normalizedArgs: args, preflight: { targetFile: target } };
    }

    if (request.toolName === 'run_command' || request.toolName === 'run_verification') {
      const command = args.command;
      if (typeof command !== 'string' || command.trim().length === 0) {
        return {
          allowed: false,
          code: 'INVALID_TOOL_ARGS',
          message: `${request.toolName} requires command string.`,
        };
      }
      const cwd = typeof args.cwd === 'string' ? args.cwd : '';
      const cwdDecision = enforcePathPolicy(cwd, {
        repoRoot: request.repoRoot,
        allowedPaths: request.safetyPolicy?.allowedPaths,
        externalAllowedPaths: request.safetyPolicy?.externalAllowedPaths,
        deniedPaths: request.safetyPolicy?.deniedPaths,
      });
      if (!cwdDecision.allowed) {
        return {
          allowed: false,
          code: 'ACCESS_DENIED',
          message: cwdDecision.message || 'Command cwd denied.',
        };
      }

      const commandDecision = enforceCommandPolicy(command, {
        repoRoot: request.repoRoot,
        blockedCommands: request.safetyPolicy?.blockedCommands,
      });
      if (!commandDecision.allowed) {
        const analyzed = analyzeCommand(command, request.safetyPolicy?.blockedCommands);
        const reason = analyzed.reason || commandDecision.message || 'Command blocked by policy.';
        const chained = reason.toLowerCase().includes('chained');
        const unknown = analyzed.classification === 'unknown';
        return {
          allowed: false,
          code: chained
            ? 'CHAINED_COMMAND_BLOCKED'
            : unknown
              ? 'UNKNOWN_COMMAND'
              : 'COMMAND_BLOCKED',
          message: reason,
          evidence: { command, classification: analyzed.classification },
        };
      }

      const timeoutInput =
        typeof args.timeoutSeconds === 'number' ? args.timeoutSeconds : undefined;
      const effectiveTimeout = resolveCommandTimeout(timeoutInput, {
        repoRoot: request.repoRoot,
        maxCommandSeconds: request.safetyPolicy?.maxCommandSeconds,
      });
      return {
        allowed: true,
        normalizedArgs: { ...args, timeoutSeconds: effectiveTimeout },
        effectiveLimits: { timeoutSeconds: effectiveTimeout },
      };
    }

    if (request.toolName === 'mcp_call_tool') {
      if (typeof args.serverId !== 'string' || args.serverId.trim().length === 0) {
        return {
          allowed: false,
          code: 'INVALID_TOOL_ARGS',
          message: 'mcp_call_tool requires serverId string.',
        };
      }
      if (typeof args.toolName !== 'string' || args.toolName.trim().length === 0) {
        return {
          allowed: false,
          code: 'INVALID_TOOL_ARGS',
          message: 'mcp_call_tool requires toolName string.',
        };
      }
      const toolArguments = args.arguments;
      if (
        toolArguments !== undefined &&
        (!toolArguments || typeof toolArguments !== 'object' || Array.isArray(toolArguments))
      ) {
        return {
          allowed: false,
          code: 'INVALID_TOOL_ARGS',
          message: 'mcp_call_tool arguments must be an object when provided.',
        };
      }
      return { allowed: true, normalizedArgs: args };
    }

    return { allowed: true, normalizedArgs: args };
  }

  async afterToolCall(
    request: ToolCallRequest,
    result: WorkerToolResult<unknown>,
    preflight?: Record<string, unknown>
  ): Promise<{
    result: WorkerToolResult<unknown>;
    policyViolation?: ToolPolicyDecision;
    warnings?: string[];
  }> {
    const warnings: string[] = [];
    const payload = toRecord(result.payload) || {};

    if (request.toolName === 'search_files' && Array.isArray(payload.matches)) {
      for (const match of payload.matches) {
        const m = toRecord(match);
        if (!m || typeof m.filePath !== 'string') continue;
        if (isDeniedPath(m.filePath, request)) {
          return {
            result,
            policyViolation: {
              allowed: false,
              code: 'POLICY_VIOLATION',
              message: 'search_files result included denied path.',
              evidence: { filePath: m.filePath },
            },
          };
        }
      }
    }

    if (request.toolName === 'apply_patch') {
      const changed = Array.isArray(payload.changedFiles)
        ? payload.changedFiles.filter((v): v is string => typeof v === 'string')
        : [];
      const expected = Array.isArray(preflight?.patchTargets)
        ? (preflight?.patchTargets as unknown[]).filter((v): v is string => typeof v === 'string')
        : [];
      if (expected.length > 0 && changed.some((file) => !expected.includes(file))) {
        return {
          result,
          policyViolation: {
            allowed: false,
            code: 'POLICY_VIOLATION',
            message: 'apply_patch changed files outside preflight targets.',
            evidence: { expected, changed },
          },
        };
      }
    }

    if (request.toolName === 'replace_content') {
      const filePath = payload.filePath;
      const expected = preflight?.targetFile;
      if (typeof filePath === 'string' && typeof expected === 'string' && filePath !== expected) {
        return {
          result,
          policyViolation: {
            allowed: false,
            code: 'POLICY_VIOLATION',
            message: 'replace_content returned unexpected target file.',
            evidence: { expected, filePath },
          },
        };
      }
    }

    if (request.toolName === 'run_command' || request.toolName === 'git_diff') {
      for (const key of ['stdout', 'stderr', 'diff']) {
        const value = payload[key];
        if (typeof value === 'string' && SECRET_PATTERN.test(value)) {
          warnings.push(`Potential secret pattern detected in ${key}.`);
        }
      }
    }

    return { result, warnings: warnings.length > 0 ? warnings : undefined };
  }
}
