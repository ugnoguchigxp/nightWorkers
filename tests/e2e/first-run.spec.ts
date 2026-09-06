import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

async function saveLanguage(page: Page, language: "ja" | "en") {
	await page.goto("/settings/general");
	await page.locator("#general-language").selectOption(language);
	const saved = page.waitForResponse(
		(response) =>
			response.url().endsWith("/api/settings/general") &&
			response.request().method() === "POST",
	);
	await page
		.getByRole("button", { name: /^(設定を保存|Save settings)$/ })
		.first()
		.click();
	expect((await saved).ok()).toBe(true);
}

test.describe("first-run guidance", () => {
	for (const language of ["ja", "en"] as const) {
		test(`empty workspace links to working setup actions (${language}) @smoke`, async ({
			page,
		}) => {
			// Keep this UI state independent of fixtures created by other E2E files.
			await page.route("**/api/repositories", (route) =>
				route.fulfill({ json: [] }),
			);
			await saveLanguage(page, language);
			await page.goto("/overview");
			const guide = page.getByRole("region", {
				name: language === "ja" ? "はじめての方へ" : "Get started",
			});
			await expect(guide).toBeVisible();
			await guide.screenshot({
				path: test.info().outputPath(`first-run-${language}.png`),
			});
			await expect(guide.getByRole("listitem")).toHaveCount(3);
			const accessibility = await new AxeBuilder({ page })
				.include('[aria-labelledby="getting-started-title"]')
				.withTags(["wcag2a", "wcag2aa"])
				.analyze();
			expect(accessibility.violations).toEqual([]);
			await guide
				.getByRole("button", {
					name:
						language === "ja"
							? "フォルダーを選んで登録"
							: "Choose and register a folder",
				})
				.click();
			await expect(page.getByRole("dialog")).toBeVisible();
			await page.keyboard.press("Escape");
			await expect(page.getByRole("dialog")).toBeHidden();
			await guide
				.getByRole("button", {
					name:
						language === "ja"
							? "AI接続設定を開く"
							: "Open AI connection settings",
				})
				.click();
			await expect(page).toHaveURL(/\/settings\/llm-providers$/);
			await saveLanguage(page, "ja");
		});
	}
});
