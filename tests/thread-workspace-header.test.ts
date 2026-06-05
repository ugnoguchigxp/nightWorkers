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
    expect(workspaceSource).toContain('No Blueprint artifact');
    expect(workspaceSource).toContain('!blueprintArtifact');
    expect(shellSource).not.toContain("sendWorkbenchMessage(session.id, prompt, 'draft_spec')");
  });
});
