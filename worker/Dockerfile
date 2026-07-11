FROM node:20-bookworm

RUN apt-get update \
  && apt-get install -y --no-install-recommends git bash ca-certificates build-essential \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --include=dev --include=optional --no-audit --no-fund

COPY . .

RUN useradd -m -u 10001 repodiet
USER repodiet

ENV NODE_ENV=production
ENV WORKER_POLL_MS=5000

CMD ["npx", "tsx", "worker/src/index.ts"]
