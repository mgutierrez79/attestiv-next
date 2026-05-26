# syntax=docker/dockerfile:1

FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# `npm install` (not `npm ci`) so the Linux build can resolve
# platform-specific optional binaries (e.g. @emnapi/* pulled by
# @tailwindcss/oxide-wasm32-wasi) that a Windows-host `npm install`
# leaves out of the lock. The lock stays authoritative for declared
# dependencies; `npm install` only fills in resolvable platform gaps.
# Adds --no-audit --no-fund to keep build output clean.
RUN npm install --no-audit --no-fund

FROM node:24-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
# https-server.mjs wraps the standalone server.js with optional HTTPS
# termination. Falls back to plain HTTP when no cert env vars are set,
# so the image works for both dev and pilot.
COPY --chown=nextjs:nodejs https-server.mjs ./https-server.mjs

USER nextjs
EXPOSE 3000

CMD ["node", "https-server.mjs"]
