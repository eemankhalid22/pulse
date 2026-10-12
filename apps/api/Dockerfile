FROM node:20-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY prisma ./prisma
RUN pnpm exec prisma generate

COPY tsconfig.json ./
COPY src ./src

ENV NODE_ENV=production
EXPOSE 3001
CMD ["sh", "-c", "pnpm exec prisma db push --skip-generate && pnpm exec tsx src/index.ts"]