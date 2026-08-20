# --- web UI ---
FROM node:22-bookworm-slim AS web
WORKDIR /src/apps/web
COPY apps/web/package.json apps/web/package-lock.json ./
RUN npm ci
COPY apps/web/ ./
RUN npm run build

# --- Go binary ---
FROM golang:1.25-bookworm AS go
WORKDIR /src/backend/api
COPY backend/api/go.mod backend/api/go.sum ./
RUN go mod download
COPY backend/api/cmd/ ./cmd/
COPY backend/api/internal/ ./internal/
RUN CGO_ENABLED=0 go build -o /terra ./cmd/terra

# --- runtime ---
FROM debian:bookworm-slim
RUN apt-get update \
	&& apt-get install -y --no-install-recommends ca-certificates curl docker.io \
	&& rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=go /terra /app/terra
COPY --from=web /src/apps/web/dist /app/apps/web/dist
# hook.js for NODE_OPTIONS --require inside sibling preview containers
COPY --from=go /src/backend/api/internal/preview/hook.js /app/backend/api/internal/preview/hook.js
RUN mkdir -p /data/checkouts
EXPOSE 8080
VOLUME ["/data"]
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
	CMD curl -sf http://127.0.0.1:8080/healthz || exit 1
ENTRYPOINT ["/app/terra", "serve", "--addr", "0.0.0.0:8080", "--db", "/data/terra.db", "--static", "/app/apps/web/dist"]
