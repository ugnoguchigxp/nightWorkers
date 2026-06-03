# NightWorkers LP SEO Checklist

## Technical
- Canonical URL: `https://ugnoguchigxp.github.io/nightWorkers/`
- Sitemap: `https://ugnoguchigxp.github.io/nightWorkers/sitemap.xml`
- Robots: `https://ugnoguchigxp.github.io/nightWorkers/robots.txt`
- OG image: `https://ugnoguchigxp.github.io/nightWorkers/assets/img/og-image.jpg`
- Public artifact directory: root `docs/`
- Editable source directory: `github-pages/site/`

## Local Verification
```bash
bun run scripts/optimize-hero-image.ts
./build-preview.sh
./build-dist.sh
bash scripts/run-lighthouse.sh
bun run scripts/assert-lighthouse.ts reports/lighthouse.json 90 100
```

Run these commands from `github-pages/`.

## Operations
- Add a URL-prefix property for `https://ugnoguchigxp.github.io/nightWorkers/` in Search Console.
- Submit `https://ugnoguchigxp.github.io/nightWorkers/sitemap.xml`.
- Inspect the top page URL and request indexing.
- Re-check index status after 7, 14, and 30 days.
