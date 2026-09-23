package account

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Store reads and writes users and the sessions under them.
type Store struct {
	pool *pgxpool.Pool
}

// NewStore returns a store over pool.
func NewStore(pool *pgxpool.Pool) *Store {
	return &Store{pool: pool}
}

// SignIn records what the provider asserted and opens a session against it,
// returning the user as stored. The user is created on a first sign-in and
// refreshed on every later one, since a name or picture can change at the
// provider. Both writes are one statement, so a session can never outlive the
// user row it points at.
func (s *Store) SignIn(
	ctx context.Context,
	id Identity,
	tokenHash []byte,
	expiresAt time.Time,
) (User, error) {
	out := User{GoogleSub: id.Sub}
	err := s.pool.QueryRow(ctx, `
		WITH upserted AS (
			INSERT INTO users (google_sub, email, name, picture_url)
			VALUES ($1, $2, $3, $4)
			ON CONFLICT (google_sub) DO UPDATE
				SET email       = excluded.email,
				    name        = excluded.name,
				    picture_url = excluded.picture_url
			RETURNING id, email, name, picture_url, created_at
		), opened AS (
			INSERT INTO sessions (user_id, token_hash, expires_at)
			SELECT id, $5, $6 FROM upserted
		)
		SELECT id::text, email, name, picture_url, created_at
		FROM upserted
	`,
		id.Sub, id.Email, id.Name, id.PictureURL, tokenHash, expiresAt,
	).Scan(
		&out.ID, &out.Email, &out.Name, &out.PictureURL, &out.CreatedAt,
	)
	if err != nil {
		return User{}, fmt.Errorf("insert: %w", err)
	}
	return out, nil
}

// UserForSession returns the user behind a live session token. It reports
// [ErrNotFound] for a token that is unknown or expired, which are the same
// answer to the caller: not signed in. This runs on every authenticated
// request.
func (s *Store) UserForSession(
	ctx context.Context,
	tokenHash []byte,
) (User, error) {
	var out User
	err := s.pool.QueryRow(ctx, `
		SELECT u.id::text, u.google_sub, u.email, u.name, u.picture_url,
		       u.created_at
		FROM sessions s
		JOIN users u ON u.id = s.user_id
		WHERE s.token_hash = $1
		  AND s.expires_at > now()
	`, tokenHash).Scan(
		&out.ID, &out.GoogleSub, &out.Email, &out.Name, &out.PictureURL,
		&out.CreatedAt,
	)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return User{}, ErrNotFound
	case err != nil:
		return User{}, fmt.Errorf("query: %w", err)
	}
	return out, nil
}

// DeleteSession ends one session. A token that is already gone is not an
// error: signing out twice has the outcome the caller asked for.
func (s *Store) DeleteSession(ctx context.Context, tokenHash []byte) error {
	_, err := s.pool.Exec(ctx, `
		DELETE FROM sessions
		WHERE token_hash = $1
	`, tokenHash)
	if err != nil {
		return fmt.Errorf("delete: %w", err)
	}
	return nil
}
