FROM oven/bun:1.3.14-alpine AS base

# Dependencies Stage
FROM base AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Builder Stage
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Build both frontend and backend
RUN bun run build
RUN bun install --production --frozen-lockfile

# Runner Stage
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=39173

COPY --from=builder /app/package.json ./
# Only production dependencies needed
COPY --from=builder --chown=bun:bun /app/node_modules ./node_modules
COPY --from=builder --chown=bun:bun /app/dist-api ./dist-api
COPY --from=builder --chown=bun:bun /app/dist ./dist

EXPOSE 39173

USER bun

CMD ["bun", "dist-api/index.js"]
