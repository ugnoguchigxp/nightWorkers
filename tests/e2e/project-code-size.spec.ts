import fs from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { createDisposableGitWorkspace } from "./helpers";

const headers = {
	Origin: `http://localhost:${process.env.NIGHTWORKERS_E2E_WEB_PORT || 39274}`,
};

async function write(root: string, relativePath: string, content: string) {
	const target = path.join(root, relativePath);
	await fs.mkdir(path.dirname(target), { recursive: true });
	await fs.writeFile(target, content, "utf8");
}

test("measures and restores the saved project code size", {
	tag: ["@deterministic", "@p1", "@scenario:NW-E2E-TECH-STACK-001"],
}, async ({ page, request }) => {
	const { workspace } = await createDisposableGitWorkspace({
		prefix: "project-code-size-",
	});
	let repositoryId: string | null = null;
	try {
		await write(
			workspace,
			"package.json",
			JSON.stringify({ dependencies: { react: "1", hono: "1" } }),
		);
		await write(
			workspace,
			"src/App.tsx",
			"export const App = () => <main />;\n",
		);
		await write(workspace, "api/server.ts", "export const server = true;\n");
		await write(workspace, "api/workers/job.ts", "export const job = true;\n");
		await write(workspace, "shared/types.ts", "export type Id = string;\n");
		await write(workspace, "tests/app.test.ts", "it('works', () => {});\n");
		await write(
			workspace,
			"tests/e2e/app.spec.ts",
			"test('works', () => {});\n",
		);

		const repositoryResponse = await request.post("/api/repositories", {
			headers,
			data: {
				name: "Project Code Size",
				localPath: workspace,
				branch: "main",
				allowed: true,
			},
		});
		expect(repositoryResponse.status(), await repositoryResponse.text()).toBe(
			201,
		);
		repositoryId = ((await repositoryResponse.json()) as { id: string }).id;

		await page.goto(`/projects/${repositoryId}/detail/stack`);
		await expect(
			page.getByText("コードサイズはまだ計測されていません"),
		).toBeVisible();
		const measurementResponsePromise = page.waitForResponse(
			(response) =>
				response.request().method() === "POST" &&
				response
					.url()
					.endsWith(
						`/api/repositories/${repositoryId}/tech-stack/code-size/measure`,
					),
		);
		await page.getByRole("button", { name: "計測して保存" }).click();
		const measurementResponse = await measurementResponsePromise;
		expect(measurementResponse.status()).toBe(200);
		const measuredSnapshot = (await measurementResponse.json()) as {
			totals: {
				totalEffectiveLines: number;
				sourceEffectiveLines: number;
				testEffectiveLines: number;
			};
		};
		expect(measuredSnapshot.totals).toMatchObject({
			totalEffectiveLines: 6,
			sourceEffectiveLines: 4,
			testEffectiveLines: 2,
		});
		await expect(page.getByText("6 = 4 + 2")).toBeVisible();
		await expect(page.getByText("Unitテスト")).toBeVisible();
		await expect(page.getByText("E2Eテスト")).toBeVisible();

		await page.reload();
		await expect(page.getByText("6 = 4 + 2")).toBeVisible();
	} finally {
		if (repositoryId) {
			await request.delete(`/api/repositories/${repositoryId}`, { headers });
		}
		await fs.rm(workspace, { recursive: true, force: true });
	}
});
