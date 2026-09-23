ifeq ($(OS),Windows_NT)
EXT := .exe
else
EXT :=
endif

GOBIN := $(subst \,/,$(shell go env GOPATH))/bin

ifneq (,$(wildcard .env))
include .env
export
endif

.PHONY: run fmt lint up down migrate

GOPKGS := $(shell go list -f '{{.Dir}}' ./...)

fmt:
	$(GOBIN)/golines -m 80 --base-formatter=$(GOBIN)/goimports -w $(GOPKGS)
	cd web && npm run fmt

lint:
	go vet ./...
	$(GOBIN)/golangci-lint run ./...
	cd web && npm run lint

up:
	docker compose up -d --wait postgres

down:
	docker compose down

migrate:
	go run ./cmd/migrate

AIR := $(GOBIN)/air --build.cmd "go build -o ./tmp/api$(EXT) ./cmd/api" --build.bin "./tmp/api$(EXT)"

ifeq ($(OS),Windows_NT)
run: up migrate
	-@(for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3000 ^| findstr LISTENING') do @taskkill /F /PID %%a >NUL 2>&1) & exit /b 0
	-@(for /f "tokens=5" %%a in ('netstat -aon ^| findstr :8080 ^| findstr LISTENING') do @taskkill /F /PID %%a >NUL 2>&1) & exit /b 0
	start /B $(AIR)
	cd web && npm install && npm run dev
else
run: up migrate
	-@lsof -ti tcp:3000 | xargs -r kill -9 2>/dev/null || true
	-@lsof -ti tcp:8080 | xargs -r kill -9 2>/dev/null || true
	@trap 'kill 0' INT TERM EXIT; \
	$(AIR) & \
	(cd web && npm install && npm run dev) & \
	wait
endif
