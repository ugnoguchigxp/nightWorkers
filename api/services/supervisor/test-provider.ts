import type { SupervisorDecision } from './llm-provider';

type ScenarioId =
  | 'basic_file_create'
  | 'existing_file_edit_requires_read'
  | 'ws_badge_color_update'
  | 'policy_blocked_command'
  | 'verification_failure';

const scenarioRound2Calls = new Map<string, number>();

function getLatestUserMessage(userPrompt: string): string {
  try {
    const parsed = JSON.parse(userPrompt) as { latestUserMessage?: unknown };
    if (typeof parsed.latestUserMessage === 'string') return parsed.latestUserMessage;
  } catch {
    // Round 1 receives the original prompt.
  }
  return userPrompt;
}

function getScenarioId(userPrompt: string): ScenarioId {
  const latest = getLatestUserMessage(userPrompt);
  const explicit = latest.match(/NIGHTWORKERS_TEST_AGENT_SCENARIO=([a-z0-9_]+)/)?.[1];
  const env = process.env.NIGHTWORKERS_TEST_AGENT_SCENARIO;
  const candidate = explicit || env;
  if (
    candidate === 'basic_file_create' ||
    candidate === 'existing_file_edit_requires_read' ||
    candidate === 'ws_badge_color_update' ||
    candidate === 'policy_blocked_command' ||
    candidate === 'verification_failure'
  ) {
    return candidate;
  }
  throw new Error(`Unknown NightWorkers test agent scenario: ${candidate || '(missing)'}`);
}

function hasObservation(userPrompt: string, text: string): boolean {
  try {
    const parsed = JSON.parse(userPrompt) as { observations?: unknown };
    return (
      Array.isArray(parsed.observations) &&
      parsed.observations.some((item) => String(item).includes(text))
    );
  } catch {
    return false;
  }
}

function scenarioKey(userPrompt: string): string {
  return `${getScenarioId(userPrompt)}:${getLatestUserMessage(userPrompt).slice(0, 500)}`;
}

function makeLongFinalResponse(message: string): string {
  return [
    message,
    'Outcome evidence includes concrete worker tool results, a workspace diff, and a terminal decision suitable for human review.',
    'The deterministic provider is intentionally limited to test runs so the harness verifies the real control plane without external provider credentials.',
  ].join(' ');
}

function buildRound1Decision(scenarioId: ScenarioId): SupervisorDecision {
  const workflow = scenarioId === 'policy_blocked_command' ? 'general' : 'code_change';
  return {
    phase: 'plan',
    workflow,
    instruction: `Select deterministic agent outcome scenario: ${scenarioId}.`,
    rationale: 'Provider-free E2E harness drives the real runtime with fixed decisions.',
    finalResponse: '',
    expectedEvidence: ['run ledger events', 'workspace state', 'final outcome'],
    riskLevel: scenarioId === 'policy_blocked_command' ? 'high' : 'low',
    toolCall: null,
  };
}

export function buildTestProviderDecision(
  userPrompt: string,
  round?: 1 | 2 | 3
): SupervisorDecision {
  const scenarioId = getScenarioId(userPrompt);
  if (round === 1) {
    scenarioRound2Calls.set(scenarioKey(userPrompt), 0);
    return buildRound1Decision(scenarioId);
  }

  const key = scenarioKey(userPrompt);
  const callCount = scenarioRound2Calls.get(key) ?? 0;
  scenarioRound2Calls.set(key, callCount + 1);

  if (scenarioId === 'basic_file_create') {
    if (callCount === 0) {
      return {
        phase: 'act',
        workflow: 'code_change',
        instruction: 'Create the deterministic fizzbuzz file.',
        rationale: 'The scenario expects a concrete new file in the scratch workspace.',
        finalResponse: '',
        expectedEvidence: ['src/fizzbuzz.ts contains export function fizzBuzz'],
        riskLevel: 'low',
        toolCall: {
          name: 'apply_patch',
          arguments: {
            patchContent: [
              '--- /dev/null',
              '+++ b/src/fizzbuzz.ts',
              '@@ -0,0 +1,8 @@',
              '+export function fizzBuzz(value: number): string {',
              '+  if (value % 15 === 0) return "FizzBuzz";',
              '+  if (value % 3 === 0) return "Fizz";',
              '+  if (value % 5 === 0) return "Buzz";',
              '+  return String(value);',
              '+}',
              '+',
              '+export const fixtureLabel = "NIGHTWORKERS_BASIC_FILE_CREATE";',
              '',
            ].join('\n'),
          },
        },
      };
    }
    if (callCount === 1) {
      return {
        phase: 'verify',
        workflow: 'code_change',
        instruction: 'Verify the deterministic file content.',
        rationale: 'The final outcome should include verification evidence.',
        finalResponse: '',
        expectedEvidence: ['grep finds FizzBuzz in src/fizzbuzz.ts'],
        riskLevel: 'low',
        toolCall: {
          name: 'run_verification',
          arguments: {
            command: 'grep FizzBuzz src/fizzbuzz.ts',
            reason: 'Verify generated fizzbuzz implementation contains expected branch.',
            timeoutSeconds: 10,
          },
        },
      };
    }
    if (callCount === 2) {
      return {
        phase: 'act',
        workflow: 'code_change',
        instruction: 'Collect the workspace diff.',
        rationale: 'The harness asserts diff evidence from the run ledger.',
        finalResponse: '',
        expectedEvidence: ['git diff includes src/fizzbuzz.ts'],
        riskLevel: 'low',
        toolCall: { name: 'git_diff', arguments: {} },
      };
    }
    return {
      phase: 'stop',
      workflow: 'code_change',
      instruction: 'Basic file create scenario completed.',
      rationale: 'Patch, verification, and diff evidence are present.',
      finalResponse: makeLongFinalResponse(
        'Created src/fizzbuzz.ts and verified the expected FizzBuzz content.'
      ),
      expectedEvidence: ['src/fizzbuzz.ts', 'verification.finished', 'git diff'],
      terminalState: 'completed',
      riskLevel: 'low',
      toolCall: null,
    };
  }

  if (scenarioId === 'existing_file_edit_requires_read') {
    if (!hasObservation(userPrompt, 'tool=read_file')) {
      return {
        phase: 'act',
        workflow: 'code_change',
        instruction: 'Read the file before editing it.',
        rationale: 'The repository policy requires read-before-edit for existing files.',
        finalResponse: '',
        expectedEvidence: ['read_file src/greeting.txt'],
        riskLevel: 'low',
        toolCall: { name: 'read_file', arguments: { filePath: 'src/greeting.txt' } },
      };
    }
    if (!hasObservation(userPrompt, 'tool=apply_patch')) {
      return {
        phase: 'act',
        workflow: 'code_change',
        instruction: 'Patch the greeting after reading it.',
        rationale: 'Read-before-edit evidence has been collected.',
        finalResponse: '',
        expectedEvidence: ['src/greeting.txt contains read-before-edit fixture'],
        riskLevel: 'low',
        toolCall: {
          name: 'apply_patch',
          arguments: {
            patchContent: [
              '--- a/src/greeting.txt',
              '+++ b/src/greeting.txt',
              '@@ -1 +1,2 @@',
              '-TODO',
              '+Hello after read-before-edit',
              '+NIGHTWORKERS_READ_BEFORE_EDIT',
              '',
            ].join('\n'),
          },
        },
      };
    }
    return {
      phase: 'stop',
      workflow: 'code_change',
      instruction: 'Existing file edit scenario completed.',
      rationale: 'The edit happened only after read_file evidence.',
      finalResponse: makeLongFinalResponse(
        'Updated src/greeting.txt after reading the file first.'
      ),
      expectedEvidence: ['read_file before apply_patch', 'src/greeting.txt updated'],
      terminalState: 'completed',
      riskLevel: 'low',
      toolCall: null,
    };
  }

  if (scenarioId === 'ws_badge_color_update') {
    if (!hasObservation(userPrompt, 'tool=read_file')) {
      return {
        phase: 'act',
        workflow: 'code_change',
        instruction: 'Read the WS badge component before editing it.',
        rationale: 'The UI scenario should verify an actual file change with read evidence.',
        finalResponse: '',
        expectedEvidence: ['read_file src/WsBadge.tsx'],
        riskLevel: 'low',
        toolCall: { name: 'read_file', arguments: { filePath: 'src/WsBadge.tsx' } },
      };
    }
    if (!hasObservation(userPrompt, 'tool=apply_patch')) {
      return {
        phase: 'act',
        workflow: 'code_change',
        instruction: 'Patch the WS badge to render three status circles.',
        rationale: 'The harness asserts a UI-oriented diff, not just a generic file create.',
        finalResponse: '',
        expectedEvidence: ['src/WsBadge.tsx contains three status circles'],
        riskLevel: 'low',
        toolCall: {
          name: 'apply_patch',
          arguments: {
            patchContent: [
              '--- a/src/WsBadge.tsx',
              '+++ b/src/WsBadge.tsx',
              '@@ -1,3 +1,15 @@',
              ' export function WsBadge() {',
              '-  return <span>WS</span>;',
              '+  const states = [',
              '+    { label: "connected", color: "#16a34a" },',
              '+    { label: "connecting", color: "#f59e0b" },',
              '+    { label: "disconnected", color: "#dc2626" },',
              '+  ];',
              '+',
              '+  return (',
              '+    <div aria-label="WS status badge" className="ws-status-badge">',
              '+      {states.map((state) => (',
              '+        <span key={state.label} title={state.label} style={{ backgroundColor: state.color }} />',
              '+      ))}',
              '+    </div>',
              '+  );',
              ' }',
              '',
            ].join('\n'),
          },
        },
      };
    }
    return {
      phase: 'stop',
      workflow: 'code_change',
      instruction: 'WS badge UI scenario completed.',
      rationale: 'The component was read and patched with three status color circles.',
      finalResponse: makeLongFinalResponse(
        'Updated src/WsBadge.tsx so the WebSocket badge renders connected, connecting, and disconnected circles.'
      ),
      expectedEvidence: ['read_file before apply_patch', 'src/WsBadge.tsx updated'],
      terminalState: 'completed',
      riskLevel: 'low',
      toolCall: null,
    };
  }

  if (scenarioId === 'policy_blocked_command') {
    return {
      phase: 'act',
      workflow: 'general',
      instruction: 'Attempt a command that must be blocked before execution.',
      rationale:
        'The scenario verifies ToolPolicyGate distinguishes policy blocks from tool failures.',
      finalResponse: '',
      expectedEvidence: ['tool.policy_blocked'],
      riskLevel: 'high',
      toolCall: {
        name: 'run_command',
        arguments: {
          command: 'rm -rf .',
          timeoutSeconds: 5,
        },
      },
    };
  }

  if (callCount === 0) {
    return {
      phase: 'act',
      workflow: 'code_change',
      instruction: 'Create a file that verification will reject.',
      rationale: 'The harness verifies failed checks do not become completed outcomes.',
      finalResponse: '',
      expectedEvidence: ['src/failing-check.txt created'],
      riskLevel: 'medium',
      toolCall: {
        name: 'apply_patch',
        arguments: {
          patchContent: [
            '--- /dev/null',
            '+++ b/src/failing-check.txt',
            '@@ -0,0 +1 @@',
            '+NIGHTWORKERS_VERIFICATION_FAILURE',
            '',
          ].join('\n'),
        },
      },
    };
  }
  if (callCount === 1) {
    return {
      phase: 'verify',
      workflow: 'code_change',
      instruction: 'Run a deterministic failing verification.',
      rationale: 'grep returns non-zero when the required text is missing.',
      finalResponse: '',
      expectedEvidence: ['failed verification event'],
      riskLevel: 'medium',
      toolCall: {
        name: 'run_verification',
        arguments: {
          command: 'grep SHOULD_NOT_EXIST src/failing-check.txt',
          reason: 'Intentional failing verification for outcome harness.',
          timeoutSeconds: 10,
        },
      },
    };
  }
  return {
    phase: 'stop',
    workflow: 'code_change',
    instruction: 'Verification failure scenario needs human follow-up.',
    rationale: 'The latest verification failed and must not be reported as unqualified success.',
    finalResponse: makeLongFinalResponse(
      'Verification failed for src/failing-check.txt; this run requires human follow-up instead of completion.'
    ),
    expectedEvidence: ['run_verification failed', 'needs_human'],
    terminalState: 'needs_human',
    riskLevel: 'high',
    toolCall: null,
  };
}
