#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$ROOT_DIR/.." && pwd)"

docker run --rm \
  -v "$PROJECT_DIR":/srv/nightworkers \
  -w /srv/nightworkers/github-pages \
  jekyll/jekyll:latest \
  sh -lc "bundle config set path vendor/bundle && bundle install && bundle exec jekyll build"
