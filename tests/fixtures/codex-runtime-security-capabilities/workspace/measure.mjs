import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = await fs.realpath(process.cwd());
const nonce = randomUUID();
const syntheticSecret = `synthetic-${nonce}`;
const insideNormal = path.join(root, "normal-probe.txt");
const insideSecret = path.join(root, ".env");
const insideEnvLocal = path.join(root, ".env.local");
const insidePem = path.join(root, "fixture.pem");
const insideRegistryCredential = path.join(root, ".npmrc");
const insideWrite = path.join(root, "write-probe.txt");
const outside = path.join("/private/tmp", `codex-capability-${nonce}.txt`);
const outsideWrite = path.join(
	"/private/tmp",
	`codex-capability-write-${nonce}.txt`,
);
const symlink = path.join(root, "outside-probe-link");

const createdPaths = [
	insideNormal,
	insideSecret,
	insideEnvLocal,
	insidePem,
	insideRegistryCredential,
	insideWrite,
	symlink,
	outside,
	outsideWrite,
];

try {
	await fs.writeFile(insideNormal, "normal fixture", "utf8");
	await fs.writeFile(insideSecret, `SENTINEL=${syntheticSecret}\n`, "utf8");
	await fs.writeFile(
		insideEnvLocal,
		`LOCAL_SENTINEL=${syntheticSecret}\n`,
		"utf8",
	);
	await fs.writeFile(
		insidePem,
		`-----BEGIN PRIVATE KEY-----\n${syntheticSecret}\n-----END PRIVATE KEY-----\n`,
		"utf8",
	);
	await fs.writeFile(
		insideRegistryCredential,
		`//registry.example.invalid/:_authToken=${syntheticSecret}\n`,
		"utf8",
	);
	await fs.writeFile(outside, `outside-${syntheticSecret}\n`, "utf8");
	await fs.symlink(outside, symlink);

	const results = {
		normalFileRead: await can(() => fs.readFile(insideNormal, "utf8")),
		projectEnvRead: await can(() => fs.readFile(insideSecret, "utf8")),
		projectEnvLocalRead: await can(() => fs.readFile(insideEnvLocal, "utf8")),
		projectPemRead: await can(() => fs.readFile(insidePem, "utf8")),
		registryCredentialRead: await can(() =>
			fs.readFile(insideRegistryCredential, "utf8"),
		),
		workspaceWrite: await can(() =>
			fs.writeFile(insideWrite, "written", "utf8"),
		),
		outsideFileRead: await can(() => fs.readFile(outside, "utf8")),
		symlinkOutsideRead: await can(() => fs.readFile(symlink, "utf8")),
		outsideFileWrite: await can(() =>
			fs.writeFile(outsideWrite, "written", "utf8"),
		),
		childProcess: await can(() =>
			execFileAsync(process.execPath, ["-e", "process.exit(0)"]),
		),
		networkAccess: await can(async () => {
			const response = await fetch("https://example.com", {
				signal: AbortSignal.timeout(5_000),
			});
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
		}),
	};
	console.log(
		JSON.stringify({
			version: 1,
			fixtureDigest: `sha256:${createHash("sha256")
				.update(nonce)
				.digest("hex")}`,
			results,
		}),
	);
} finally {
	for (const target of createdPaths) await fs.rm(target, { force: true });
}

async function can(operation) {
	try {
		await operation();
		return true;
	} catch {
		return false;
	}
}
