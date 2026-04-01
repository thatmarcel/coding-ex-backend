FROM oven/bun:latest AS base

WORKDIR /app

FROM base AS builder

COPY . .

RUN bun install --frozen-lockfile --production

FROM base

WORKDIR /app

COPY --from=builder /app .

EXPOSE 4000

ENTRYPOINT [ "bun", "start" ]
