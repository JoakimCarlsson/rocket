package rocket

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// foreignKeyViolation is what Postgres returns for a like on a rocket that
// does not exist.
const foreignKeyViolation = "23503"

// selectRocket reads one rocket with its creator's name and whether the
// viewer in $1 likes it. Callers append the FROM clause's conditions.
const selectRocket = `
	SELECT r.id::text, r.user_id::text, u.name, r.name, r.prompt, r.config,
	       r.likes, r.created_at,
	       EXISTS (
	           SELECT 1 FROM rocket_likes l
	           WHERE l.rocket_id = r.id AND l.user_id = $1::uuid
	       )
	FROM rockets r
	JOIN users u ON u.id = r.user_id
`

// Store reads and writes published rockets and the likes on them.
type Store struct {
	pool *pgxpool.Pool
}

// NewStore returns a store over pool.
func NewStore(pool *pgxpool.Pool) *Store {
	return &Store{pool: pool}
}

// Insert stores a draft under userID and returns it as stored.
func (s *Store) Insert(
	ctx context.Context,
	userID string,
	d Draft,
) (Rocket, error) {
	var id string
	err := s.pool.QueryRow(ctx, `
		INSERT INTO rockets (user_id, name, prompt, config)
		VALUES ($1, $2, $3, $4)
		RETURNING id::text
	`, userID, d.Name, d.Prompt, d.Config).Scan(&id)
	if err != nil {
		return Rocket{}, fmt.Errorf("insert: %w", err)
	}
	return s.Get(ctx, userID, id)
}

// Get returns one rocket as viewerID sees it, reporting [ErrNotFound] when
// there is none with that id.
func (s *Store) Get(
	ctx context.Context,
	viewerID, id string,
) (Rocket, error) {
	row := s.pool.QueryRow(ctx, selectRocket+`
		WHERE r.id = $2
	`, nullable(viewerID), id)
	out, err := scanRocket(row)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return Rocket{}, ErrNotFound
	case err != nil:
		return Rocket{}, fmt.Errorf("query: %w", err)
	}
	return out, nil
}

// Page returns up to limit rockets published before the one named by
// before, newest first. Ids are UUIDv7, so their order is publish order.
func (s *Store) Page(
	ctx context.Context,
	viewerID, before string,
	limit int,
) ([]Rocket, error) {
	rows, err := s.pool.Query(ctx, selectRocket+`
		WHERE $2::uuid IS NULL OR r.id < $2::uuid
		ORDER BY r.id DESC
		LIMIT $3
	`, nullable(viewerID), nullable(before), limit)
	if err != nil {
		return nil, fmt.Errorf("query: %w", err)
	}
	defer rows.Close()

	out := []Rocket{}
	for rows.Next() {
		r, err := scanRocket(rows)
		if err != nil {
			return nil, fmt.Errorf("scan: %w", err)
		}
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("rows: %w", err)
	}
	return out, nil
}

// Like records that userID likes the rocket and returns its like count.
// The like and the count change in one statement, so they cannot drift.
func (s *Store) Like(ctx context.Context, userID, id string) (int, error) {
	return s.countLikes(ctx, `
		WITH changed AS (
			INSERT INTO rocket_likes (user_id, rocket_id)
			VALUES ($1, $2)
			ON CONFLICT DO NOTHING
			RETURNING rocket_id
		)
		UPDATE rockets
		SET likes = likes + (SELECT count(*) FROM changed)
		WHERE id = $2
		RETURNING likes
	`, userID, id)
}

// Unlike removes userID's like from the rocket and returns its like count.
func (s *Store) Unlike(ctx context.Context, userID, id string) (int, error) {
	return s.countLikes(ctx, `
		WITH changed AS (
			DELETE FROM rocket_likes
			WHERE user_id = $1 AND rocket_id = $2
			RETURNING rocket_id
		)
		UPDATE rockets
		SET likes = likes - (SELECT count(*) FROM changed)
		WHERE id = $2
		RETURNING likes
	`, userID, id)
}

// countLikes runs a statement that changes one user's like and returns the
// rocket's like count, reporting [ErrNotFound] when the rocket is gone.
func (s *Store) countLikes(
	ctx context.Context,
	query, userID, id string,
) (int, error) {
	var likes int
	err := s.pool.QueryRow(ctx, query, userID, id).Scan(&likes)

	var pgErr *pgconn.PgError
	switch {
	case errors.Is(err, pgx.ErrNoRows),
		errors.As(err, &pgErr) && pgErr.Code == foreignKeyViolation:
		return 0, ErrNotFound
	case err != nil:
		return 0, fmt.Errorf("update: %w", err)
	}
	return likes, nil
}

// scanRocket reads one row shaped by selectRocket.
func scanRocket(row pgx.Row) (Rocket, error) {
	var r Rocket
	err := row.Scan(
		&r.ID, &r.UserID, &r.Creator, &r.Name, &r.Prompt, &r.Config,
		&r.Likes, &r.CreatedAt, &r.Liked,
	)
	return r, err
}

// nullable maps an empty id to SQL NULL, which is what an anonymous viewer
// or the absence of a cursor is.
func nullable(id string) any {
	if id == "" {
		return nil
	}
	return id
}
