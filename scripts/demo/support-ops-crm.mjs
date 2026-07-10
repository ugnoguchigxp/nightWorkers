import { execFileSync } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const demoRoot = path.join(repoRoot, "demo/support-ops-crm");

const run = (command, args, cwd) =>
	execFileSync(command, args, { cwd, encoding: "utf8", env: process.env });

function runtimePaths(options = {}) {
	const root = path.resolve(
		options.root ?? process.env.NIGHTWORKERS_DEMO_ROOT ?? path.join(repoRoot, ".nightworkers-demo"),
	);
	return {
		root,
		project: path.join(root, "project"),
		runtime: path.join(root, "runtime"),
		evidence: path.join(root, "evidence"),
	};
}

export async function resetDemo(options = {}) {
	await rm(runtimePaths(options).root, { recursive: true, force: true });
}

export async function setupDemo(options = {}) {
	const paths = runtimePaths(options);
	await resetDemo(options);
	await mkdir(paths.root, { recursive: true });
	await cp(path.join(demoRoot, "starter"), paths.project, { recursive: true });
	await mkdir(paths.runtime, { recursive: true });
	await mkdir(paths.evidence, { recursive: true });
	const fixture = JSON.parse(
		await readFile(path.join(demoRoot, "fixture/provider-actions.json"), "utf8"),
	);
	run("git", ["init", "-b", "main"], paths.project);
	run("git", ["add", "."], paths.project);
	run(
		"git",
		[
			"-c",
			"core.hooksPath=/dev/null",
			"-c",
			"user.email=demo@nightworkers.local",
			"-c",
			"user.name=NightWorkers Demo",
			"commit",
			"-m",
			"starter",
		],
		paths.project,
	);
	await writeFile(
		path.join(paths.runtime, "project.json"),
		`${JSON.stringify({ ...fixture.project, localPath: paths.project, status: "registered" }, null, 2)}\n`,
	);
	await writeFile(path.join(paths.runtime, "plan.json"), `${JSON.stringify(fixture.plan, null, 2)}\n`);
	await writeFile(path.join(paths.runtime, "queue.json"), `${JSON.stringify(fixture.queue, null, 2)}\n`);
	return paths;
}

export async function runDemo(options = {}) {
	const paths = runtimePaths(options);
	const fixture = JSON.parse(
		await readFile(path.join(demoRoot, "fixture/provider-actions.json"), "utf8"),
	);
	await cp(
		path.join(demoRoot, fixture.implementation.source),
		path.join(paths.project, fixture.implementation.target),
	);
	const verificationOutput = run(
		fixture.implementation.verify[0],
		fixture.implementation.verify.slice(1),
		paths.project,
	);
	const diff = run("git", ["diff", "--", "."], paths.project);
	if (!diff.includes(fixture.implementation.target)) {
		throw new Error("Demo implementation did not produce the expected Git diff");
	}
	const evidence = {
		schemaVersion: "nightworkers.demo-evidence/v1",
		seed: fixture.seed,
		stages: ["project_registered", "plan_created", "queue_approved", "implementation_applied", "verification_passed", "review_completed"],
		projectPath: paths.project,
		verification: {
			command: fixture.implementation.verify.join(" "),
			status: "passed",
			output: verificationOutput.trim(),
		},
		review: {
			status: "approved",
			changedFiles: [fixture.implementation.target],
			diff,
		},
	};
	await writeFile(path.join(paths.evidence, "review.json"), `${JSON.stringify(evidence, null, 2)}\n`);
	return { paths, evidence };
}

export async function smokeDemo(options = {}) {
	const paths = await setupDemo(options);
	try {
		const result = await runDemo(options);
		if (result.evidence.review.status !== "approved") throw new Error("Demo review did not pass");
		if (result.evidence.stages.length !== 6) throw new Error("Demo lifecycle evidence is incomplete");
		return result;
	} finally {
		if (!options.keep) await resetDemo(options);
	}
}

async function main() {
	const command = process.argv[2];
	if (command === "setup") {
		const paths = await setupDemo();
		console.log(`[demo] Project registered at ${paths.project}`);
		return;
	}
	if (command === "run") {
		const { paths } = await runDemo();
		console.log(`[demo] Review evidence: ${path.join(paths.evidence, "review.json")}`);
		return;
	}
	if (command === "reset") {
		await resetDemo();
		console.log("[demo] runtime reset complete");
		return;
	}
	if (command === "smoke") {
		await smokeDemo();
		console.log("[demo] deterministic lifecycle smoke passed and was reset");
		return;
	}
	throw new Error("Usage: node scripts/demo/support-ops-crm.mjs <setup|run|reset|smoke>");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : error);
		process.exit(1);
	});
}
