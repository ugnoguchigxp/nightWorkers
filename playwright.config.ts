import { defineConfig, devices } from "@playwright/test";
import { assertIsolatedE2eEnvironment } from "./scripts/e2e-environment.mjs";

assertIsolatedE2eEnvironment();

const e2eWebPort = Number(process.env.NIGHTWORKERS_E2E_WEB_PORT || 39274);
const e2eBaseUrl = `http://localhost:${e2eWebPort}`;

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
	testDir: "./tests/e2e",
	/* Run tests in files in parallel */
	fullyParallel: true,
	/* Fail the build on CI if you accidentally left test.only in the source code. */
	forbidOnly: !!process.env.CI,
	/* Retry on CI only */
	retries: process.env.CI ? 2 : 0,
	/* opt out of parallel tests on CI. */
	workers: process.env.CI ? 1 : undefined,
	/* Reporter to use. See https://playwright.dev/docs/test-reporters */
	reporter: "html",
	/* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
	use: {
		/* Base URL to use in actions like `await page.goto('/')`. */
		baseURL: e2eBaseUrl,
		extraHTTPHeaders: {
			"x-nightworkers-e2e": "1",
		},

		/* Keep visual/debug artifacts for failed E2E runs. */
		screenshot: "only-on-failure",
		trace: "retain-on-failure",
	},

	/* Chromium (Desktop Chrome) のみをターゲットにします */
	/* 他のブラウザやデバイスでのテストが必要な場合は、以下のコメントアウトを解除してください */
	projects: [
		{
			name: "chromium",
			use: { ...devices["Desktop Chrome"] },
		},

		/*
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
    {
      name: 'Mobile Chrome',
      use: { ...devices['Pixel 5'] },
    },
    {
      name: 'Mobile Safari',
      use: { ...devices['iPhone 12'] },
    },
    */
	],

	/* Run your local dev server before starting the tests */
	webServer: {
		command: "bun run dev",
		url: e2eBaseUrl,
		reuseExistingServer: false,
	},
});
