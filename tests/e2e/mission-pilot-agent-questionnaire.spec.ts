import fs from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { createDisposableGitWorkspace } from "./helpers";

const headers = {
	Origin: `http://localhost:${process.env.NIGHTWORKERS_E2E_WEB_PORT || 39274}`,
	"x-nightworkers-e2e": "1",
};

test("Play shows the canonical Task Goal and submits Questionnaire answers after the 20-second timer", {
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
		const fixtureResponse = await request.post(
			"/api/e2e/fixtures/mission-pilot-agent-questionnaire",
			{ headers, data: { taskId } },
		);
		expect(fixtureResponse.status(), await fixtureResponse.text()).toBe(201);
		const { questionnaireSessionId } = (await fixtureResponse.json()) as {
			questionnaireSessionId: string;
		};

		await expect(
			page.locator(".mission-pilot-countdown").first(),
		).toContainText(/00:\d{2}/, { timeout: 10_000 });
		let questionnaire: {
			id: string;
			status: string;
			answers: Array<{ questionId: string; answer: QuestionnaireAnswer }>;
		} | null = null;
		await expect
			.poll(
				async () => {
					const response = await request.get(
						`/api/tasks/${taskId}/design-questionnaire/${questionnaireSessionId}`,
						{ headers },
					);
					expect(response.status(), await response.text()).toBe(200);
					questionnaire = (await response.json()) as typeof questionnaire;
					return questionnaire?.status;
				},
				{ timeout: 45_000 },
			)
			.toBe("review_ready");

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
		expect(questionnaire).toMatchObject({
			status: "review_ready",
			answers: [
				{
					questionId: "api-style",
					answer: { selectedOptionIds: ["rest"] },
				},
			],
		});
		await expect(page.locator(".mission-pilot-countdown")).toHaveCount(0);
		const currentControl = await request.get(
			`/api/mission-pilot/tasks/${taskId}`,
			{ headers },
		);
		expect(currentControl.status(), await currentControl.text()).toBe(200);
		expect((await currentControl.json()) as object).toMatchObject({
			initialPromptState: "sent",
			nextWakeAt: null,
		});

		const composerControls = page.locator(".mission-pilot-composer-controls");
		await composerControls
			.getByRole("button", {
				name: "Mission Pilotを一時停止",
				exact: true,
			})
			.click();
		await expect(
			composerControls.getByRole("button", {
				name: "Mission Pilotを再生",
				exact: true,
			}),
		).toBeVisible({ timeout: 10_000 });
		await expect(composerControls.locator(".animate-spin")).toHaveCount(0);
		const stoppedControl = await request.get(
			`/api/mission-pilot/tasks/${taskId}`,
			{ headers },
		);
		expect(stoppedControl.status(), await stoppedControl.text()).toBe(200);
		expect((await stoppedControl.json()) as object).toMatchObject({
			desiredState: "stopped",
			activityState: "idle",
			activeRunId: null,
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
