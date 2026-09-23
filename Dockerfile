FROM node:24-bookworm-slim AS web
WORKDIR /web

COPY web/package.json web/package-lock.json ./
RUN npm ci

COPY web/ ./
RUN mkdir -p public && npm run build

FROM golang:1.27-alpine AS build
WORKDIR /src

COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download

COPY cmd/ ./cmd/
COPY internal/ ./internal/
COPY web/embed.go ./web/
COPY --from=web /web/out ./web/out

ARG VERSION=""
ARG TARGETARCH
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=linux GOARCH=${TARGETARCH:-amd64} \
    go build -trimpath \
      -ldflags "-s -w${VERSION:+ -X main.version=$VERSION}" \
      -o /out/api ./cmd/api

FROM alpine:3.22 AS runtime

RUN apk add --no-cache ca-certificates tzdata && \
    adduser -D -u 10001 -h /app rocket

WORKDIR /app
COPY --from=build /out/api /usr/local/bin/

ENV ROCKET_ADDR=:8080

USER rocket
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/api/healthz >/dev/null || exit 1

ENTRYPOINT ["api"]
