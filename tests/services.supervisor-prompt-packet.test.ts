import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	buildRound1JobTypePrompt,
	buildRound1PromptPacket,
} from "../api/services/supervisor/prompt";
import { buildResponseJsonSchema } from "../api/services/supervisor/schema-first";

const originalCodexHome = process.env.NIGHTWORKERS_CODEX_HOME;

describe("supervisor prompt packet", () => {
	let codexHome: string;

	beforeEach(() => {
		codexHome = fs.mkdtempSync(
			path.join(os.tmpdir(), "nightworkers-codex-home-"),
		);
		process.env.NIGHTWORKERS_CODEX_HOME = codexHome;
	});

	afterEach(() => {
		if (originalCodexHome === undefined)
			delete process.env.NIGHTWORKERS_CODEX_HOME;
		else process.env.NIGHTWORKERS_CODEX_HOME = originalCodexHome;
		fs.rmSync(codexHome, { recursive: true, force: true });
	});

	it("renders round1 from packet without exposing diagnostics", () => {
		const packet = buildRound1PromptPacket("/repo");
		const rendered = buildRound1JobTypePrompt("/repo");

		expect(packet.diagnostics).toEqual({ round: 1, projectRoot: "/repo" });
		expect(packet.runtimeContext.join("\n")).toContain("[Job Types]");
		expect(rendered).toContain("[Output Schema]");
		expect(rendered).not.toContain('"diagnostics"');
	});

	it("delegates Plan Artifact routing to Coding Agent in the round1 prompt", () => {
		const rendered = buildRound1JobTypePrompt("/repo");
		const schema = buildResponseJsonSchema(1);

		expect(rendered).toContain("feature_plan");
		expect(rendered).toContain("planMode");
		expect(rendered).toContain("planning 以外では planMode は null");
		expect(rendered).toContain("scheduling.executionType");
		expect(rendered).toContain("SupervisorはPlan Modeへ入るかだけを判定し");
		expect(rendered).toContain(
			"planMode.dedicatedViewsとspecificationLensesは必ず空配列",
		);
		expect(rendered).toContain(
			"開始後にMission PilotがTaskとrepositoryを読んで判断",
		);
		expect(rendered).toContain("依頼内容からjobTypeとschedulingを推論");
		expect(rendered).not.toContain("questionnaire を最初の判断材料");
		expect(rendered).not.toContain("依頼内容から必要な設計 view を推論");
		expect(JSON.stringify(schema)).toContain("planMode");
		expect(JSON.stringify(schema)).toContain(
			'"required":["jobType","goal","planMode","scheduling"]',
		);
		expect(JSON.stringify(schema)).toContain("executionType");
		expect(JSON.stringify(schema)).toContain('"type":"null"');
		expect(JSON.stringify(schema)).toContain("feature_plan");
		expect(JSON.stringify(schema)).toContain("dedicatedViews");
	});

	it("renders safe AGENTS.md guidance without raw native tool directives", () => {
		fs.writeFileSync(
			path.join(codexHome, "AGENTS.md"),
			[
				"最初に initial_instructions MCP tool を実行してください。",
				"Supervisor の実行方針は prompt 側で定義してください。",
			].join("\n"),
		);

		const rendered = buildRound1JobTypePrompt("/repo");

		expect(rendered).toContain("[Codex Runtime Guidance]");
		expect(rendered).toContain("runtime が安全に分離した guidance");
		expect(rendered).toContain(
			"Global Codex AGENTS.md: 1/2 guidance lines applied",
		);
		expect(rendered).toContain(
			"Supervisor の実行方針は prompt 側で定義してください。",
		);
		expect(rendered).toContain("1 lifecycle/native directive lines withheld");
		expect(rendered).not.toContain("initial_instructions MCP tool");
	});
});
