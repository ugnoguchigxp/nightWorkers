/**
 * Command safety policy helper.
 * Categorizes shell commands and blocks destructive/hazardous commands.
 */

export type CommandClassification =
  | 'read_only'
  | 'build_test'
  | 'write'
  | 'destructive'
  | 'networked'
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
  'git status',
  'git diff',
  'git log',
  'git show',
  'cat',
  'grep',
  'find',
  'rg',
  'echo',
];

const BUILD_TEST_COMMANDS = [
  'npm test',
  'pnpm test',
  'yarn test',
  'bun test',
  'npm run build',
  'pnpm build',
  'yarn build',
  'bun run build',
  'npm run dev',
  'pnpm dev',
  'vitest',
  'jest',
  'playwright',
  'tsc',
  'eslint',
  'biome',
];

export function analyzeCommand(command: string, blockedCommands?: string[]): CommandSafetyResult {
  const trimmedCmd = command.trim();

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

  if (READ_ONLY_COMMANDS.some((cmd) => trimmedCmd.startsWith(cmd) || baseCmd === cmd)) {
    classification = 'read_only';
  } else if (BUILD_TEST_COMMANDS.some((cmd) => trimmedCmd.includes(cmd) || baseCmd === cmd)) {
    classification = 'build_test';
  } else if (
    trimmedCmd.startsWith('git ') &&
    !trimmedCmd.includes('push') &&
    !trimmedCmd.includes('checkout') &&
    !trimmedCmd.includes('reset')
  ) {
    classification = 'read_only';
  } else if (
    trimmedCmd.includes('curl') ||
    trimmedCmd.includes('wget') ||
    trimmedCmd.includes('fetch')
  ) {
    classification = 'networked';
  } else if (
    trimmedCmd.includes('touch') ||
    trimmedCmd.includes('mkdir') ||
    trimmedCmd.includes('cp') ||
    trimmedCmd.includes('mv')
  ) {
    classification = 'write';
  }

  return {
    allowed: true,
    classification,
  };
}
