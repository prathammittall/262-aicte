# Stage 1: Prune monorepo for server only
FROM node:20-alpine AS pruner
RUN apk add --no-cache libc6-compat
WORKDIR /app
RUN npm install -g turbo@^2
COPY . .
RUN turbo prune server --docker

# Stage 2: Install dependencies & build
FROM node:20-alpine AS builder
RUN apk add --no-cache libc6-compat
WORKDIR /app

# First install dependencies using the pruned lockfile and manifests (cached layer)
COPY --from=pruner /app/out/json/ .
RUN npm ci

# Copy full source of pruned workspace and build
COPY --from=pruner /app/out/full/ .
RUN npx turbo run build --filter=server

# Prune devDependencies to keep the production image lean
RUN npm prune --omit=dev --legacy-peer-deps

# Stage 3: Production runner
FROM node:20-alpine AS runner
RUN apk add --no-cache libc6-compat
WORKDIR /app

RUN addgroup -S appgroup && adduser -S appuser -G appgroup

ENV NODE_ENV=production
ENV PORT=3000

# Copy production node_modules from builder
COPY --from=builder --chown=appuser:appgroup /app/node_modules ./node_modules

# Copy built server output and package manifest
COPY --from=builder --chown=appuser:appgroup /app/apps/server/dist ./dist
COPY --from=builder --chown=appuser:appgroup /app/apps/server/package.json ./package.json

# Ensure storage directory exists and is owned by appuser
RUN mkdir -p /app/private_uploads && chown -R appuser:appgroup /app

USER appuser

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

CMD ["node", "dist/index.js"]
