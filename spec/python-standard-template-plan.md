# python-standard テンプレートリポジトリ計画

## 概要

`python-standard` は、`hono-standard` に対応する Python / FastAPI 系の標準テンプレートリポジトリとして作る。

目的は、Python 指定または FastAPI が適切な新規 Web/API プロジェクトで、AI がまっさらな scaffold を毎回生成せず、固定 tag のテンプレートから開始できる状態を作ること。`hono-standard` と同じく、継続保守する差分は `variant/*` branch、固定配布点は tag、直交差分は `overlay/*` branch として扱う。

初期 default は `variant/sqlite` とし、tag は `sqlite-v1.0.0` を想定する。通常 server runtime と Cloudflare Workers Python runtime は前提が大きく異なるため、Cloudflare は overlay ではなく独立 variant とする。

## 基本方針

- repo 名は `python-standard`。
- baseline は Python / FastAPI / SQLite / React + Vite の full-stack template。
- package / environment manager は `uv`。
- lint / format は `ruff`。
- backend は `FastAPI`。
- DB model は `SQLModel`、migration は `Alembic`。
- frontend は `React + Vite + Tailwind CSS + shadcn/ui`。
- DB や runtime の大きな違いは `variant/*` に分ける。
- SSR / SSG / Celery / OpenTelemetry のような直交差分は `overlay/*` に分ける。
- `main` は共通 baseline 開発用であり、NightWorkers からの通常利用は tag clone を優先する。

## 推奨スタック

### Backend

| 用途 | Package |
| --- | --- |
| API framework | `fastapi` |
| ASGI server | `uvicorn[standard]` |
| validation | `pydantic` |
| settings | `pydantic-settings` |
| ORM / model | `sqlmodel` |
| migration | `alembic` |
| SQLite async | `aiosqlite` |
| PostgreSQL | `psycopg[binary]` |
| pgvector | `pgvector` |
| testing | `pytest`, `pytest-asyncio`, `httpx`, `pytest-cov` |
| lint / format | `ruff` |
| type check | `pyright` first, `mypy` optional |
| password hashing | `pwdlib` or `argon2-cffi` |
| rate limit | `slowapi` for baseline, Redis-backed limiter only in server variants when needed |
| security headers | small local middleware first; add package only if it stays simple |

### Frontend

| 用途 | Package |
| --- | --- |
| frontend | `react`, `vite`, `typescript` |
| styling | `tailwindcss`, `shadcn/ui` |
| routing | `@tanstack/react-router` |
| data fetching | `@tanstack/react-query` |
| forms | `react-hook-form` when forms are present |
| validation bridge | generated OpenAPI types or shared client types, not ad-hoc duplicated schemas |

### Avoid in baseline

- OAuth provider 固定。
- Celery / Redis。
- OpenTelemetry。
- S3 / R2 upload。
- pgvector。
- WebSocket。
- full RBAC。
- multi-tenant。
- heavy admin UI。

これらは variant または overlay に分ける。

## Repository 構造

```text
python-standard/
  backend/
    app/
      api/
        routes/
        deps.py
      core/
        config.py
        logging.py
        security.py
      db/
        session.py
        migrate.py
      modules/
        health/
        users/
      models/
      schemas/
      main.py
    tests/
    alembic/
    pyproject.toml
    uv.lock
  frontend/
    src/
    package.json
    vite.config.ts
  docker-compose.yml
  README.md
  docs/
    template-variant-management.md
```

### Backend module rules

- `api/routes`: FastAPI router と request / response wiring。
- `modules/<domain>/service.py`: business logic。
- `modules/<domain>/repository.py`: DB access。
- `schemas`: request / response schema。
- `models`: SQLModel table model。
- `core/config.py`: pydantic-settings による env 読み込み。
- `core/security.py`: security headers、CORS、CSRF/rate limit helper。

### Frontend module rules

- `src/routes`: TanStack Router。
- `src/modules/<domain>/components`: domain UI。
- `src/modules/<domain>/hooks`: data fetching / UI state。
- `src/lib/api`: OpenAPI client or typed fetch wrapper。
- 生 `fetch` を各 component に散らさない。

## Branch / tag 方針

### Canonical branches

| Branch | 用途 |
| --- | --- |
| `main` | 共通 baseline。直接利用より variant の土台。 |
| `variant/sqlite` | default。local-first / prototype / Docker 不要。 |
| `variant/postgres` | 通常 Web app / team / deploy 前提。 |
| `variant/pgvector` | RAG / semantic search / AI app。 |
| `variant/turso` | libSQL / Turso / distributed SQLite。 |
| `variant/cloudflare` | Cloudflare Python Workers runtime。通常 FastAPI server とは別 runtime。 |
| `variant/api-only` | frontend なし。API service 専用。 |
| `variant/auth` | auth を厚くした variant。 |

### Overlay branches

| Branch | 用途 |
| --- | --- |
| `overlay/ssr` | React/Vite SSR。DB variant と直交。 |
| `overlay/ssg` | prerender / static route generation。 |
| `overlay/celery` | Celery + Redis worker。 |
| `overlay/opentelemetry` | traces / metrics / structured observability。 |

### Tag naming

```text
sqlite-v1.0.0
postgres-v1.0.0
pgvector-v1.0.0
turso-v1.0.0
cloudflare-v1.0.0
api-only-v1.0.0
auth-v1.0.0
overlay-ssr-v1.0.0
overlay-ssg-v1.0.0
```

NightWorkers からの default は `sqlite-v1.0.0`。

## Variant 要件

### `variant/sqlite`

Default baseline。

含める:

- FastAPI。
- SQLite。
- SQLModel。
- Alembic。
- uv / ruff / pytest / pyright。
- React + Vite + Tailwind CSS + shadcn/ui。
- health endpoints。
- OpenAPI docs。
- CORS。
- security headers。
- local rate limit。
- minimal user/account sample は必要最小限。

含めない:

- Docker 必須化。
- PostgreSQL。
- OAuth provider。
- Celery。
- pgvector。

検証:

```bash
uv sync
uv run ruff check .
uv run ruff format --check .
uv run pyright
uv run pytest
pnpm -C frontend install
pnpm -C frontend build
```

### `variant/postgres`

通常 deploy 用。

差分:

- PostgreSQL。
- `psycopg[binary]`。
- Docker Compose。
- readiness check。
- migration / seed が fresh DB で通る。
- connection pool 方針を README に明記。

注意:

- production rate limit は in-memory だけに依存しない。
- compose の DB 名 / user / password / port と `.env.example` を一致させる。

### `variant/pgvector`

RAG / semantic search 用。

差分:

- PostgreSQL + pgvector。
- embedding table。
- vector index。
- distance metric の最小例。
- embedding provider は env で差し替え。
- dummy embedding provider を test 用に持つ。

含めない:

- app 固有の RAG prompt。
- 特定 provider への固定。
- 大きな sample corpus。

### `variant/turso`

libSQL / Turso 用。

差分:

- local SQLite fallback。
- remote Turso URL / auth token。
- network failure 時の error behavior。
- migration strategy の制約を README に明記。

注意:

- token を repo に含めない。
- local-first と remote-first の違いを明記する。

### `variant/cloudflare`

Cloudflare Python Workers 用。通常の `uvicorn` server variant ではない。

含める:

- Cloudflare Python Workers。
- FastAPI ASGI adapter。
- `wrangler.toml`。
- D1 / KV binding の最小例。
- pure Python package 前提。
- Workers runtime で動く最小 API。

含めない:

- `uvicorn` 前提。
- socket server 前提。
- local filesystem persistence。
- `psycopg` / `asyncpg` など通常 PostgreSQL driver 前提。
- heavy native dependency。

注意:

- Cloudflare Python Workers は Pyodide / Workers runtime 上で動くため、通常 Linux server と同じ package 前提にしない。
- FastAPI はサポート対象だが、DB や filesystem、native extension は別設計にする。
- `variant/cloudflare` は `variant/postgres` からの小差分ではなく、runtime variant として独立させる。

### `variant/api-only`

Backend only。

含める:

- FastAPI backend。
- OpenAPI。
- tests。
- Dockerfile optional。
- frontend なし。

用途:

- CLI / API service。
- frontend が別 repo。
- mobile app backend。

### `variant/auth`

認証厚め。

候補:

- `fastapi-users`。
- JWT。
- cookie session。
- password reset stub。
- email verification stub。
- OAuth provider config placeholder。

注意:

- 認証はプロダクト差が大きいので baseline には入れすぎない。
- OAuth provider 固定は避ける。
- secret handling と cookie policy を README に明記する。

## Overlay 要件

### `overlay/ssr`

- React/Vite SSR。
- client hydration。
- SSR build script。
- browser-only API の隔離。
- DB variant には依存しない。

### `overlay/ssg`

- prerender route manifest。
- static route generation。
- build-time data loading。
- user-specific / auth-required route を静的生成しない。

### `overlay/celery`

- Celery。
- Redis。
- worker process。
- retry / idempotency sample。
- Docker Compose worker service。

Baseline には入れない。

### `overlay/opentelemetry`

- OpenTelemetry。
- request id。
- structured logging。
- trace export。
- metrics endpoint or exporter。

Baseline には入れない。

## README に書くべき default policy

```md
技術スタック指定がない Python Web/API project では `variant/sqlite` を default とする。
PostgreSQL、pgvector、Turso、Cloudflare Workers などの要件がある場合だけ対応 variant を選ぶ。
SSR / SSG / Celery / OpenTelemetry は DB variant と直交する overlay として扱う。
Cloudflare Workers は通常 server runtime と前提が異なるため、overlay ではなく `variant/cloudflare` を使う。
```

## NightWorkers 連携想定

`python-standard` が完成したら、NightWorkers の template registry へ次を追加する。

```ts
{
  id: 'python-standard',
  repoUrl: 'https://github.com/ugnoguchigxp/python-standard.git',
  defaultVariant: 'sqlite',
  variants: {
    sqlite: { ref: 'sqlite-v1.0.0' },
    postgres: { ref: 'postgres-v1.0.0' },
    pgvector: { ref: 'pgvector-v1.0.0' },
    turso: { ref: 'turso-v1.0.0' },
    cloudflare: { ref: 'cloudflare-v1.0.0' },
    apiOnly: { ref: 'api-only-v1.0.0' },
    auth: { ref: 'auth-v1.0.0' }
  },
  overlays: {
    ssr: { ref: 'overlay-ssr-v1.0.0' },
    ssg: { ref: 'overlay-ssg-v1.0.0' },
    celery: { ref: 'overlay-celery-v1.0.0' },
    opentelemetry: { ref: 'overlay-opentelemetry-v1.0.0' }
  }
}
```

選択ルール:

- Python / FastAPI 指定なら `python-standard`。
- Python 指定なし、一般 Web app なら `hono-standard` が優先。
- API-only / ML / Python ecosystem が明確なら `python-standard`。
- 未指定 Python project の default は `variant/sqlite`。
- Cloudflare Workers 指定なら `variant/cloudflare`。
- RAG / semantic search なら `variant/pgvector`。

## 初期作成順序

1. `main` に最小共通構造を作る。
2. `variant/sqlite` を作り、`sqlite-v1.0.0` を切る。
3. `variant/postgres` を作り、Docker Compose と migration を確認する。
4. `variant/pgvector` を作る。
5. `variant/turso` を作る。
6. `variant/cloudflare` を別 runtime として作る。
7. `variant/api-only` と `variant/auth` を必要に応じて作る。
8. `overlay/ssr` / `overlay/ssg` は frontend 要件が固まってから作る。

## Release checklist

- `uv sync` が通る。
- `uv run ruff check .` が通る。
- `uv run ruff format --check .` が通る。
- `uv run pyright` または `uv run mypy` が通る。
- `uv run pytest` が通る。
- migration が fresh DB で通る。
- frontend build が通る。
- `.env`、local DB、node_modules、venv、cache、coverage artifact が snapshot に含まれない。
- tag は `<variant>-v<major>.<minor>.<patch>` 形式。
- README に variant 固有の起動手順がある。

## Cloudflare variant の判定

Cloudflare は Python Workers で FastAPI を動かせる。ただし、通常 server deployment と同じではない。

`variant/cloudflare` を使う条件:

- Cloudflare Workers で deploy したい。
- D1 / KV / R2 binding を使いたい。
- edge runtime の制約を受け入れられる。

使わない条件:

- 通常 PostgreSQL driver を使いたい。
- native dependency を多用したい。
- local filesystem persistence が必要。
- 長時間処理や background worker が必要。

この場合は `variant/postgres` や `overlay/celery` を使う。
