import { describe, expect, it } from "vitest";
import {
	buildVulnWorkbenchCliEnv,
	findingForVulnWorkbenchResult,
	readVulnWorkbenchCliSettings,
	runVulnWorkbenchSecurityDiagnostic,
	warningFindingForVulnWorkbenchResult,
} from "../api/modules/review/review-vulnworkbench.service";

describe("Review vulnWorkbench diagnostic", () => {
	it("builds disabled/unconfigured warning results without scanner-backed claims", async () => {
		const settings = readVulnWorkbenchCliSettings({
			NIGHTWORKERS_VULNWORKBENCH_ENABLED: "false",
		} as NodeJS.ProcessEnv);
		const result = await runVulnWorkbenchSecurityDiagnostic({
			target: { repoRoot: "/workspace/project", targetFiles: [] },
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

	it("reads path-based oracle settings without scan profile tuning", () => {
		const settings = readVulnWorkbenchCliSettings({
			NIGHTWORKERS_VULNWORKBENCH_PROFILE: "agent-output",
			NIGHTWORKERS_VULNWORKBENCH_TIMEOUT_SECONDS: "1200",
		} as NodeJS.ProcessEnv);

		expect("defaultProfile" in settings).toBe(false);
		expect(settings.timeoutSeconds).toBe(1200);
	});

	it("passes only minimal process environment to the vulnWorkbench CLI", () => {
		const env = buildVulnWorkbenchCliEnv({
			DATABASE_URL: "file:/Users/y.noguchi/Code/nightWorkers/sqlite.db",
			PATH: "/usr/bin",
			TMPDIR: "/tmp",
			HOME: "/Users/y.noguchi",
			OPENAI_API_KEY: "host-api-key",
			AZURE_OPENAI_API_KEY: "host-azure-key",
			NIGHTWORKERS_VULNWORKBENCH_PROFILE: "agent-output",
		} as NodeJS.ProcessEnv);

		expect(env.DATABASE_URL).toBeUndefined();
		expect(env.PATH?.split(":")).toContain("/usr/bin");
		expect(env.PATH?.split(":")).toContain("/opt/homebrew/bin");
		expect(env.TMPDIR).toBe("/tmp");
		expect(env.HOME).toBeUndefined();
		expect(env.OPENAI_API_KEY).toBeUndefined();
		expect(env.AZURE_OPENAI_API_KEY).toBeUndefined();
		expect(env.NIGHTWORKERS_VULNWORKBENCH_PROFILE).toBeUndefined();
	});

	it("runs path-based oracle command and maps scanner-backed findings", async () => {
		const calls: Array<{
			cwd: string;
			args: string[];
			timeoutSeconds: number;
		}> = [];
		const result = await runVulnWorkbenchSecurityDiagnostic({
			target: {
				repoRoot: "/workspace/project",
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
				timeoutSeconds: 600,
			},
			runCommand: async (cwd, args, timeoutSeconds) => {
				calls.push({ cwd, args, timeoutSeconds });
				return {
					command: {
						command: `bun ${args.join(" ")}`,
						exitCode: 3,
						summary: "security action required",
					},
					output: JSON.stringify({
						ok: false,
						status: "security_action_required",
						project: {
							id: "vw-project-1",
							repoPath: "/workspace/project",
							created: true,
						},
						scan: {
							scanRunId: "scan-1",
							profile: "agent-output",
							findingCount: 2,
							highOrCriticalCount: 1,
							coverage: {
								completed: 2,
								skipped: 0,
								failed: 1,
								gaps: [
									{
										code: "failed:osv",
										message: "OSV did not complete.",
									},
								],
							},
							findingsTruncated: false,
							blockingFingerprints: ["fingerprint-1"],
							findings: [
								{
									id: "finding-1",
									fingerprint: "fingerprint-1",
									severity: "high",
									tool: "semgrep",
									ruleId: "dockerfile.security.missing-user.missing-user",
									title:
										"By not specifying a USER, a program in the container may run as root.",
									location: {
										path: "/workspace/project/Dockerfile",
										line: 18,
									},
									recommendation:
										"Dockerfile に non-root の user/group 作成を追加し、最後に USER でそのユーザーへ切り替えてください。",
								},
							],
						},
						review: {
							status: "completed",
							reviewId: "review-1",
							improvementRequest: "認可境界の回帰テストを追加してください。",
						},
						nextAction: "apply_security_fix",
					}),
					scanRunId: "scan-1",
				};
			},
		});

		expect(result.ok).toBe(true);
		expect(result.projectId).toBe("vw-project-1");
		expect(result.projectPath).toBe("/workspace/project");
		expect(result.profile).toBe("agent-output");
		expect(result.scanRunId).toBe("scan-1");
		expect(result.findingCount).toBe(2);
		expect(result.highOrCriticalCount).toBe(1);
		expect(result.coverage).toEqual({
			completed: 2,
			skipped: 0,
			failed: 1,
			gaps: [{ code: "failed:osv", message: "OSV did not complete." }],
		});
		expect(result.reviewStatus).toBe("completed");
		expect("reportPath" in result).toBe(false);
		expect(result.topFindings).toHaveLength(1);
		expect(result.topFindings[0]).toMatchObject({
			severity: "high",
			ruleId: "dockerfile.security.missing-user.missing-user",
			location: { path: "/workspace/project/Dockerfile", line: 18 },
		});
		expect(result.improvementRequest).toContain("認可境界");
		expect(calls).toHaveLength(1);
		expect(calls[0]?.cwd).toBe("/workspace/vulnWorkbench");
		expect(calls[0]?.args).toEqual([
			"run",
			"api/cli/oracle-security.ts",
			"--project-path",
			"/workspace/project",
		]);
		expect(calls[0]?.timeoutSeconds).toBe(600);
		const reviewFinding = findingForVulnWorkbenchResult(result);
		expect(reviewFinding).toMatchObject({
			severity: "warning",
			title:
				"vulnWorkbench security diagnostic reported scanner-backed findings",
		});
		expect(reviewFinding.body).toContain("対応が必要な検出");
		expect(reviewFinding.body).toContain("/workspace/project/Dockerfile:18");
		expect(reviewFinding.body).toContain("Dockerfile に non-root");
		expect(reviewFinding.body).toContain(
			"semgrep / dockerfile.security.missing-user.missing-user",
		);
		expect(reviewFinding.body).not.toContain("reportPath");
		expect(reviewFinding.body).not.toContain("/outside/vulnWorkbench");
	});

	it("passes an explicit profile, diff target digest, and finding limit to the oracle", async () => {
		const calls: string[][] = [];
		const digest = "a".repeat(64);
		await runVulnWorkbenchSecurityDiagnostic({
			target: { repoRoot: "/workspace/project", targetFiles: [] },
			artifactDir: "/tmp/nightworkers-review",
			settings: {
				enabled: true,
				cwd: "/workspace/vulnWorkbench",
				timeoutSeconds: 960,
			},
			profile: "diff-basic-security",
			scanTarget: "working_tree",
			expectedTargetDigest: digest,
			findingLimit: 1_000,
			runCommand: async (_cwd, args) => {
				calls.push(args);
				return {
					command: { command: "bun", exitCode: 0, summary: "completed" },
					output: JSON.stringify({
						ok: true,
						status: "completed",
						project: {
							id: "project-1",
							repoPath: "/workspace/project",
							created: false,
						},
						scan: {
							scanRunId: "scan-1",
							profile: "diff-basic-security",
							findingCount: 0,
							highOrCriticalCount: 0,
							findingsTruncated: false,
							blockingFingerprints: [],
							findings: [],
						},
						review: { status: "completed", reviewId: "review-1" },
						nextAction: "none",
					}),
					scanRunId: "scan-1",
				};
			},
		});
		expect(calls[0]).toEqual([
			"run",
			"api/cli/oracle-security.ts",
			"--project-path",
			"/workspace/project",
			"--profile",
			"diff-basic-security",
			"--target",
			"working-tree",
			"--expected-target-digest",
			digest,
			"--finding-limit",
			"1000",
		]);
	});
});
