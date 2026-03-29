# Build stage
FROM node:20-alpine AS builder
WORKDIR /app

# Copy workspace manifests for dependency resolution
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/

# Install dependencies (server + shared workspace)
RUN npm ci --workspace=server --workspace=@watchtogether/shared

# Copy source for type checking and compilation
COPY shared/ shared/
COPY server/ server/
COPY tsconfig.base.json ./

RUN npm run build --workspace=server

# Runtime stage
FROM node:20-alpine
WORKDIR /app

# Copy compiled output
COPY --from=builder /app/server/dist/ dist/

# Copy only the ws runtime dependency
COPY --from=builder /app/node_modules/ws/ node_modules/ws/
COPY --from=builder /app/node_modules/ws/package.json node_modules/ws/package.json

EXPOSE 8080
ENV PORT=8080

CMD ["node", "dist/index.js"]
