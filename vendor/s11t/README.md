# Vendored S11t canary

This directory is managed by S11t's `pnpm deploy:nightworkers-canary` command.
NightWorkers consumes these immutable tarballs through root `file:` dependencies.
The runtime override is required so Bun resolves the CLI's transitive runtime
dependency from the same tarball instead of querying the npm registry.

- Version: `0.1.0-canary-cc606d34273d7117a79efb910734657ff130ccce`
- S11t commit: `cc606d34273d7117a79efb910734657ff130ccce`
- Runtime SHA-512: `af56a82db26323d206e336416a8d83704fedf5af6632e65fe206c4d86f03627f064c9bc47dc4c90c4fcde867810f9f064da5ddb8231d66c1aefd6b6305913669`
- CLI SHA-512: `e9dfe623ab112df5b006f573343c0b66ed4c855350f8ad525989a9f766f822294dd9e124ca5b13205f726b796b1310bf12735f8d3c7286d27d98136fdea7b61f`
- Supported Node.js versions: `^20.19.0 || ^22.0.0 || ^24.0.0`

The tarballs passed S11t's release dry-run, package-content allowlist, isolated
ESM consumer, type, runtime, CLI, and production dependency audit gates before
being copied here. Keep the exact version pinned during dogfooding.
