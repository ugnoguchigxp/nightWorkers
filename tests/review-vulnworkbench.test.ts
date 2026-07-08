import { describe, expect, it } from "vitest";
import {
	findingForVulnWorkbenchResult,
	readVulnWorkbenchCliSettings,
	runVulnWorkbenchSecurityDiagnostic,
	warningFindingForVulnWorkbenchResult,
} from "../api/modules/nightworkers/nightworkers.review-vulnworkbench.service";

describe("Review vulnWorkbench diagnostic", () => {
	it("builds disabled/unconfigured warning results without scanner-backed claims", async () => {
		const settings = readVulnWorkbenchCliSettings({
			NIGHTWORKERS_VULNWORKBENCH_ENABLED: "false",
		} as NodeJS.ProcessEnv);
		const result = await runVulnWorkbenchSecurityDiagnostic({
			target: { repositoryId: "repo-1", targetFiles: [] },
			artifactDir: "/tmp",
			settings,
		});

		expect(result.ok).toBe(false);
		expect(result.commandsRun).toEqual([]);
		expect(result.findingCount).toBe(0);
		expect(warningFindingForVulnWorkbenchResult(result)).toMatchObject({
			severity: "warning",
			title: "vulnWorkbench security diagnostic was not configured",
		});
	});

	it("reads project mappings from environment JSON", () => {
		const settings = readVulnWorkbenchCliSettings({
			NIGHTWORKERS_VULNWORKBENCH_PROJECTS: JSON.stringify({
				"repo-1": "vw-project-1",
			}),
			NIGHTWORKERS_VULNWORKBENCH_PROFILE: "detailed-security",
			NIGHTWORKERS_VULNWORKBENCH_TIMEOUT_SECONDS: "1200",
		} as NodeJS.ProcessEnv);

		expect(settings.projectIdByRepositoryId["repo-1"]).toBe("vw-project-1");
		expect(settings.defaultProfile).toBe("detailed-security");
		expect(settings.timeoutSeconds).toBe(1200);
	});

	it("runs configured scan and review commands with bounded detailed timeout", async () => {
		const calls: Array<{
			cwd: string;
			args: string[];
			timeoutSeconds: number;
		}> = [];
		const result = await runVulnWorkbenchSecurityDiagnostic({
			target: {
				repositoryId: "repo-1",
				targetFiles: [
					{
						path: "api/routes/auth.ts",
						status: "modified",
						sources: ["current_git_diff"],
						eventIds: [],
						diff: "",
						diffBytes: 0,
					},
				],
			},
			artifactDir: "/tmp/nightworkers-review",
			settings: {
				enabled: true,
				cwd: "/workspace/vulnWorkbench",
				projectIdByRepositoryId: { "repo-1": "vw-project-1" },
				defaultProfile: "baseline",
				timeoutSeconds: 600,
			},
			runCommand: async (cwd, args, timeoutSeconds) => {
				calls.push({ cwd, args, timeoutSeconds });
				if (args[1] === "scan:profile") {
					return {
						command: {
							command: `bun ${args.join(" ")}`,
							exitCode: 0,
							summary: "scan complete",
						},
						output: "scanRunId scan-1",
						scanRunId: "scan-1",
					};
				}
				return {
					command: {
						command: `bun ${args.join(" ")}`,
						exitCode: 0,
						summary: "review complete",
					},
					output: "findingCount: 2 highOrCriticalCount: 1",
					scanRunId: null,
				};
			},
		});

		expect(result.ok).toBe(true);
		expect(result.profile).toBe("detailed-security");
		expect(calls).toHaveLength(2);
		expect(calls[0]?.cwd).toBe("/workspace/vulnWorkbench");
		expect(calls[0]?.args).toContain("detailed-security");
		expect(calls[0]?.timeoutSeconds).toBe(1200);
		expect(calls[1]?.args).toContain("scan-1");
		expect(findingForVulnWorkbenchResult(result)).toMatchObject({
			severity: "warning",
			title:
				"vulnWorkbench security diagnostic reported scanner-backed findings",
		});
	});
});
