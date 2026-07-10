import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';

const outputDirectory = 'dist-api-desktop';
const lockPath = `${outputDirectory}.lock`;
const temporaryOutputDirectory = `${outputDirectory}.tmp-${process.pid}-${Date.now()}`;
const entryNames = ['index', 'task-run-worker', 'queue-worker'];
const outputFiles = entryNames.map((name) => `${outputDirectory}/${name}.js`);
const temporaryOutputFiles = entryNames.map(
	(name) => `${temporaryOutputDirectory}/${name}.js`,
);

async function acquireBuildLock() {
	const deadline = Date.now() + 30_000;
	const staleLockAgeMs = 5 * 60 * 1000;
	while (true) {
		try {
			return fs.openSync(lockPath, 'wx');
		} catch (error) {
			if (error?.code !== 'EEXIST' || Date.now() >= deadline) throw error;
			try {
				const lockAgeMs = Date.now() - fs.statSync(lockPath).mtimeMs;
				if (lockAgeMs > staleLockAgeMs) {
					fs.rmSync(lockPath, { force: true });
					continue;
				}
			} catch (statError) {
				if (statError?.code !== 'ENOENT') throw statError;
			}
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
	}
}

const lockHandle = await acquireBuildLock();
let lockReleased = false;
const releaseBuildLock = () => {
	if (lockReleased) return;
	lockReleased = true;
	fs.closeSync(lockHandle);
	fs.rmSync(lockPath, { force: true });
};
process.once('exit', releaseBuildLock);

fs.rmSync(temporaryOutputDirectory, { recursive: true, force: true });

await build({
  entryPoints: {
    index: 'api/index.ts',
    'task-run-worker': 'api/workers/task-run-worker.ts',
    'queue-worker': 'api/workers/queue-worker.ts',
  },
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
	outdir: temporaryOutputDirectory,
  banner: {
    js: "import { createRequire as __nightworkersCreateRequire } from 'node:module';import { fileURLToPath as __nightworkersFileURLToPath } from 'node:url';import { dirname as __nightworkersDirname } from 'node:path';const require = __nightworkersCreateRequire(import.meta.url);const __filename = __nightworkersFileURLToPath(import.meta.url);const __dirname = __nightworkersDirname(__filename);",
  },
  external: ['argon2', '@openai/codex-sdk', '@openai/codex'],
});

for (const outputFile of temporaryOutputFiles) {
  const syntaxCheck = spawnSync(process.execPath, ['--check', outputFile], {
    encoding: 'utf8',
  });
  if (syntaxCheck.status !== 0) {
		fs.rmSync(temporaryOutputDirectory, { recursive: true, force: true });
    throw new Error(
      `Desktop backend bundle failed Node ESM syntax validation for ${outputFile}:\n${syntaxCheck.stderr || syntaxCheck.stdout}`,
    );
  }
}

fs.rmSync(outputDirectory, { recursive: true, force: true });
fs.renameSync(temporaryOutputDirectory, outputDirectory);
releaseBuildLock();

console.log(`Desktop backend bundle syntax validated: ${outputFiles.join(', ')}`);
