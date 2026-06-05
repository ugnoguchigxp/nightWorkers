export type AgentOutcomeScenario = {
  id: string;
  title: string;
  prompt: string;
  workspaceSeed: Array<{
    path: string;
    content: string;
  }>;
  safetyPolicy?: {
    allowedPaths?: string[];
    deniedPaths?: string[];
    blockedCommands?: string[];
    maxCommandSeconds?: number;
  };
  expected: {
    runStatus: string;
    taskStatus: string;
    changedFiles?: string[];
    fileAssertions?: Array<{
      path: string;
      includes?: string[];
      excludes?: string[];
    }>;
    requiredEventTypes?: string[];
    requiredRunEventTypes?: string[];
    review?: {
      action: 'complete' | 'cancel';
      finalStatus: string;
    };
    finalReportExcludes?: string[];
  };
};

export const agentOutcomeScenarios = {
  basicFileCreate: {
    id: 'basic_file_create',
    title: 'Basic file create',
    prompt:
      'NIGHTWORKERS_TEST_AGENT_SCENARIO=basic_file_create src/fizzbuzz.ts を作成して検証してください',
    workspaceSeed: [
      { path: 'README.md', content: '# Agent outcome fixture\n' },
      { path: 'src/greeting.txt', content: 'TODO\n' },
    ],
    expected: {
      runStatus: 'needs_review',
      taskStatus: 'completed',
      changedFiles: ['src/fizzbuzz.ts'],
      fileAssertions: [
        {
          path: 'src/fizzbuzz.ts',
          includes: ['export function fizzBuzz', 'NIGHTWORKERS_BASIC_FILE_CREATE'],
        },
      ],
      requiredEventTypes: ['tool_call', 'tool_result', 'run_outcome_decided'],
      requiredRunEventTypes: ['tool.call_started', 'verification.finished', 'run.outcome_decided'],
      review: { action: 'complete', finalStatus: 'completed' },
    },
  },
  existingFileEditRequiresRead: {
    id: 'existing_file_edit_requires_read',
    title: 'Existing file edit requires read',
    prompt:
      'NIGHTWORKERS_TEST_AGENT_SCENARIO=existing_file_edit_requires_read src/greeting.txt を読んでから編集してください',
    workspaceSeed: [
      { path: 'README.md', content: '# Agent outcome fixture\n' },
      { path: 'src/greeting.txt', content: 'TODO\n' },
    ],
    expected: {
      runStatus: 'needs_review',
      taskStatus: 'completed',
      changedFiles: ['src/greeting.txt'],
      fileAssertions: [
        {
          path: 'src/greeting.txt',
          includes: ['NIGHTWORKERS_READ_BEFORE_EDIT'],
          excludes: ['TODO'],
        },
      ],
      requiredEventTypes: ['tool_call', 'tool_result', 'run_outcome_decided'],
      requiredRunEventTypes: ['tool.call_finished', 'run.outcome_decided'],
      review: { action: 'complete', finalStatus: 'completed' },
    },
  },
  wsBadgeColorUpdate: {
    id: 'ws_badge_color_update',
    title: 'WS badge color update',
    prompt:
      'NIGHTWORKERS_TEST_AGENT_SCENARIO=ws_badge_color_update WS badge を3色丸の状態表示に変更してください',
    workspaceSeed: [
      { path: 'README.md', content: '# Agent outcome fixture\n' },
      {
        path: 'src/WsBadge.tsx',
        content: 'export function WsBadge() {\n  return <span>WS</span>;\n}\n',
      },
    ],
    expected: {
      runStatus: 'needs_review',
      taskStatus: 'completed',
      changedFiles: ['src/WsBadge.tsx'],
      fileAssertions: [
        {
          path: 'src/WsBadge.tsx',
          includes: ['WS status badge', 'connected', 'connecting', 'disconnected'],
          excludes: ['return <span>WS</span>'],
        },
      ],
      requiredEventTypes: ['tool_call', 'tool_result', 'run_outcome_decided'],
      requiredRunEventTypes: ['tool.call_finished', 'run.outcome_decided'],
      review: { action: 'complete', finalStatus: 'completed' },
    },
  },
  policyBlockedCommand: {
    id: 'policy_blocked_command',
    title: 'Policy blocked command',
    prompt:
      'NIGHTWORKERS_TEST_AGENT_SCENARIO=policy_blocked_command 危険なコマンドが実行前に止まることを確認してください',
    workspaceSeed: [
      { path: 'README.md', content: '# Agent outcome fixture\n' },
      { path: 'src/greeting.txt', content: 'TODO\n' },
    ],
    safetyPolicy: {
      blockedCommands: ['rm'],
      maxCommandSeconds: 5,
    },
    expected: {
      runStatus: 'needs_human',
      taskStatus: 'needs_human',
      changedFiles: [],
      requiredEventTypes: ['error', 'tool_result', 'run_outcome_decided'],
      requiredRunEventTypes: ['tool.policy_blocked', 'run.outcome_decided'],
    },
  },
  verificationFailure: {
    id: 'verification_failure',
    title: 'Verification failure',
    prompt:
      'NIGHTWORKERS_TEST_AGENT_SCENARIO=verification_failure 失敗する検証を final outcome に反映してください',
    workspaceSeed: [
      { path: 'README.md', content: '# Agent outcome fixture\n' },
      { path: 'src/greeting.txt', content: 'TODO\n' },
    ],
    expected: {
      runStatus: 'needs_human',
      taskStatus: 'ready',
      changedFiles: ['src/failing-check.txt'],
      fileAssertions: [
        {
          path: 'src/failing-check.txt',
          includes: ['NIGHTWORKERS_VERIFICATION_FAILURE'],
        },
      ],
      requiredEventTypes: ['tool_call', 'tool_result', 'run_outcome_decided'],
      requiredRunEventTypes: ['verification.finished', 'run.outcome_decided'],
      review: { action: 'cancel', finalStatus: 'cancelled' },
      finalReportExcludes: ['completed successfully', 'unqualified success'],
    },
  },
} satisfies Record<string, AgentOutcomeScenario>;
