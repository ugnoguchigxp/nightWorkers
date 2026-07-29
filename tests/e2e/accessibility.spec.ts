import fs from "node:fs/promises";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import {
	type APIRequestContext,
	expect,
	type Page,
	test,
} from "@playwright/test";
import { createDisposableGitWorkspace } from "./helpers";

const e2eWebPort = Number(process.env.NIGHTWORKERS_E2E_WEB_PORT || 39274);
const sameOriginHeaders = { Origin: `http://localhost:${e2eWebPort}` };

async function assertNoSeriousAccessibilityViolations(page: Page) {
	const results = await new AxeBuilder({ page })
		.withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
		.analyze();
	const violations = results.violations.filter((violation) =>
		["critical", "serious"].includes(violation.impact ?? ""),
	);
	expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
}

async function createWorkspaceFixture(request: APIRequestContext) {
	await expect
		.poll(async () => (await request.get("/api/health")).status(), {
			timeout: 10_000,
		})
		.toBe(200);
	const { workspace } = await createDisposableGitWorkspace({
		prefix: "accessibility-",
	});
	await fs.writeFile(
		path.join(workspace, "README.md"),
		"# Accessibility fixture\n",
	);
	const repositoryResponse = await request.post("/api/repositories", {
		headers: sameOriginHeaders,
		data: {
			name: `Accessibility fixture ${Date.now()}`,
			localPath: workspace,
			branch: "main",
			allowed: true,
		},
	});
	expect(repositoryResponse.status(), await repositoryResponse.text()).toBe(
		201,
	);
	const repository = (await repositoryResponse.json()) as { id: string };
	const taskResponse = await request.post("/api/tasks", {
		headers: sameOriginHeaders,
		data: {
			repositoryId: repository.id,
			title: "Accessibility fixture",
			description: "Accessibility fixture",
			objective: "Verify accessibility",
			acceptanceCriteria: "No serious violations",
			timeoutSeconds: 60,
		},
	});
	expect(taskResponse.status(), await taskResponse.text()).toBe(201);
	const task = (await taskResponse.json()) as { id: string };
	return { workspace, repositoryId: repository.id, taskId: task.id };
}

test.describe("NightWorkers accessibility @accessibility", () => {
	test.describe.configure({ mode: "serial", timeout: 120_000 });

	test("major workbench surfaces have no serious axe violations", {
		tag: ["@deterministic", "@p1", "@scenario:NW-E2E-A11Y-001"],
	}, async ({ page, request }) => {
		const fixture = await createWorkspaceFixture(request);
		try {
			for (const route of [
				"/overview",
				"/queue",
				"/settings/general",
				`/sessions/${fixture.taskId}`,
				`/sessions/${fixture.taskId}?artifact=review_status`,
			]) {
				await page.goto(route);
				await expect(page.locator(".nightworkers-shell")).toBeVisible();
				await assertNoSeriousAccessibilityViolations(page);
			}
		} finally {
			await Promise.allSettled([
				request.delete(`/api/tasks/${fixture.taskId}`, {
					headers: sameOriginHeaders,
				}),
				request.delete(`/api/repositories/${fixture.repositoryId}`, {
					headers: sameOriginHeaders,
				}),
			]);
			await fs.rm(fixture.workspace, { recursive: true, force: true });
		}
	});

	test("keyboard focus is visible and reduced motion is honored", {
		tag: ["@deterministic", "@p1", "@scenario:NW-E2E-A11Y-002"],
	}, async ({ page }) => {
		await page.emulateMedia({ reducedMotion: "reduce" });
		await page.goto("/overview");
		const settingsLink = page.getByRole("link", {
			name: /^(Settings|設定)$/,
		});
		await expect(settingsLink).toBeVisible();
		await settingsLink.focus();
		await page.keyboard.press("Tab");
		const focusState = await page.evaluate(() => {
			const activeElement = document.activeElement;
			return activeElement instanceof HTMLElement
				? {
						tagName: activeElement.tagName,
						focusVisible: activeElement.matches(":focus-visible"),
						visible:
							activeElement.getClientRects().length > 0 &&
							getComputedStyle(activeElement).visibility !== "hidden",
					}
				: null;
		});
		expect(focusState).toMatchObject({ focusVisible: true, visible: true });
		expect(focusState?.tagName).not.toBe("BODY");
		const animationDuration = await page
			.locator(".nightworkers-shell")
			.evaluate((element) => getComputedStyle(element).animationDuration);
		expect(Number.parseFloat(animationDuration)).toBeLessThanOrEqual(0.001);
	});

	test("major accessible names remain available in Japanese and English", {
		tag: ["@deterministic", "@p1", "@scenario:NW-E2E-A11Y-003"],
	}, async ({ page }) => {
		await page.goto("/settings/general");
		const languageSelect = page.locator("#general-language");
		await languageSelect.selectOption("ja");
		await expect(languageSelect).toHaveAccessibleName("UI 表示言語");
		await languageSelect.selectOption("en");
		await expect(languageSelect).toHaveAccessibleName("UI language");
		await languageSelect.selectOption("ja");
		await expect(languageSelect).toHaveAccessibleName("UI 表示言語");
	});

	test("modal traps focus, closes with Escape, and restores its trigger", {
		tag: ["@deterministic", "@p1", "@scenario:NW-E2E-A11Y-004"],
	}, async ({ page }) => {
		await page.goto("/overview");
		const trigger = page.getByRole("button", {
			name: /Register project folder|Project folder を登録/,
		});
		await trigger.focus();
		await trigger.click();
		const dialog = page.getByRole("dialog", {
			name: /Browse Local Folders|Local folder を選択/,
		});
		await expect(dialog).toBeVisible();
		await expect(
			page.getByRole("button", { name: /Close|閉じる/ }),
		).toBeFocused();
		await trigger.focus();
		expect(
			await page
				.locator(":focus")
				.evaluate((element) => Boolean(element.closest('[role="dialog"]'))),
		).toBe(true);
		await page.keyboard.press("Shift+Tab");
		expect(
			await page
				.locator(":focus")
				.evaluate((element) => Boolean(element.closest('[role="dialog"]'))),
		).toBe(true);
		await page.keyboard.press("Escape");
		await expect(dialog).toBeHidden();
		await expect(trigger).toBeFocused();
	});
});
