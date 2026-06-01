/**
 * Command safety policy helper.
 * Categorizes shell commands and blocks destructive/hazardous commands.
 */

export type CommandClassification =
  | 'read_only'
  | 'build_test'
  | 'format'
  | 'package_install_if_explicit'
  | 'destructive'
  | 'unknown';

export interface CommandSafetyResult {
  allowed: boolean;
  classification: CommandClassification;
  reason?: string;
}

const DESTRUCTIVE_KEYWORDS = [
  'rm -rf /',
  'rm -rf *',
  'npm publish',
  'pnpm publish',
  'yarn publish',
  'gh pr merge',
  'git push',
  'git reset --hard',
  'git checkout --',
  'git clean -fd',
  'dd if=',
  ':(){:|:&};:', // fork bomb
  'mkfs',
  'reboot',
  'shutdown',
];

const READ_ONLY_COMMANDS = [
  'ls',
  'pwd',
  'echo',
  'git status',
  'git diff',
  'git log',
  'git show',
  'cat',
  'grep',
  'find',
  'rg',
];

const BUILD_TEST_COMMANDS = [
  'pnpm test',
  'pnpm typecheck',
  'pnpm lint',
  'pnpm build',
  'pnpm test run',
];

const FORMAT_COMMANDS = ['pnpm format', 'pnpm biome format'];
const EXPLICIT_INSTALL_COMMANDS = ['pnpm add', 'pnpm install'];

function startsWithCommand(command: string, prefix: string): boolean {
  return command === prefix || command.startsWith(`${prefix} `);
}

export function analyzeCommand(command: string, blockedCommands?: string[]): CommandSafetyResult {
  const trimmedCmd = command.trim();
  const hasUnsafeChain = /&&|;|\||`|\$\(/.test(trimmedCmd);
  if (hasUnsafeChain) {
    return {
      allowed: false,
      classification: 'destructive',
      reason: 'Chained/expanded shell syntax is blocked by policy.',
    };
  }

  // 1. Check custom blocked commands
  if (blockedCommands && blockedCommands.length > 0) {
    const isBlocked = blockedCommands.some((blocked) => {
      return trimmedCmd.includes(blocked) || new RegExp(`\\b${blocked}\\b`).test(trimmedCmd);
    });
    if (isBlocked) {
      return {
        allowed: false,
        classification: 'destructive',
        reason: 'Command matches blocklist entry.',
      };
    }
  }

  // 2. Check destructive commands
  const isDestructive = DESTRUCTIVE_KEYWORDS.some((kw) => {
    return trimmedCmd.includes(kw);
  });

  if (isDestructive) {
    return {
      allowed: false,
      classification: 'destructive',
      reason: 'Command is classified as destructive and violates safety policy.',
    };
  }

  // 3. Classify the command
  let classification: CommandClassification = 'unknown';

  const baseCmd = trimmedCmd.split(/\s+/)[0];

  if (READ_ONLY_COMMANDS.some((cmd) => startsWithCommand(trimmedCmd, cmd) || baseCmd === cmd)) {
    classification = 'read_only';
  } else if (BUILD_TEST_COMMANDS.some((cmd) => startsWithCommand(trimmedCmd, cmd))) {
    classification = 'build_test';
  } else if (FORMAT_COMMANDS.some((cmd) => startsWithCommand(trimmedCmd, cmd))) {
    classification = 'format';
  } else if (EXPLICIT_INSTALL_COMMANDS.some((cmd) => startsWithCommand(trimmedCmd, cmd))) {
    classification = 'package_install_if_explicit';
  } else if (
    trimmedCmd.startsWith('git ') &&
    (trimmedCmd.includes('push') ||
      trimmedCmd.includes('checkout') ||
      trimmedCmd.includes('reset') ||
      trimmedCmd.includes('commit'))
  ) {
    return {
      allowed: false,
      classification: 'destructive',
      reason: 'Mutating git command is blocked by policy.',
    };
  }

  return {
    allowed: classification !== 'unknown',
    classification,
    reason: classification === 'unknown' ? 'Unknown command is denied by default.' : undefined,
  };
}
