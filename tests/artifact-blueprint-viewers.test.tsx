import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
	BlueprintArtifactViewer,
	ComponentDesignArtifactViewer,
} from "../src/modules/blueprint-preview/ArtifactBlueprintViewers";

const tMock = (key: string, options?: { count?: unknown }) => {
	if (options?.count !== undefined) return `${key}_${options.count}`;
	return key;
};

// Mock i18next
vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: tMock }),
}));

describe("ArtifactBlueprintViewers module", () => {
	it("renders BlueprintArtifactViewer with validation issues and LLM metrics", () => {
		const blueprint = {
			id: "bp-1",
			name: "Test Blueprint",
			screens: [
				{
					id: "scr-1",
					name: "Dashboard",
					componentName: "DashboardPage",
					sections: [
						{
							id: "sec-1",
							name: "Section 1",
							componentName: "DataTableSection",
						},
					],
				},
			],
		};

		const validation = {
			issues: [{ path: "screens[0]", message: "Layout warning", code: "WARN" }],
		};

		const generation = {
			llmUsage: {
				provider: "test-provider",
				model: "test-model",
				usageMode: "chat",
				inputTokens: 1200,
				outputTokens: 800,
				totalTokens: 2000,
				durationMs: 1500,
			},
		};

		const markup = renderToStaticMarkup(
			<BlueprintArtifactViewer
				sessionId="sess-1"
				messageId="msg-1"
				blueprint={blueprint}
				validation={validation}
				generation={generation}
			/>,
		);

		expect(markup).toContain("artifact.designPreview");
		expect(markup).toContain("Dashboard");
		expect(markup).toContain("Section 1");
		expect(markup).toContain("Layout warning");
		expect(markup).toContain("test-provider");
		expect(markup).toContain("1,200 tokens");
		expect(markup).toContain("800 tokens");
		expect(markup).toContain("2,000 tokens");
		expect(markup).toContain("1.5s");
	});

	it("renders ComponentDesignArtifactViewer with button variants and token changes", () => {
		const artifact = {
			componentName: "MyButton",
			scope: "Global",
			summary: "Global button design",
			variants: [
				{
					name: "danger",
					purpose: "Destructive action",
					states: ["active", "hover"],
				},
				{ name: "secondary", purpose: "Cancel action" },
				{ name: "icon-only", purpose: "Compact action" },
				{ name: "primary", purpose: "Main action" },
			],
			tokenChanges: [
				{
					token: "bg-color",
					before: "#fff",
					proposed: "#000",
					rationale: "Dark theme",
				},
			],
			discussionPrompts: ["Prompt 1", "Prompt 2"],
		};

		const markup = renderToStaticMarkup(
			<ComponentDesignArtifactViewer artifact={artifact} />,
		);

		expect(markup).toContain("MyButton");
		expect(markup).toContain("Global");
		expect(markup).toContain("Global button design");
		expect(markup).toContain("Destructive action");
		expect(markup).toContain("Cancel action");
		expect(markup).toContain("bg-color");
		expect(markup).toContain("#fff");
		expect(markup).toContain("#000");
		expect(markup).toContain("Dark theme");
		expect(markup).toContain("Prompt 1");
		expect(markup).toContain("Prompt 2");
	});
});
