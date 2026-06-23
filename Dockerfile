# ---------- Build stage ----------
FROM oven/bun:1.2-alpine AS builder

WORKDIR /app

# 👇 ADICIONE SUAS CHAVES AQUI COMO ARGUMENTOS PADOÕES (Substitua pelos seus dados reais do Supabase)
ARG SUPABASE_URL="https://wfkqfhtyptmkqyisebkr.supabase.co"
ARG SUPABASE_PUBLISHABLE_KEY="sb_publishable_h1o-T62OuPnnyXdS2Vzxlg_ms8MuNYb"

# 👇 Vincula os argumentos às variáveis de ambiente que o Vite/TanStack vai ler no build
ENV SUPABASE_URL=$SUPABASE_URL
ENV SUPABASE_PUBLISHABLE_KEY=$SUPABASE_PUBLISHABLE_KEY
ENV VITE_SUPABASE_URL=$SUPABASE_URL
ENV VITE_SUPABASE_PUBLISHABLE_KEY=$SUPABASE_PUBLISHABLE_KEY

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
COPY --from=builder /app/.output ./.output

# Variáveis padrão (sobrescritas pelo docker-compose/.env em produção)
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

EXPOSE 3000

# Iniciar o servidor TanStack Start gerado para Node.js
CMD ["node", ".output/server/index.mjs"]
