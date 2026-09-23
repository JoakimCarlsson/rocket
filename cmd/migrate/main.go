// Command migrate applies the database schema and exits. It runs as its own
// deploy step, before the new API image rolls; a non-zero exit is what stops
// that deploy.
package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/JoakimCarlsson/rocket/internal/config"
	"github.com/JoakimCarlsson/rocket/internal/schema"
	"github.com/jackc/pgx/v5/pgxpool"
)

func main() {
	if err := run(); err != nil {
		slog.Error("migrate failed", "error", err)
		os.Exit(1)
	}
}

// run connects, applies whatever migrations are missing and reports the
// version the database moved between.
func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	ctx, stop := signal.NotifyContext(
		context.Background(),
		syscall.SIGINT,
		syscall.SIGTERM,
	)
	defer stop()

	pool, err := pgxpool.New(ctx, cfg.Postgres.URL())
	if err != nil {
		return fmt.Errorf("connecting to postgres: %w", err)
	}
	defer pool.Close()
	if err := pool.Ping(ctx); err != nil {
		return fmt.Errorf("pinging postgres: %w", err)
	}

	before, err := schema.Current(ctx, pool)
	if err != nil {
		return err
	}
	if err := schema.Migrate(ctx, pool); err != nil {
		return err
	}

	after, err := schema.Current(ctx, pool)
	if err != nil {
		return err
	}
	if before == after {
		slog.InfoContext(ctx, "schema already current", "version", after)
		return nil
	}
	slog.InfoContext(ctx, "schema migrated", "from", before, "to", after)
	return nil
}
