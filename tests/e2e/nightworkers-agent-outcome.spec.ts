import { type APIRequestContext, expect, test } from '@playwright/test';
import {
  cleanupScenarioRecords,
  createRepositoryForWorkspace,
  createTaskForScenario,
  fetchJsonlExport,
  fetchRunDetails,
  fetchTaskDetails,
  pollRunUntilTerminal,
  type RunDetails,
  type ScenarioHandles,
  startRun,
  submitReview,
} from './agent-outcome/api-fixtures';
import { collectFailureArtifacts } from './agent-outcome/artifacts';
import {
  assertDiffEvidence,
  assertJsonlExport,
  assertReviewResult,
  assertRunLedger,
  assertRunOutcome,
  assertWorkspaceState,
} from './agent-outcome/assertions';
import { type AgentOutcomeScenario, agentOutcomeScenarios } from './agent-outcome/scenarios';
import { createScratchWorkspace, type ScratchWorkspace } from './agent-outcome/workspace';

async function runScenario(request: APIRequestContext, scenario: AgentOutcomeScenario) {
  const workspace = await createScratchWorkspace(scenario);
  const handles: Partial<ScenarioHandles> = {};
  let terminalRun: RunDetails | undefined;

  try {
    const repository = await createRepositoryForWorkspace(request, scenario, workspace.path);
    handles.repositoryId = repository.id;
    const task = await createTaskForScenario(request, scenario, repository.id);
    handles.taskId = task.id;
    const run = await startRun(request, task.id);
    handles.runId = run.id;
    terminalRun = await pollRunUntilTerminal(request, run.id);

    assertRunOutcome(terminalRun, scenario);
    assertRunLedger(terminalRun, scenario);
    await assertWorkspaceState(workspace.path, scenario);
    assertDiffEvidence(workspace.diff(), terminalRun, scenario);
    if (!scenario.expected.review) {
      const taskAfterRun = await fetchTaskDetails(request, task.id);
      expect(taskAfterRun.status).toBe(scenario.expected.taskStatus);
    }

    return { workspace, handles, terminalRun };
  } catch (err) {
    const artifactPath = await collectFailureArtifacts({
      request,
      scenarioId: scenario.id,
      workspacePath: workspace.path,
      handles,
      runDetails: terminalRun,
    });
    await cleanupScenarioRecords(request, handles);
    await workspace.cleanup();
    throw new Error(
      `${err instanceof Error ? err.message : String(err)}\nArtifacts: ${artifactPath}`
    );
  }
}

async function cleanup(
  request: APIRequestContext,
  result: {
    workspace: ScratchWorkspace;
    handles: Partial<ScenarioHandles>;
  }
) {
  await cleanupScenarioRecords(request, result.handles);
  await result.workspace.cleanup();
}

test.describe('NightWorkers Agent Outcome Harness @regression', () => {
  test.describe.configure({ mode: 'serial' });

  test('basic file create reaches needs_review and completes after review @smoke', async ({
    page,
    request,
  }) => {
    test.setTimeout(70000);
    const scenario = agentOutcomeScenarios.basicFileCreate;
    const result = await runScenario(request, scenario);
    try {
      await page.goto(`/tasks/${result.handles.taskId}`);
      await expect(
        page.getByRole('heading', { name: `Agent outcome ${scenario.title}` })
      ).toBeVisible();

      const review = await submitReview(
        request,
        result.handles.runId as string,
        scenario.expected.review?.action || 'complete'
      );
      const reviewedRun = await fetchRunDetails(request, result.handles.runId as string);
      assertReviewResult(review, reviewedRun, scenario);
      const reviewedTask = await fetchTaskDetails(request, result.handles.taskId as string);
      expect(reviewedTask.status).toBe(scenario.expected.taskStatus);
      const jsonl = await fetchJsonlExport(request, result.handles.runId as string);
      assertJsonlExport(jsonl, reviewedRun);
    } finally {
      await cleanup(request, result);
    }
  });

  test('existing file edit reads before patching @regression', async ({ request }) => {
    test.setTimeout(70000);
    const scenario = agentOutcomeScenarios.existingFileEditRequiresRead;
    const result = await runScenario(request, scenario);
    try {
      const readEventIndex = result.terminalRun.events.findIndex(
        (event) => event.eventType === 'tool_result' && event.payloadJson?.toolName === 'read_file'
      );
      const patchEventIndex = result.terminalRun.events.findIndex(
        (event) =>
          event.eventType === 'tool_result' && event.payloadJson?.toolName === 'apply_patch'
      );
      expect(readEventIndex).toBeGreaterThanOrEqual(0);
      expect(patchEventIndex).toBeGreaterThan(readEventIndex);
      const review = await submitReview(request, result.handles.runId as string, 'complete');
      const reviewedRun = await fetchRunDetails(request, result.handles.runId as string);
      assertReviewResult(review, reviewedRun, scenario);
      const reviewedTask = await fetchTaskDetails(request, result.handles.taskId as string);
      expect(reviewedTask.status).toBe(scenario.expected.taskStatus);
    } finally {
      await cleanup(request, result);
    }
  });

  test('policy blocked command records needs_human @regression', async ({ request }) => {
    test.setTimeout(70000);
    const scenario = agentOutcomeScenarios.policyBlockedCommand;
    const result = await runScenario(request, scenario);
    try {
      expect(result.terminalRun.finalReport || '').toContain('Tool policy blocked');
      expect(result.workspace.diff().trim()).toBe('');
    } finally {
      await cleanup(request, result);
    }
  });

  test('verification failure is not auto-completed @regression', async ({ request }) => {
    test.setTimeout(70000);
    const scenario = agentOutcomeScenarios.verificationFailure;
    const result = await runScenario(request, scenario);
    try {
      expect(result.terminalRun.status).toBe('needs_human');
      expect(result.terminalRun.finalReport || '').toContain('Verification failed');
      const review = await submitReview(
        request,
        result.handles.runId as string,
        'request_follow_up'
      );
      const reviewedRun = await fetchRunDetails(request, result.handles.runId as string);
      assertReviewResult(review, reviewedRun, scenario);
      const reviewedTask = await fetchTaskDetails(request, result.handles.taskId as string);
      expect(reviewedTask.status).toBe(scenario.expected.taskStatus);
    } finally {
      await cleanup(request, result);
    }
  });
});
