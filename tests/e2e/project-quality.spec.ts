import fs from "node:fs/promises";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { type APIRequestContext, expect, test } from "@playwright/test";
import { createDisposableGitWorkspace } from "./helpers";

const headers = {
	Origin: `http://localhost:${process.env.NIGHTWORKERS_E2E_WEB_PORT || 39274}`,
};

async function createCompletedQualityFixture(request: APIRequestContext) {
	const { workspace } = await createDisposableGitWorkspace({
		prefix: "project-quality-",
	});
	await fs.mkdir(path.join(workspace, "scripts"), { recursive: true });
	await fs.writeFile(
		path.join(workspace, "package.json"),
		JSON.stringify({
			scripts: {
				test: "node scripts/unit.cjs",
				"test:coverage": "node scripts/coverage.cjs",
				"test:e2e": "node scripts/e2e.cjs",
			},
		}),
	);
	await fs.writeFile(
		path.join(workspace, "scripts", "unit.cjs"),
		"console.log('unit ok');\n",
	);
	await fs.writeFile(
		path.join(workspace, "scripts", "coverage.cjs"),
		"const fs=require('node:fs');fs.mkdirSync('coverage',{recursive:true});fs.writeFileSync('coverage/coverage-summary.json',JSON.stringify({total:{statements:{pct:91},branches:{pct:90},functions:{pct:92},lines:{pct:93}}}));\n",
	);
	await fs.writeFile(
		path.join(workspace, "scripts", "e2e.cjs"),
		"const fs=require('node:fs');fs.mkdirSync('test-results',{recursive:true});fs.writeFileSync('test-results/e2e-results.json',JSON.stringify({suites:[{title:'fixture',specs:[{title:'passes',ok:true,tests:[{status:'passed'}]}]}]}));\n",
	);
	const repository = await request.post("/api/repositories", {
		headers,
		data: {
			name: "Project Quality",
			localPath: workspace,
			branch: "main",
			allowed: true,
		},
	});
	expect(repository.status(), await repository.text()).toBe(201);
	const repositoryId = ((await repository.json()) as { id: string }).id;
	const runResponse = await request.post(
		`/api/repositories/${repositoryId}/quality/runs`,
		{
			headers,
			data: { runType: "all" },
		},
	);
	expect(runResponse.status(), await runResponse.text()).toBe(201);
	const run = await runResponse.json();
	const qualityResponse = await request.get(
		`/api/repositories/${repositoryId}/quality`,
		{ headers },
	);
	expect(qualityResponse.status(), await qualityResponse.text()).toBe(200);
	return {
		workspace,
		repositoryId,
		run,
		quality: await qualityResponse.json(),
	};
}

async function cleanupQualityFixture(
	request: APIRequestContext,
	fixture: { workspace: string; repositoryId: string },
) {
	await Promise.allSettled([
		request.delete(`/api/repositories/${fixture.repositoryId}`, { headers }),
		fs.rm(fixture.workspace, { recursive: true, force: true }),
	]);
}

test.describe("Project Quality @regression", () => {
	test("persists unit coverage and E2E artifacts into Quality history", {
		tag: ["@deterministic", "@p1", "@scenario:NW-E2E-QUALITY-001"],
	}, async ({ request }) => {
		const fixture = await createCompletedQualityFixture(request);
		try {
			expect(fixture.run).toMatchObject({
				status: "completed",
				coverageSummary: { total: { statements: { pct: 91 } } },
				e2eSummary: { passed: 1, failed: 0 },
			});
			expect(fixture.quality).toMatchObject({
				latestCoverageRun: { status: "completed" },
				latestE2eResultRun: { status: "completed" },
			});
		} finally {
			await cleanupQualityFixture(request, fixture);
		}
	});

	test("shows actual coverage in Project Detail overview", {
		tag: ["@deterministic", "@p1", "@scenario:NW-E2E-PROJECT-001"],
	}, async ({ page, request }) => {
		const fixture = await createCompletedQualityFixture(request);
		try {
			await page.goto(`/projects/${fixture.repositoryId}/detail/overview`);
			await expect(page.getByText("プロジェクト指標")).toBeVisible();
			await expect(page.getByText("91%").first()).toBeVisible();
		} finally {
			await cleanupQualityFixture(request, fixture);
		}
	});

	test("keeps populated Project Quality surfaces free of serious axe violations", {
		tag: ["@deterministic", "@p1", "@scenario:NW-E2E-A11Y-005"],
	}, async ({ page, request }) => {
		const fixture = await createCompletedQualityFixture(request);
		try {
			await page.goto(`/projects/${fixture.repositoryId}/detail/quality`);
			await expect(page.getByText("カバレッジレポート").first()).toBeVisible();
			await expect(page.getByText("E2E結果").first()).toBeVisible();
			await expect(
				page.getByText("all / completed / exit 0").first(),
			).toBeVisible();
			const violations = (
				await new AxeBuilder({ page })
					.withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
					.analyze()
			).violations.filter((violation) =>
				["critical", "serious"].includes(violation.impact ?? ""),
			);
			expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
		} finally {
			await cleanupQualityFixture(request, fixture);
		}
	});

	test("cancels a running Quality command and allows a later rerun", {
		tag: ["@deterministic", "@p1", "@scenario:NW-E2E-QUALITY-002"],
	}, async ({ request }) => {
		const { workspace } = await createDisposableGitWorkspace({
			prefix: "project-quality-cancel-",
		});
		await fs.mkdir(path.join(workspace, "scripts"), { recursive: true });
		await fs.writeFile(
			path.join(workspace, "package.json"),
			JSON.stringify({ scripts: { test: "node scripts/test.cjs" } }),
		);
		await fs.writeFile(
			path.join(workspace, "scripts", "test.cjs"),
			"setInterval(() => console.log('still running'), 100);\n",
		);
		const repository = await request.post("/api/repositories", {
			headers,
			data: {
				name: "Project Quality cancel",
				localPath: workspace,
				branch: "main",
				allowed: true,
			},
		});
		expect(repository.status(), await repository.text()).toBe(201);
		const repositoryId = ((await repository.json()) as { id: string }).id;
		try {
			const creating = request.post(
				`/api/repositories/${repositoryId}/quality/runs`,
				{
					headers,
					data: { runType: "unit" },
				},
			);
			let activeRunId = "";
			await expect
				.poll(async () => {
					const response = await request.get(
						`/api/repositories/${repositoryId}/quality/runs`,
						{ headers },
					);
					const runs = (await response.json()) as Array<{
						id: string;
						status: string;
					}>;
					const active = runs.find((run) => run.status === "running");
					activeRunId = active?.id ?? "";
					return activeRunId;
				})
				.not.toBe("");
			const cancelled = await request.post(
				`/api/repositories/${repositoryId}/quality/runs/${activeRunId}/cancel`,
				{ headers },
			);
			expect(await cancelled.json()).toMatchObject({ status: "cancelled" });
			const initial = await creating;
			expect(await initial.json()).toMatchObject({
				id: activeRunId,
				status: "cancelled",
			});
			await fs.writeFile(
				path.join(workspace, "scripts", "test.cjs"),
				"console.log('rerun ok');\n",
			);
			const rerun = await request.post(
				`/api/repositories/${repositoryId}/quality/runs`,
				{
					headers,
					data: { runType: "unit" },
				},
			);
			expect(await rerun.json()).toMatchObject({ status: "completed" });
		} finally {
			await Promise.allSettled([
				request.delete(`/api/repositories/${repositoryId}`, { headers }),
				fs.rm(workspace, { recursive: true, force: true }),
			]);
		}
	});
});
