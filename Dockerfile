# Stage 1: Build server
FROM node:22-alpine AS builder

WORKDIR /app

# Copy server package manifest
COPY apps/server/package.json ./

# Install server dependencies
RUN npm install --legacy-peer-deps

# Copy server source code and configurations
COPY apps/server/ ./

# Build the TypeScript project
RUN npm run build

# Remove development dependencies for lean production image
RUN npm prune --omit=dev --legacy-peer-deps

# Stage 2: Production runner
FROM node:22-alpine AS runner

WORKDIR /app

# Run as non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

ENV NODE_ENV=production
ENV PORT=3000

# Copy compiled files and production node_modules from builder
COPY --from=builder --chown=appuser:appgroup /app/dist ./dist
COPY --from=builder --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --from=builder --chown=appuser:appgroup /app/package.json ./

# Ensure storage directories exist and are owned by appuser
RUN mkdir -p /app/private_uploads && chown -R appuser:appgroup /app

USER appuser

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

CMD ["node", "dist/index.js"]
