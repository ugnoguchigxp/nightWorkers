# Vendored S11t canary

This directory is managed by S11t's `pnpm deploy:nightworkers-canary` command.
NightWorkers consumes these immutable tarballs through root `file:` dependencies.
The runtime override is required so Bun resolves the CLI's transitive runtime
dependency from the same tarball instead of querying the npm registry.

- Version: `0.1.0-canary-6ed4c5fe9c420bb498515ca843b144f6232d7fec`
- S11t commit: `6ed4c5fe9c420bb498515ca843b144f6232d7fec`
- Runtime SHA-512: `5c8971624eac383a1bf7c53d0226ec8c8b64c5405cb0d5a7fb6f57734f275514d9da163406ca069aea051b656e61b23d82ecfc4c528f6c2485bf75180f1b1f7a`
- CLI SHA-512: `b2f2c2f3a2576d09f1f621f175c999ebe773ff56bd8d0eed30cad32eb39757ffe9a7d65ba8d6cb8017606e972610eda0e733961f6c113fd4e18e4dd21dff5159`
- Supported Node.js versions: `^20.19.0 || ^22.0.0 || ^24.0.0`

The tarballs passed S11t's release dry-run, package-content allowlist, isolated
ESM consumer, type, runtime, CLI, and production dependency audit gates before
being copied here. Keep the exact version pinned during dogfooding.
