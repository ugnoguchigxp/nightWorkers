import fs from 'node:fs';
import { build } from 'esbuild';

fs.rmSync('dist-api-desktop', { recursive: true, force: true });

await build({
  entryPoints: ['api/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outfile: 'dist-api-desktop/index.js',
  banner: {
    js: "import { createRequire } from 'node:module';import { fileURLToPath } from 'node:url';import { dirname as __nightworkersDirname } from 'node:path';const require = createRequire(import.meta.url);const __filename = fileURLToPath(import.meta.url);const __dirname = __nightworkersDirname(__filename);",
  },
  external: ['argon2', '@openai/codex-sdk', '@openai/codex'],
});
