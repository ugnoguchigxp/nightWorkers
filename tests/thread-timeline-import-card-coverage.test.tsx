import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
	getImportProjectToolCardModel,
	hasImportProjectToolCard,
	ImportProjectToolCard,
	NormalImportProjectToolCard,
} from "../src/modules/nightworkers/components/ThreadTimelineImportProjectCard";

function event(result: unknown, overrides: Record<string, unknown> = {}) {
	return {
		kind: "tool.result",
		seq: 7,
		source: "worker",
		payloadJson: {
			payload: {
				toolName: "import_project",
				result,
			},
		},
		...overrides,
	};
}

const completePayload = {
	mode: "git",
	git: {
		repoUrl: "https://example.test/repo.git",
		ref: "main",
		commit: "abc",
		targetPath: "/repo",
		gitOperations: [
			{
				command: "git clone repo",
				cwd: "/tmp",
				exitCode: 0,
				stdout: "ok",
				stderr: "",
			},
			{ command: 2, cwd: [], exitCode: "bad", stdout: null, stderr: {} },
		],
	},
	postImport: {
		targetPath: "/repo",
		manifest: {
			status: "found",
			path: "/repo/package.json",
			rawContent: '{"name":"demo"}',
			packageJson: { name: "demo", packageManager: "npm@11" },
			detectedPackageManager: "npm",
			installCommand: ["npm", "install", 1],
			recommendedVerificationCommands: ["npm test", 3],
		},
		initialization: {
			status: "failed",
			command: ["npm", "install"],
			cwd: "/repo",
			exitCode: 1,
			stdout: "installing",
			stderr: "",
			errorMessage: "install failed",
		},
		gitInitialization: {
			status: "passed",
			command: "git init",
			cwd: "/repo",
			exitCode: 0,
			stdout: "initialized",
			stderr: "warning",
		},
		llmContext: {
			status: "found",
			path: "/repo/LLM_CONTEXT.md",
			rawContent: "# Context",
		},
	},
};

describe("import project card branch coverage", () => {
	it("rejects unrelated, unfinished, and unreadable tool results", () => {
		expect(
			getImportProjectToolCardModel(event({}, { payloadJson: {} })),
		).toBeNull();
		expect(
			getImportProjectToolCardModel(
				event({}, { kind: "tool.call", eventType: "tool_call" }),
			),
		).toBeNull();
		expect(
			getImportProjectToolCardModel(
				event({ content: [{ text: " " }, { text: "{" }, null] }),
			),
		).toBeNull();
		expect(hasImportProjectToolCard(event({}))).toBe(false);
		expect(
			getImportProjectToolCardModel(
				event({ payload: { mode: 1, git: {} } }, { kind: "tool.error" }),
			),
		).toBeNull();
	});

	it("extracts direct, nested, structured, and content payload forms", () => {
		const direct = getImportProjectToolCardModel(event(completePayload));
		const nested = getImportProjectToolCardModel(
			event({ payload: completePayload, error: { message: "nested error" } }),
		);
		const structured = getImportProjectToolCardModel(
			event({
				structuredContent: { payload: completePayload },
				error: { message: "structured error" },
			}),
		);
		const content = getImportProjectToolCardModel(
			event({
				content: [
					{ text: "bad" },
					{ text: JSON.stringify({ payload: completePayload }) },
				],
			}),
		);

		expect(direct).toMatchObject({
			mode: "git",
			targetPath: "/repo",
			sourceSummary: "https://example.test/repo.git @ main @ abc",
			packageName: "demo",
			packageManager: "npm",
			installCommand: "npm install",
			installExitCode: 1,
			gitInitializationCommand: "git init",
			gitInitializationExitCode: 0,
			verificationCommands: ["npm test"],
		});
		expect(direct?.gitOperations).toHaveLength(1);
		expect(nested?.errorMessage).toBe("nested error");
		expect(structured?.errorMessage).toBe("structured error");
		expect(content?.targetPath).toBe("/repo");
	});

	it("uses template and fallback source fields", () => {
		const card = getImportProjectToolCardModel(
			event({
				mode: "template",
				template: {
					templateId: "starter",
					variant: "basic",
					ref: "v1",
					commit: "def",
					targetPath: "/target",
				},
				postImport: {
					manifest: {
						path: "/fallback/package.json",
						packageJson: { packageManager: "pnpm" },
						installCommand: "pnpm install",
						recommendedVerificationCommands: null,
					},
					initialization: { command: null },
				},
			}),
		);
		expect(card).toMatchObject({
			targetPath: "/target",
			sourceSummary: "starter @ basic @ v1 @ def",
			packageManager: "pnpm",
			installCommand: "pnpm install",
		});

		const unknown = getImportProjectToolCardModel(
			event({
				mode: "other",
				postImport: { manifest: { path: "/only/package.json" } },
			}),
		);
		expect(unknown?.sourceSummary).toBe("");
		expect(unknown?.targetPath).toBe("/only/package.json");
	});

	it("renders rich and minimal cards", () => {
		const richEvent = event(
			{ payload: completePayload, error: { message: "visible error" } },
			{ eventType: "tool_result" },
		);
		const rich = renderToStaticMarkup(
			<>
				<ImportProjectToolCard event={richEvent} />
				<NormalImportProjectToolCard event={richEvent} />
			</>,
		);
		expect(rich).toContain("git operations");
		expect(rich).toContain("git-init.sh");
		expect(rich).toContain("install.sh");
		expect(rich).toContain("recommended-verification.sh");
		expect(rich).toContain("package.json");
		expect(rich).toContain("LLM_CONTEXT.md");
		expect(rich).toContain("visible error");

		const minimalEvent = event(
			{ mode: "template", template: {}, postImport: {} },
			{ source: "", seq: undefined },
		);
		const minimal = renderToStaticMarkup(
			<>
				<ImportProjectToolCard event={minimalEvent} />
				<NormalImportProjectToolCard event={minimalEvent} />
			</>,
		);
		expect(minimal).toContain("import_project.json");
		expect(
			renderToStaticMarkup(
				createElement(ImportProjectToolCard, { event: event({}) }),
			),
		).toBe("");
		expect(
			renderToStaticMarkup(
				createElement(NormalImportProjectToolCard, { event: event({}) }),
			),
		).toBe("");
	});
});
