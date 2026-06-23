# ---------- Build stage ----------
FROM oven/bun:1.2-alpine AS builder

WORKDIR /app

# Copiar manifests de dependências primeiro para aproveitar o cache
COPY package.json bun.lock* ./

# Instalar dependências (bun.lock compatível)
RUN bun install --frozen-lockfile

# Copiar o restante do projeto
COPY . .

# Build com preset node-server para rodar em VPS/Docker
ENV BUILD_PRESET=node-server
RUN bun run build

# ---------- Runtime stage ----------
FROM node:22-alpine AS runner

WORKDIR /app

# Copiar a saída do build (servidor SSR + assets estáticos)
COPY --from=builder /app/dist ./dist

# Variáveis padrão (sobrescritas pelo docker-compose/.env em produção)
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

EXPOSE 3000

# Iniciar o servidor TanStack Start gerado para Node.js
CMD ["node", "dist/server/index.mjs"]
