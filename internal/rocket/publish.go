package rocket

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/JoakimCarlsson/rocket/internal/physics"
)

// Publish stores a player's rocket on Explore and returns it as stored. It
// reports an error wrapping [ErrInvalid] when the draft breaks a limit.
func Publish(
	ctx context.Context,
	store *Store,
	userID string,
	d Draft,
) (Rocket, error) {
	d.Name = strings.TrimSpace(d.Name)
	d.Prompt = strings.TrimSpace(d.Prompt)
	if err := d.check(); err != nil {
		return Rocket{}, err
	}
	return store.Insert(ctx, userID, d)
}

// Feed returns the page of rockets published before the one named by
// before, newest first, or the newest page when before is empty. viewerID
// may be empty for an anonymous viewer.
func Feed(
	ctx context.Context,
	store *Store,
	viewerID, before string,
	limit int,
) (Page, error) {
	if before != "" && !validID(before) {
		return Page{}, fmt.Errorf("%w: cursor is not a rocket id", ErrInvalid)
	}
	if limit <= 0 {
		limit = DefaultPageSize
	}
	limit = min(limit, MaxPageSize)

	rockets, err := store.Page(ctx, viewerID, before, limit+1)
	if err != nil {
		return Page{}, err
	}
	if len(rockets) <= limit {
		return Page{Rockets: rockets}, nil
	}
	rockets = rockets[:limit]
	return Page{Rockets: rockets, Next: rockets[limit-1].ID}, nil
}

// Get returns one rocket as viewerID sees it, reporting [ErrNotFound] when
// there is none with that id.
func Get(
	ctx context.Context,
	store *Store,
	viewerID, id string,
) (Rocket, error) {
	if !validID(id) {
		return Rocket{}, ErrNotFound
	}
	return store.Get(ctx, viewerID, id)
}

// SetLiked records whether userID likes the rocket and returns how many
// likes it now has. Liking twice or unliking twice is not an error: the
// outcome is what the caller asked for.
func SetLiked(
	ctx context.Context,
	store *Store,
	userID, id string,
	liked bool,
) (int, error) {
	if !validID(id) {
		return 0, ErrNotFound
	}
	if liked {
		return store.Like(ctx, userID, id)
	}
	return store.Unlike(ctx, userID, id)
}

// check rejects a draft that breaks a limit.
func (d Draft) check() error {
	switch n := utf8.RuneCountInString(d.Name); {
	case n == 0:
		return fmt.Errorf("%w: name is empty", ErrInvalid)
	case n > MaxNameLength:
		return fmt.Errorf(
			"%w: name is over %d characters", ErrInvalid, MaxNameLength)
	}
	if utf8.RuneCountInString(d.Prompt) > MaxPromptLength {
		return fmt.Errorf(
			"%w: prompt is over %d characters", ErrInvalid, MaxPromptLength)
	}
	if len(d.Config) == 0 {
		return fmt.Errorf("%w: config is empty", ErrInvalid)
	}
	raw, err := json.Marshal(d.Config)
	if err != nil {
		return fmt.Errorf("%w: config is not JSON", ErrInvalid)
	}
	if len(raw) > MaxConfigBytes {
		return fmt.Errorf(
			"%w: config is over %d bytes", ErrInvalid, MaxConfigBytes)
	}
	if _, err := physics.ParseRocket(raw); err != nil {
		return fmt.Errorf("%w: config is not a rocket: %w", ErrInvalid, err)
	}
	return nil
}
