import path from 'node:path';
import { analyzeCommand } from './command-policy';
import { isPathSafe } from './path-policy';

export type ToolPolicyContext = {
  repoRoot: string;
  allowedPaths?: string[];
  deniedPaths?: string[];
  blockedCommands?: string[];
  maxCommandSeconds?: number;
};

export type PolicyDecision = {
  allowed: boolean;
  code?: 'ACCESS_DENIED' | 'COMMAND_BLOCKED' | 'TIMEOUT_EXCEEDED';
  message?: string;
};

export function enforcePathPolicy(targetPath: string, context: ToolPolicyContext): PolicyDecision {
  const absRoot = path.resolve(context.repoRoot);
  const absTarget = path.isAbsolute(targetPath)
    ? path.resolve(targetPath)
    : path.resolve(absRoot, targetPath);
  if (!isPathSafe(absTarget, absRoot, context.allowedPaths, context.deniedPaths)) {
    return {
      allowed: false,
      code: 'ACCESS_DENIED',
      message: `Access denied by safety policy: ${targetPath}`,
    };
  }
  return { allowed: true };
}

export function enforceCommandPolicy(command: string, context: ToolPolicyContext): PolicyDecision {
  const safety = analyzeCommand(command, context.blockedCommands);
  if (!safety.allowed) {
    return {
      allowed: false,
      code: 'COMMAND_BLOCKED',
      message: safety.reason || `Command is blocked by safety policy: ${command}`,
    };
  }
  return { allowed: true };
}

export function resolveCommandTimeout(
  inputSeconds: number | undefined,
  context: ToolPolicyContext
): number {
  const requested = inputSeconds ?? 60;
  const cap = context.maxCommandSeconds;
  if (!cap || cap <= 0) return requested;
  return Math.min(requested, cap);
}
