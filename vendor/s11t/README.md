# Vendored S11t canary

This directory is managed by S11t's `pnpm deploy:nightworkers-canary` command.
NightWorkers consumes these immutable tarballs through root `file:` dependencies.
The runtime override is required so Bun resolves the CLI's transitive runtime
dependency from the same tarball instead of querying the npm registry.

- Version: `0.1.0-canary-f3fa8cb8d15f603f1c838446b0868fe75f2e48c1`
- S11t commit: `f3fa8cb8d15f603f1c838446b0868fe75f2e48c1`
- Runtime SHA-512: `b471888a870b00037db49e11798e45dabc54038d8d2e06d58814e7e92f4a658dc44606b8453f1d9ca81179fd3fef768674a9c1f9d4a0027386b18effe69b60ef`
- CLI SHA-512: `782b967f74abc27f4e589709851e61cb77e20e0353ce57153d7b3973d0593cc97d38deca535c738766635df4217b0654c69d2ad02d69e7beb1a6f26d038b7434`
- Supported Node.js versions: `^20.19.0 || ^22.0.0 || ^24.0.0`

The tarballs passed S11t's release dry-run, package-content allowlist, isolated
ESM consumer, type, runtime, CLI, and production dependency audit gates before
being copied here. Keep the exact version pinned during dogfooding.
