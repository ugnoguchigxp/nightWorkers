import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('ThreadWorkspace header', () => {
  it('does not render an ambiguous session-state spinner beside the debug button', () => {
    const source = readFileSync('src/modules/nightworkers/components/ThreadWorkspace.tsx', 'utf8');

    expect(source).not.toContain('SessionStateMarker');
    expect(source).not.toContain('activeSessionView');
    expect(source).not.toContain('aria-label="実行中"');
    expect(source).toContain('Do not add a session-state spinner here');
  });

  it('does not advertise missing Blueprint artifacts as a chat-backed create action', () => {
    const workspaceSource = readFileSync(
      'src/modules/nightworkers/components/ThreadWorkspace.tsx',
      'utf8'
    );
    const shellSource = readFileSync(
      'src/modules/nightworkers/components/NightWorkersShell.tsx',
      'utf8'
    );

    expect(workspaceSource).not.toContain('Create Blueprint artifact');
    expect(workspaceSource).toContain('noSpecificationWorkspaceLabel');
    expect(workspaceSource).toContain('!blueprintArtifact');
    expect(shellSource).not.toContain("sendWorkbenchMessage(session.id, prompt, 'draft_spec')");
  });

  it('focuses the TODO artifact when implementation is queued', () => {
    const shellSource = readFileSync(
      'src/modules/nightworkers/components/NightWorkersShell.tsx',
      'utf8'
    );
    const workspaceSource = readFileSync(
      'src/modules/nightworkers/components/ThreadWorkspace.tsx',
      'utf8'
    );

    expect(shellSource).toContain("setArtifactFocus({ type: 'todo' });");
    expect(shellSource).toContain('queueSessionAndFocusTodo');
    expect(workspaceSource).toContain('onOpenTodoArtifact');
    expect(workspaceSource).not.toContain('nightworkers-thread-side-panel');
  });

  it('opens restored questionnaire workspaces on Status instead of Questionnaire', () => {
    const shellSource = readFileSync(
      'src/modules/nightworkers/components/NightWorkersShell.tsx',
      'utf8'
    );

    expect(shellSource).toContain(
      "void openQuestionnaireWorkspace(latestQuestionnaireMessage, 'status');"
    );
    expect(shellSource).toContain(
      "void openQuestionnaireWorkspace(latestQuestionnaireMessage, 'questionnaire');"
    );
  });

  it('shows the plan route before implementation in the composer model selector', () => {
    const shellSource = readFileSync(
      'src/modules/nightworkers/components/NightWorkersShell.tsx',
      'utf8'
    );

    const rolePriority = shellSource.indexOf("const roles = ['plan', 'implementation'] as const;");
    expect(rolePriority).toBeGreaterThanOrEqual(0);
    expect(rolePriority).toBeLessThan(shellSource.indexOf('for (const role of roles)'));
  });
});
