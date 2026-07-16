import fs from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { createDisposableGitWorkspace } from "./helpers";

const headers = {
	Origin: `http://localhost:${process.env.NIGHTWORKERS_E2E_WEB_PORT || 39274}`,
	"x-nightworkers-e2e": "1",
};

test("Play posts the initial prompt and preserves the 20-second Questionnaire auto-answer UI", {
	tag: [
		"@deterministic",
		"@p0",
		"@regression",
		"@scenario:NW-E2E-MISSION-PILOT-QUESTIONNAIRE-001",
	],
}, async ({ page, request }) => {
	test.setTimeout(70_000);
	const objective = "初期プロンプトからQuestionnaireを自動回答する";
	const { workspace } = await createDisposableGitWorkspace({
		prefix: "mission-pilot-agent-questionnaire-",
	});
	const repositoryResponse = await request.post("/api/repositories", {
		headers,
		data: {
			name: "Mission Pilot agent Questionnaire",
			localPath: workspace,
			branch: "main",
			allowed: true,
		},
	});
	expect(repositoryResponse.status(), await repositoryResponse.text()).toBe(
		201,
	);
	const repositoryId = ((await repositoryResponse.json()) as { id: string }).id;
	let taskId = "";
	try {
		const taskResponse = await request.post("/api/tasks", {
			headers,
			data: {
				repositoryId,
				title: "Mission Pilot agent Questionnaire flow",
				description: "既存UIと自動回答経路を確認する",
				objective,
				acceptanceCriteria:
					"初期投稿、回答案、20秒待機、自動確定が同じUIで確認できる",
				timeoutSeconds: 60,
			},
		});
		expect(taskResponse.status(), await taskResponse.text()).toBe(201);
		taskId = ((await taskResponse.json()) as { id: string }).id;
		const fixtureResponse = await request.post(
			"/api/e2e/fixtures/mission-pilot-agent-questionnaire",
			{ headers, data: { taskId } },
		);
		expect(fixtureResponse.status(), await fixtureResponse.text()).toBe(201);
		const { questionnaireSessionId } = (await fixtureResponse.json()) as {
			questionnaireSessionId: string;
		};

		await page.goto(`/sessions/${taskId}`);
		await page
			.locator(".mission-pilot-composer-controls")
			.getByRole("button", { name: "Mission Pilotを再生", exact: true })
			.click();
		await expect(
			page.locator(".nightworkers-chat-window").getByText(objective, {
				exact: true,
			}),
		).toBeVisible();

		let draft: QuestionnaireDraft | null = null;
		await expect
			.poll(
				async () => {
					const response = await request.get(
						`/api/mission-pilot/tasks/${taskId}/questionnaire-draft`,
						{ headers },
					);
					expect(response.status(), await response.text()).toBe(200);
					draft = (await response.json()) as QuestionnaireDraft | null;
					return draft?.state;
				},
				{ timeout: 15_000 },
			)
			.toBe("waiting_user");
		expect(draft).toMatchObject({
			questionnaireSessionId,
			answers: [{ questionId: "api-style", selectedOptionIds: ["rest"] }],
			answerEvidence: {
				"api-style": { source: "mission_pilot" },
			},
		});
		const remainingMs = new Date(draft?.deadlineAt ?? 0).getTime() - Date.now();
		expect(remainingMs).toBeGreaterThan(15_000);
		expect(remainingMs).toBeLessThanOrEqual(20_000);

		const countdown = page.locator(
			"[data-mission-pilot-questionnaire-countdown]",
		);
		await expect(countdown).toContainText("Mission Pilotの回答案を表示中");
		await expect(countdown).toContainText("自動確定します");
		await expect(countdown).toContainText(/\d+秒/);
		await expect(page.locator(".mission-pilot-countdown")).toContainText(
			/00:\d{2}/,
		);
		await expect(page.getByRole("radio", { name: /REST/ })).toBeChecked();
		await expect(
			page.locator('[data-answer-evidence="mission_pilot"]'),
		).toContainText("RESTを選択します");

		await expect
			.poll(
				async () => {
					const response = await request.get(
						`/api/mission-pilot/tasks/${taskId}/questionnaire-draft`,
						{ headers },
					);
					draft = (await response.json()) as QuestionnaireDraft | null;
					return draft?.state;
				},
				{ timeout: 30_000 },
			)
			.toBe("submitted");
		await expect(
			page.locator("[data-mission-pilot-questionnaire-submitted]"),
		).toBeVisible({ timeout: 10_000 });

		const questionnairesResponse = await request.get(
			`/api/tasks/${taskId}/design-questionnaire`,
			{ headers },
		);
		expect(
			questionnairesResponse.status(),
			await questionnairesResponse.text(),
		).toBe(200);
		const questionnaires = (await questionnairesResponse.json()) as Array<{
			id: string;
			status: string;
			answers: Array<{ questionId: string; answer: QuestionnaireAnswer }>;
		}>;
		expect(
			questionnaires.find((item) => item.id === questionnaireSessionId),
		).toMatchObject({
			status: "review_ready",
			answers: [
				{
					questionId: "api-style",
					answer: { selectedOptionIds: ["rest"] },
				},
			],
		});
		const currentTask = await request.get(`/api/tasks/${taskId}`, { headers });
		expect(currentTask.status(), await currentTask.text()).toBe(200);
		expect((await currentTask.json()) as object).toMatchObject({
			missionPilot: { initialPromptState: "sent", nextWakeAt: null },
		});
	} finally {
		await Promise.allSettled([
			taskId
				? request.delete(`/api/repositories/${repositoryId}`, { headers })
				: Promise.resolve(),
			fs.rm(workspace, { recursive: true, force: true }),
		]);
	}
});

type QuestionnaireAnswer = {
	questionId: string;
	selectedOptionIds: string[];
};

type QuestionnaireDraft = {
	questionnaireSessionId: string;
	state: string;
	deadlineAt: string;
	answers: QuestionnaireAnswer[];
	answerEvidence: Record<string, { source: string; reason: string }>;
};
