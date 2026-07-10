import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..");
const read = (relativePath: string) =>
	fs.readFileSync(path.join(root, relativePath), "utf8");
const exists = (relativePath: string) =>
	fs.existsSync(path.join(root, relativePath));

describe("Overview module boundary", () => {
	it("keeps Overview implementation files below 600 lines", () => {
		const implementationFiles = [
			"src/modules/overview",
			"api/modules/overview",
		].flatMap((relativeDirectory) =>
			fs
				.readdirSync(path.join(root, relativeDirectory), {
					recursive: true,
					withFileTypes: true,
				})
				.filter(
					(entry) =>
						entry.isFile() &&
						(entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")),
				)
				.map((entry) => path.join(entry.parentPath, entry.name)),
		);
		const oversized = implementationFiles.flatMap((filePath) => {
			const lineCount = fs.readFileSync(filePath, "utf8").split("\n").length;
			return lineCount > 600
				? [{ filePath: path.relative(root, filePath), lineCount }]
				: [];
		});
		expect(oversized).toEqual([]);
	});

	it("owns frontend Overview implementation under src/modules/overview", () => {
		expect(exists("src/modules/overview/OverviewScreen.tsx")).toBe(true);
		expect(exists("src/modules/overview/overviewCommands.ts")).toBe(true);
		expect(
			exists("src/modules/nightworkers/components/OverviewScreen.tsx"),
		).toBe(false);
		expect(exists("src/modules/nightworkers/types/overview.ts")).toBe(false);
		expect(
			read("src/modules/nightworkers/components/NightWorkersShell.tsx"),
		).toContain('from "@/modules/overview"');
		expect(
			read("src/modules/nightworkers/nightWorkersCommands.ts"),
		).not.toContain("fetchOverview");
	});

	it("owns backend Overview route and aggregation under api/modules/overview", () => {
		expect(exists("api/modules/overview/overview.routes.ts")).toBe(true);
		expect(exists("api/modules/overview/overview.service.ts")).toBe(true);
		expect(exists("api/services/overview/index.ts")).toBe(false);
		expect(
			read("api/modules/nightworkers/nightworkers.routes.ts"),
		).not.toContain("getOverviewDashboardRoute");
		expect(read("api/modules/nightworkers/routes/run-routes.ts")).not.toContain(
			"getOverviewDashboardRoute",
		);
	});

	it("owns the shared schema and ontology manifest", () => {
		expect(exists("shared/schemas/overview.schema.ts")).toBe(true);
		expect(exists("shared/schemas/nightworkers/overview.schema.ts")).toBe(
			false,
		);
		expect(exists(".agent-ontology/modules/overview.yaml")).toBe(true);
		expect(read(".agent-ontology/modules.yaml")).toContain('"id": "overview"');
	});
});
