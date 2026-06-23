# ---------- Build stage ----------
FROM oven/bun:1.2 AS builder
WORKDIR /app

# Install deps (better cache)
COPY package.json bun.lockb* bunfig.toml* ./
RUN bun install --frozen-lockfile || bun install

# Copy source and build with the Node server preset (for VPS/Docker)
COPY . .
ENV BUILD_PRESET=node-server
RUN bun run build

# ---------- Runtime stage ----------
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

# Nitro's node-server preset produces a self-contained .output dir
COPY --from=builder /app/.output ./.output

EXPOSE 3000

CMD ["node", ".output/server/index.mjs"]
