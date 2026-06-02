import fs from 'node:fs/promises';
import path from 'node:path';
import { expect } from '@playwright/test';
import type { RunDetails, RunEvent } from './api-fixtures';
import type { AgentOutcomeScenario } from './scenarios';

function canonicalType(event: RunEvent): string | null {
  const runEvent = event.payloadJson?.runEvent as { type?: unknown } | undefined;
  if (typeof runEvent?.type === 'string') return runEvent.type;
  return event.eventType || event.type || null;
}

function eventTypes(events: RunEvent[]): string[] {
  return events.map(canonicalType).filter((type): type is string => Boolean(type));
}

export function assertRunOutcome(run: RunDetails, scenario: AgentOutcomeScenario) {
  const actualTypes = eventTypes(run.events);
  expect(
    run.status,
    `run=${run.id} expected status=${scenario.expected.runStatus} actual=${run.status} events=${actualTypes.join(
      ', '
    )}`
  ).toBe(scenario.expected.runStatus);

  for (const text of scenario.expected.finalReportExcludes || []) {
    expect(
      run.finalReport || '',
      `run=${run.id} final report must not include ${text}`
    ).not.toContain(text);
  }
}

export function assertRunLedger(run: RunDetails, scenario: AgentOutcomeScenario) {
  const legacyTypes = run.events
    .map((event) => event.eventType || event.type || '')
    .filter(Boolean);
  const canonicalTypes = eventTypes(run.events);

  for (const required of scenario.expected.requiredEventTypes || []) {
    expect(
      legacyTypes,
      `run=${run.id} missing legacy event=${required}; actual=${legacyTypes.join(', ')}`
    ).toContain(required);
  }

  for (const required of scenario.expected.requiredRunEventTypes || []) {
    expect(
      canonicalTypes,
      `run=${run.id} missing canonical event=${required}; actual=${canonicalTypes.join(', ')}`
    ).toContain(required);
  }
}

export async function assertWorkspaceState(workspacePath: string, scenario: AgentOutcomeScenario) {
  for (const assertion of scenario.expected.fileAssertions || []) {
    const content = await fs.readFile(path.join(workspacePath, assertion.path), 'utf-8');
    for (const expected of assertion.includes || []) {
      expect(content, `${assertion.path} should include ${expected}`).toContain(expected);
    }
    for (const rejected of assertion.excludes || []) {
      expect(content, `${assertion.path} should not include ${rejected}`).not.toContain(rejected);
    }
  }
}

export function assertDiffEvidence(diff: string, run: RunDetails, scenario: AgentOutcomeScenario) {
  const changedFiles = scenario.expected.changedFiles || [];
  if (changedFiles.length === 0) {
    expect(diff.trim(), `scenario=${scenario.id} expected clean diff`).toBe('');
    return;
  }

  for (const file of changedFiles) {
    expect(diff, `workspace diff should include ${file}`).toContain(file);
    expect(run.diffPatch || diff, `run diffPatch should include ${file}`).toContain(file);
  }
}

export function assertReviewResult(
  reviewResponse: { status: string; reviewResult?: Record<string, unknown> },
  runAfterReview: RunDetails,
  scenario: AgentOutcomeScenario
) {
  if (!scenario.expected.review) return;
  expect(reviewResponse.status).toBe(scenario.expected.review.finalStatus);
  expect(runAfterReview.reviews || []).toHaveLength(1);
  expect(
    runAfterReview.events.some((event) => canonicalType(event) === 'human.review_submitted')
  ).toBe(true);
}

export function assertJsonlExport(jsonl: string, run: RunDetails) {
  const lines = jsonl
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as { type: string; seq?: number; event?: { type?: string } });
  expect(lines[0]?.type).toBe('nightworkers_run');
  expect(lines.at(-1)?.type).toBe('run_summary');
  const eventLines = lines.filter((line) => line.type === 'run_event');
  expect(eventLines.length).toBeGreaterThan(0);
  expect(eventLines.some((line) => line.event?.type === 'run.outcome_decided')).toBe(true);
  const seqs = eventLines
    .map((line) => line.seq)
    .filter((seq): seq is number => typeof seq === 'number');
  expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
  expect(jsonl).toContain(run.id);
}
