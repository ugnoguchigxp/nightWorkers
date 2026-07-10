import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
	detectProjectStackProfile,
	renderProjectStackContext,
} from "../api/modules/techStack";

describe("project stack context", () => {
	it("renders concise stack context without dumping all package dependencies", () => {
		const repoRoot = fs.mkdtempSync(
			path.join(os.tmpdir(), "nightworkers-stack-context-"),
		);
		try {
			fs.writeFileSync(
				path.join(repoRoot, "package.json"),
				JSON.stringify({
					packageManager: "bun@1.3.14",
					dependencies: {
						"@aws-sdk/client-bedrock-runtime": "3.1057.0",
						hono: "4.12.21",
						react: "19.2.4",
						"react-dom": "19.2.4",
					},
					devDependencies: {
						typescript: "6.0.2",
						vite: "6.4.2",
						vitest: "4.1.2",
					},
				}),
				"utf8",
			);

			const profile = detectProjectStackProfile(repoRoot);
			const context = renderProjectStackContext(profile);

			expect(profile.summary).toBe("TypeScript + React + Vite + Hono");
			expect(context).toContain(
				"既存 Project stack: TypeScript + React + Vite + Hono",
			);
			expect(context).toContain("別 stack / starter template 選択を質問しない");
			expect(context).toContain("依存関係の全量ではなく");
			expect(context).toContain("Hono: backend");
			expect(context).not.toContain("@aws-sdk/client-bedrock-runtime");
			expect(context).not.toContain("react-dom");
		} finally {
			fs.rmSync(repoRoot, { recursive: true, force: true });
		}
	});
});
