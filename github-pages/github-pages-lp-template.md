# NightWorkers GitHub Pages LP

This project keeps the GitHub Pages landing page inside the NightWorkers repository.

## Directory Rules
- `github-pages/site/` is the editable Jekyll source.
- `docs/` is the public GitHub Pages artifact directory at the repository root.
- `github-pages/.preview/` is local-only preview output.
- `github-pages/reports/` stores Lighthouse output and screenshots.

Do not edit generated files in `docs/` by hand. Update `github-pages/site/`, then rebuild from `github-pages/`.

## Metadata
```txt
owner=ugnoguchigxp
repo=nightWorkers
product_name=NightWorkers
pages_url=https://ugnoguchigxp.github.io/nightWorkers/
baseurl=/nightWorkers
github_url=https://github.com/ugnoguchigxp/nightWorkers
```

## Standard Workflow
```bash
bun run scripts/optimize-hero-image.ts
./build-preview.sh
./build-dist.sh
bash scripts/run-lighthouse.sh
bun run scripts/assert-lighthouse.ts reports/lighthouse.json 90 100
```

Run these commands from `github-pages/`.

Local preview uses `_config.local.yml`, so it serves from `/`:
```bash
cd .preview
npx serve .
```

Production output uses `_config.yml`, so all public asset paths use `/nightWorkers`.

## Current LP Assets
- Hero source: `github-pages/site/assets/img/nightworkers-hero.png`
- Hero WebP: `github-pages/site/assets/img/nightworkers-hero.webp`
- OG image: `github-pages/site/assets/img/og-image.jpg`
- Favicon: `github-pages/site/assets/img/favicon.svg`

## Definition of Done
- `github-pages/site/` contains the source of truth.
- root `docs/` has been regenerated.
- Canonical, robots, sitemap, manifest, and image paths use `/nightWorkers`.
- Lighthouse passes Performance >= 90 and SEO = 100.
