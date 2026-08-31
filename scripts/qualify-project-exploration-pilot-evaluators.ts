import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import {
	createEvaluatorQualification,
	loadEvaluatorQualificationManifest,
} from "./project-exploration-pilot/qualification";

const parsed = parseArgs({
	args: process.argv.slice(2).filter((arg) => arg !== "--"),
	options: {
		manifest: { type: "string" },
		output: { type: "string" },
	},
	strict: true,
	allowPositionals: false,
});

const manifestPath = requiredPath("--manifest", parsed.values.manifest);
const outputPath = requiredPath("--output", parsed.values.output);
const manifest = await loadEvaluatorQualificationManifest(manifestPath);
const artifact = await createEvaluatorQualification(manifest);
await writeAtomicJson(outputPath, artifact);
process.stdout.write(
	`${JSON.stringify({
		status: artifact.status,
		targetCommit: artifact.targetCommit,
		evaluatorSetFingerprint: artifact.evaluatorSetFingerprint,
		qualificationCount: artifact.qualifications.length,
		output: outputPath,
	})}\n`,
);
if (artifact.status !== "READY") process.exitCode = 2;

function requiredPath(name: string, value: string | undefined) {
	if (!value?.trim()) throw new Error(`${name} is required.`);
	return path.resolve(process.cwd(), value);
}

async function writeAtomicJson(output: string, payload: unknown) {
	await mkdir(path.dirname(output), { recursive: true });
	const temporary = `${output}.tmp-${process.pid}-${Date.now()}`;
	await writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`, {
		encoding: "utf8",
		mode: 0o600,
	});
	await rename(temporary, output);
}
