import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("ThreadWorkspace header", () => {
	it("does not render an ambiguous session-state spinner beside the debug button", () => {
		const source = readFileSync(
			"src/modules/nightworkers/components/ThreadWorkspaceHeader.tsx",
			"utf8",
		);

		expect(source).not.toContain("SessionStateMarker");
		expect(source).not.toContain("activeSessionView");
		expect(source).not.toContain('aria-label="実行中"');
		expect(source).toContain("Do not add a session-state spinner here");
	});

	it("does not advertise missing Blueprint artifacts as a chat-backed create action", () => {
		const workspaceSource = readFileSync(
			"src/modules/nightworkers/components/ThreadWorkspaceHeader.tsx",
			"utf8",
		);
		const shellSource = readFileSync(
			"src/modules/nightworkers/components/NightWorkersShell.tsx",
			"utf8",
		);

		expect(workspaceSource).not.toContain("Create Blueprint artifact");
		expect(workspaceSource).toContain("plan: Boolean(blueprintArtifact)");
		expect(workspaceSource).toContain("review: props.hasReviewArtifact");
		expect(workspaceSource).toContain(
			"evidence: props.hasEvidenceCheckArtifact",
		);
		expect(shellSource).not.toContain(
			"sendWorkbenchMessage(session.id, prompt, 'draft_spec')",
		);
	});

	it("keeps review actions locked while the Coding Agent result is pending", () => {
		const panelSource = readFileSync(
			"src/modules/nightworkers/components/NightWorkersShellThreadPanel.tsx",
			"utf8",
		);

		expect(panelSource).toContain(
			"isReviewPromptDisabled={workspace.isAgentThinking}",
		);
		expect(panelSource).not.toContain(
			"isReviewPromptDisabled={workspace.isAgentWorking}",
		);
	});

	it("starts implementation from the TODO artifact while keeping queue add separate", () => {
		const shellSource = readFileSync(
			"src/modules/nightworkers/components/NightWorkersShell.tsx",
			"utf8",
		);
		const workspaceSource = readFileSync(
			"src/modules/nightworkers/components/ThreadWorkspace.tsx",
			"utf8",
		);

		expect(shellSource).toContain("startSessionAndFocusTodo");
		expect(shellSource).toContain("await current.startRun(sessionId);");
		expect(shellSource).toMatch(
			/setArtifactFocus\(\{\s*type:\s*['"]todo['"]\s*\}\);/,
		);
		expect(shellSource).toContain("queueSessionAndFocusTodo");
		expect(shellSource).toContain(
			"await queueState.createImplementationQueueEntry(sessionId);",
		);
		expect(workspaceSource).toContain("onOpenTodoArtifact");
		expect(workspaceSource).not.toContain("nightworkers-thread-side-panel");
		const queueAction = shellSource.indexOf(
			"await createImplementationQueueEntryWithMissionApproval(sessionId);",
		);
		const todoFocusAfterQueue = shellSource.indexOf(
			'setArtifactFocus({ type: "todo" });',
			queueAction,
		);
		expect(queueAction).toBeGreaterThanOrEqual(0);
		expect(todoFocusAfterQueue).toBeGreaterThan(queueAction);
	});

	it("opens restored questionnaire workspaces on Status instead of Questionnaire", () => {
		const questionnaireSource = readFileSync(
			"src/modules/nightworkers/components/useNightWorkersQuestionnaire.ts",
			"utf8",
		);
		const panelSource = readFileSync(
			"src/modules/nightworkers/components/NightWorkersShellThreadPanel.tsx",
			"utf8",
		);

		expect(questionnaireSource).toContain(
			"resolveQuestionnaireReadyInitialTab(latestQuestionnaireMessage)",
		);
		expect(panelSource).toContain("existingQuestionnaireMessageIds");
		expect(panelSource).toContain(
			"!existingQuestionnaireMessageIds.has(message.id)",
		);
		expect(panelSource).toContain("if (!result?.run)");
	});

	it("shows the plan route before implementation in the composer model selector", () => {
		const shellSource = readFileSync(
			"src/modules/nightworkers/components/nightworkers-shell-utils.ts",
			"utf8",
		);

		const roleRegex =
			/const roles = \s*\[\s*(['"])plan\1\s*,\s*\1implementation\1\s*\]\s*as\s*const\s*;/;
		const rolePriority = shellSource.search(roleRegex);
		expect(rolePriority).toBeGreaterThanOrEqual(0);
		expect(rolePriority).toBeLessThan(
			shellSource.indexOf("for (const role of roles)"),
		);
	});
});
