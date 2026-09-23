package schema

import (
	"context"
	"embed"
	"errors"
	"fmt"
	"io/fs"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/tern/v2/migrate"
)

// migrationFiles holds the migrations as written. The pattern takes
// only the SQL; tern.conf sits alongside them for authoring with the
// tern CLI and has no business being compiled in.
//
//go:embed migrations/*.sql
var migrationFiles embed.FS

// versionTable is the tern CLI default, and so the table the dev and
// prod databases already track their version in. Any other name reads
// as version 0 and re-runs 001 against live tables.
const versionTable = "public.schema_version"

// currentQuery reads the applied version. The table name is a
// constant, not input.
const currentQuery = "select version from " + versionTable

// undefinedTable is what Postgres returns for a missing relation.
const undefinedTable = "42P01"

// expected is resolved once: the migrations are compiled in, so a
// broken set is a build mistake rather than a runtime condition.
var expected = highest()

// ErrMismatch reports a schema this binary cannot run against, in
// either direction.
type ErrMismatch struct {
	Database int32
	Binary   int32
}

func (e ErrMismatch) Error() string {
	if e.Database < e.Binary {
		return fmt.Sprintf(
			"database schema is at version %d but this binary expects "+
				"%d; run the migrate step before starting",
			e.Database,
			e.Binary,
		)
	}
	return fmt.Sprintf(
		"database schema is at version %d, ahead of the %d this "+
			"binary expects; deploy the matching build",
		e.Database,
		e.Binary,
	)
}

// Expected returns the version the embedded migrations add up to.
func Expected() int32 { return expected }

// Migrate applies every migration the database is missing. tern takes
// an advisory lock for the duration, so concurrent callers queue
// rather than collide.
func Migrate(ctx context.Context, pool *pgxpool.Pool) error {
	conn, err := pool.Acquire(ctx)
	if err != nil {
		return fmt.Errorf("acquiring a connection: %w", err)
	}
	defer conn.Release()

	m, err := migrate.NewMigrator(ctx, conn.Conn(), versionTable)
	if err != nil {
		return fmt.Errorf("preparing the migrator: %w", err)
	}
	if err := m.LoadMigrations(migrations()); err != nil {
		return fmt.Errorf("loading migrations: %w", err)
	}
	if err := m.Migrate(ctx); err != nil {
		return fmt.Errorf("applying migrations: %w", err)
	}
	return nil
}

// Verify reports whether the database matches what this binary was
// built against. It is one read and takes no lock, so every replica
// can afford it at startup.
func Verify(ctx context.Context, pool *pgxpool.Pool) error {
	have, err := Current(ctx, pool)
	if err != nil {
		return err
	}
	if have != Expected() {
		return ErrMismatch{Database: have, Binary: Expected()}
	}
	return nil
}

// Current reads the applied schema version. A database without the
// version table reports 0 — what a fresh database looks like before
// the migrate step has run.
func Current(ctx context.Context, pool *pgxpool.Pool) (int32, error) {
	var version int32
	err := pool.QueryRow(ctx, currentQuery).Scan(&version)

	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == undefinedTable {
		return 0, nil
	}
	if err != nil {
		return 0, fmt.Errorf("reading %s: %w", versionTable, err)
	}
	return version, nil
}

// migrations is the embedded SQL rooted where tern expects it —
// FindMigrations reads the root of the FS it is given.
func migrations() fs.FS {
	sub, err := fs.Sub(migrationFiles, "migrations")
	if err != nil {
		panic("schema: embedded migrations: " + err.Error())
	}
	return sub
}

// highest returns the largest sequence number among the embedded
// migrations.
func highest() int32 {
	names, err := migrate.FindMigrations(migrations())
	if err != nil {
		panic("schema: finding embedded migrations: " + err.Error())
	}
	if len(names) == 0 {
		panic("schema: no embedded migrations")
	}

	var top int32
	for _, name := range names {
		seq, err := sequence(name)
		if err != nil {
			panic("schema: " + err.Error())
		}
		if seq > top {
			top = seq
		}
	}
	return top
}

// sequence reads the leading number off a migration filename.
func sequence(name string) (int32, error) {
	digits, _, found := strings.Cut(name, "_")
	if !found {
		return 0, fmt.Errorf("migration %q has no sequence prefix", name)
	}
	seq, err := strconv.ParseInt(digits, 10, 32)
	if err != nil {
		return 0, fmt.Errorf("migration %q: %w", name, err)
	}
	return int32(seq), nil
}
