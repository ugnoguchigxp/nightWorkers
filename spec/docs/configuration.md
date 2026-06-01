# Runtime Configuration Reference

## Core Variables
- `DATABASE_URL`: SQLite/libSQL target
- `AUTH_MODE`: `local`, `oauth`, `both`
- `APP_URL`: base URL for auth callbacks and cookie behavior
- `TRUST_PROXY`: set `true` when proxy headers should be trusted

## OAuth Variables
Enable as needed:
- Google: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`
- GitHub: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_REDIRECT_URI`

## Optional Integration
- `CONTEXT_STILL_ENABLED=true` to enable contextStill-dependent features.

## Local Startup Baseline
```bash
cp .env.example .env
pnpm db:migrate
pnpm db:seed
pnpm dev
```
