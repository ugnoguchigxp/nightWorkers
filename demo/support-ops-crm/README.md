# Support Ops CRM deterministic demo

This credential-free demo executes a disposable Project lifecycle with a fixed
seed: Project registration, Plan creation, Queue approval, source implementation,
test execution, Review, and evidence capture. It changes a real Git worktree and
runs a real test command; it is not a prerecorded transcript.

## Five-minute flow

```bash
bun run demo:setup
bun run demo:run
```

Inspect `.nightworkers-demo/evidence/review.json` and the Git diff under
`.nightworkers-demo/project`. The evidence records each lifecycle stage, the
verification command and output, and the changed files.

Reset all generated Project and runtime data with:

```bash
bun run demo:reset
```

CI uses `bun run demo:smoke`, which performs setup, execution, assertions, and
cleanup in one command. No provider credential or production repository is read.

## Capture procedure

1. Run `bun run demo:setup` and `bun run demo:run`.
2. Register `.nightworkers-demo/project` in the desktop app when capturing UI.
3. Capture Project, Plan, Queue, Run Evidence, and Review surfaces in that order.
4. Store still images under `assets/screenshots/demo/0.1.0/` using
   `01-project.png` through `05-review.png`.
5. Run `bun run demo:reset` after capture. Never include `.nightworkers-demo` or
   local database files in the committed assets.

The fixed seed and evidence schema make screenshots replaceable without changing
the demo outcome contract.
