import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const repo = vi.hoisted(() => ({
	getReviewFinding: vi.fn(),
	updateReviewFindingDisposition: vi.fn(),
	getReviewSession: vi.fn(),
	getReviewPromptSuggestionByFinding: vi.fn(),
	createReviewPromptSuggestion: vi.fn(),
	createReviewSecurityHandoff: vi.fn(),
	upsertReviewArtifact: vi.fn(),
	listReviewFindings: vi.fn(),
	listReviewPromptSuggestions: vi.fn(),
	getReviewPromptSuggestion: vi.fn(),
	updateReviewPromptSuggestion: vi.fn(),
}));

const reviewMode = vi.hoisted(() => ({
	getReviewSessionDetail: vi.fn(),
}));

vi.mock("../api/modules/review/review-mode.repository", () => repo);
vi.mock("../api/modules/review/review-mode.service", () => reviewMode);

import {
	createReviewPromptSuggestions,
	setReviewFindingDisposition,
	updateReviewPromptSuggestion,
	useReviewPromptSuggestion,
} from "../api/modules/review/review-finding-actions.service";

const changedFileRef = {
	kind: "changed_file" as const,
	path: "src/secure.ts",
	label: "secure source",
};

function finding(overrides: Record<string, unknown> = {}) {
	return {
		id: "finding-1",
		reviewSessionId: "session-1",
		runId: "run-1",
		taskId: "task-1",
		title: "Validate authorization",
		body: "Authorization is incomplete",
		severity: "blocking",
		disposition: null,
		dispositionStatus: "unresolved",
		evidenceRefsJson: [changedFileRef],
		...overrides,
	};
}

function suggestion(overrides: Record<string, unknown> = {}) {
	return {
		id: "suggestion-1",
		findingId: "finding-1",
		reviewSessionId: "session-1",
		runId: "run-1",
		taskId: "task-1",
		repositoryId: "repo-1",
		title: "Additional work",
		prompt: "fix it",
		expectedOutcome: "fixed",
		acceptanceCriteria: "verified",
		verificationHint: "run tests",
		evidenceRefsJson: [changedFileRef],
		status: "draft",
		useCount: 2,
		createdMessageId: null,
		createdAt: new Date("2026-01-01T00:00:00Z"),
		updatedAt: new Date("2026-01-01T00:00:00Z"),
		...overrides,
	};
}

describe("review finding actions coverage", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		delete process.env.NIGHTWORKERS_SECURITY_PLUGIN_INTEGRATION;
		repo.getReviewFinding.mockResolvedValue(finding());
		repo.getReviewSession.mockResolvedValue({
			id: "session-1",
			runId: "run-1",
			taskId: "task-1",
			repositoryId: "repo-1",
		});
		repo.getReviewPromptSuggestionByFinding.mockResolvedValue(null);
		repo.createReviewPromptSuggestion.mockResolvedValue(suggestion());
		repo.listReviewFindings.mockResolvedValue([]);
		repo.listReviewPromptSuggestions.mockResolvedValue([]);
		reviewMode.getReviewSessionDetail.mockResolvedValue({ id: "session-1" });
	});

	afterEach(() => {
		delete process.env.NIGHTWORKERS_SECURITY_PLUGIN_INTEGRATION;
	});

	it("rejects missing findings and invalid risk dispositions", async () => {
		repo.getReviewFinding.mockResolvedValueOnce(null);
		await expect(
			setReviewFindingDisposition("session-1", "missing", {
				disposition: "human_callout",
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });

		for (const disposition of ["accepted_risk", "ignored"] as const) {
			await expect(
				setReviewFindingDisposition("session-1", "finding-1", {
					disposition,
					note: "   ",
				}),
			).rejects.toMatchObject({ code: "FINDING_DISPOSITION_NOTE_REQUIRED" });
		}

		repo.getReviewFinding.mockResolvedValueOnce(
			finding({ evidenceRefsJson: null }),
		);
		await expect(
			setReviewFindingDisposition("session-1", "finding-1", {
				disposition: "accepted_risk",
				note: "Reviewed by the owner",
			}),
		).rejects.toMatchObject({ code: "ACCEPTED_RISK_EVIDENCE_REQUIRED" });
	});

	it("maps ordinary dispositions and evidence overrides", async () => {
		await setReviewFindingDisposition("session-1", "finding-1", {
			disposition: "accepted_risk",
			note: "  owner approved  ",
			evidenceRefs: [changedFileRef],
		});
		expect(repo.updateReviewFindingDisposition).toHaveBeenLastCalledWith(
			"finding-1",
			expect.objectContaining({
				dispositionStatus: "accepted",
				dispositionNote: "owner approved",
				evidenceRefsJson: [changedFileRef],
			}),
		);

		await setReviewFindingDisposition("session-1", "finding-1", {
			disposition: "ignored",
			note: "not applicable",
		});
		expect(repo.updateReviewFindingDisposition).toHaveBeenLastCalledWith(
			"finding-1",
			expect.objectContaining({ dispositionStatus: "dismissed" }),
		);

		await setReviewFindingDisposition("session-1", "finding-1", {
			disposition: "agent_followup",
		});
		expect(repo.updateReviewFindingDisposition).toHaveBeenLastCalledWith(
			"finding-1",
			expect.objectContaining({
				dispositionStatus: "converted",
				dispositionNote: null,
				evidenceRefsJson: undefined,
			}),
		);

		await setReviewFindingDisposition("session-1", "finding-1", {
			disposition: "human_callout",
		});
		expect(repo.updateReviewFindingDisposition).toHaveBeenLastCalledWith(
			"finding-1",
			expect.objectContaining({ dispositionStatus: "accepted" }),
		);
	});

	it("creates and reuses a normal prompt suggestion", async () => {
		const existing = suggestion({ id: "existing-1" });
		repo.getReviewPromptSuggestionByFinding.mockResolvedValue(existing);

		await setReviewFindingDisposition("session-1", "finding-1", {
			disposition: "prompt_suggestion",
			note: "continue the session",
		});

		expect(repo.createReviewPromptSuggestion).toHaveBeenCalledWith(
			expect.objectContaining({
				title: "追加対応: Validate authorization",
				prompt: expect.stringContaining("Authorization is incomplete"),
				repositoryId: "repo-1",
			}),
		);
		expect(repo.updateReviewFindingDisposition).toHaveBeenCalledWith(
			"finding-1",
			expect.objectContaining({ createdGoalId: "existing-1" }),
		);
	});

	it.each([
		[
			"Test evidence not confirmed for acceptance criterion: login works",
			"受け入れ条件:\nログインできる\n\n確認した範囲:\n- tests/login.test.ts",
			"受け入れ条件のテスト証跡を確認できません",
			"ログインできる",
		],
		[
			"Test evidence review is unclear for acceptance criterion: save works",
			"確認した範囲:\n詳細なし",
			"受け入れ条件のテスト証跡が判断不能です",
			"save works",
		],
		[
			"Agentic test evidence review could not complete",
			null,
			"テスト証跡確認を完了できません",
			"Agentic test evidence review could not complete",
		],
	])("formats test-evidence prompt suggestions for %s", async (title, body, expectedTitle, criterion) => {
		repo.getReviewFinding.mockResolvedValue(finding({ title, body }));

		await setReviewFindingDisposition("session-1", "finding-1", {
			disposition: "prompt_suggestion",
			evidenceRefs: [changedFileRef],
		});

		expect(repo.createReviewPromptSuggestion).toHaveBeenCalledWith(
			expect.objectContaining({
				title: `改善依頼 Prompt: ${expectedTitle}`,
				prompt: expect.stringContaining(String(criterion)),
			}),
		);
	});

	it("requires evidence and a session for prompt suggestions", async () => {
		repo.getReviewFinding.mockResolvedValueOnce(
			finding({ evidenceRefsJson: [] }),
		);
		await expect(
			setReviewFindingDisposition("session-1", "finding-1", {
				disposition: "prompt_suggestion",
			}),
		).rejects.toMatchObject({
			code: "REVIEW_PROMPT_SUGGESTION_EVIDENCE_REQUIRED",
		});

		repo.getReviewSession.mockResolvedValueOnce(null);
		await expect(
			setReviewFindingDisposition("session-1", "finding-1", {
				disposition: "prompt_suggestion",
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("creates security handoffs with and without an integration", async () => {
		await setReviewFindingDisposition("session-1", "finding-1", {
			disposition: "security_plugin_handoff",
		});
		expect(repo.createReviewSecurityHandoff).toHaveBeenLastCalledWith(
			expect.objectContaining({
				requestedIntegration: null,
				status: "needs_configuration",
				changedPathsJson: ["src/secure.ts"],
			}),
		);
		expect(repo.upsertReviewArtifact).toHaveBeenLastCalledWith(
			expect.objectContaining({ status: "needs_human" }),
		);

		process.env.NIGHTWORKERS_SECURITY_PLUGIN_INTEGRATION = "  snyk  ";
		repo.getReviewFinding.mockResolvedValueOnce(
			finding({ body: null, evidenceRefsJson: null }),
		);
		await setReviewFindingDisposition("session-1", "finding-1", {
			disposition: "security_plugin_handoff",
			evidenceRefs: [changedFileRef],
		});
		expect(repo.createReviewSecurityHandoff).toHaveBeenLastCalledWith(
			expect.objectContaining({
				requestedIntegration: "snyk",
				status: "requested",
				summary: "Validate authorization",
			}),
		);
		expect(repo.upsertReviewArtifact).toHaveBeenLastCalledWith(
			expect.objectContaining({ status: "done" }),
		);

		repo.getReviewSession.mockResolvedValueOnce(null);
		await expect(
			setReviewFindingDisposition("session-1", "finding-1", {
				disposition: "security_plugin_handoff",
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("creates only eligible prompt suggestions within the active draft cap", async () => {
		repo.listReviewPromptSuggestions
			.mockResolvedValueOnce([
				suggestion({ id: "existing", findingId: "already", status: "draft" }),
				suggestion({ id: "used", findingId: "used-finding", status: "used" }),
			])
			.mockResolvedValueOnce([
				suggestion({ id: "created", findingId: "eligible" }),
			]);
		repo.listReviewFindings.mockResolvedValue([
			finding({ id: "already" }),
			finding({ id: "no-evidence", evidenceRefsJson: [] }),
			finding({ id: "info", severity: "info" }),
			finding({ id: "eligible" }),
			finding({ id: "explicit", disposition: "prompt_suggestion" }),
		]);
		repo.createReviewPromptSuggestion
			.mockResolvedValueOnce(suggestion({ id: "new-1", findingId: "eligible" }))
			.mockResolvedValueOnce(
				suggestion({ id: "new-2", findingId: "explicit" }),
			);

		await createReviewPromptSuggestions("session-1");

		expect(repo.createReviewPromptSuggestion).toHaveBeenCalledTimes(2);
		expect(repo.updateReviewFindingDisposition).toHaveBeenCalledTimes(2);
		expect(repo.upsertReviewArtifact).toHaveBeenCalledWith(
			expect.objectContaining({
				kind: "prompt_suggestions",
				artifactJson: expect.objectContaining({ version: 1 }),
			}),
		);
	});

	it("honors a full draft cap and reports a missing artifact session", async () => {
		repo.listReviewFindings.mockResolvedValue([finding()]);
		repo.listReviewPromptSuggestions.mockResolvedValue(
			Array.from({ length: 5 }, (_, index) =>
				suggestion({ id: `draft-${index}` }),
			),
		);
		await createReviewPromptSuggestions("session-1");
		expect(repo.createReviewPromptSuggestion).not.toHaveBeenCalled();

		repo.getReviewSession.mockResolvedValueOnce(null);
		await expect(
			createReviewPromptSuggestions("session-1"),
		).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
	});

	it("dismisses and uses prompt suggestions", async () => {
		repo.getReviewPromptSuggestion.mockResolvedValue(suggestion());
		repo.listReviewPromptSuggestions.mockResolvedValue([suggestion()]);

		await updateReviewPromptSuggestion("session-1", "suggestion-1", {
			status: "dismissed",
		});
		expect(repo.updateReviewPromptSuggestion).toHaveBeenLastCalledWith(
			"suggestion-1",
			expect.objectContaining({
				status: "dismissed",
				dismissedAt: expect.any(Date),
			}),
		);

		await useReviewPromptSuggestion("session-1", "suggestion-1", {
			createdMessageId: "message-1",
		});
		expect(repo.updateReviewPromptSuggestion).toHaveBeenLastCalledWith(
			"suggestion-1",
			expect.objectContaining({
				status: "used",
				useCount: 3,
				createdMessageId: "message-1",
				lastUsedAt: expect.any(Date),
			}),
		);

		await useReviewPromptSuggestion("session-1", "suggestion-1");
		expect(repo.updateReviewPromptSuggestion).toHaveBeenLastCalledWith(
			"suggestion-1",
			expect.objectContaining({ createdMessageId: null }),
		);
	});

	it("rejects missing prompt suggestions", async () => {
		repo.getReviewPromptSuggestion.mockResolvedValue(null);
		await expect(
			updateReviewPromptSuggestion("session-1", "missing", {
				status: "dismissed",
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		await expect(
			useReviewPromptSuggestion("session-1", "missing"),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
});
