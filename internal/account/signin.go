package account

import (
	"context"
	"fmt"
	"strings"
	"time"
)

// devSubPrefix stands in for the provider subject a real sign-in would carry.
// Prefixing it keeps a developer-issued user from ever colliding with the
// Google account of the same address, and makes the rows obvious in a dump.
const devSubPrefix = "dev:"

// defaultDevEmail is who a development identity belongs to when the caller
// names nobody.
const defaultDevEmail = "dev@localhost"

// SignIn records what a provider asserted and opens a session against it,
// returning the user as stored and the session to hand to the browser.
//
// The token is minted here and stored only as [HashToken] of it, so the
// caller is the only one who ever holds the live credential.
func SignIn(
	ctx context.Context,
	store *Store,
	id Identity,
) (User, Session, error) {
	raw, err := NewToken()
	if err != nil {
		return User{}, Session{}, err
	}

	session := Session{
		Token:     raw,
		ExpiresAt: time.Now().Add(SessionTTL),
	}
	user, err := store.SignIn(
		ctx, id, HashToken(raw), session.ExpiresAt,
	)
	if err != nil {
		return User{}, Session{}, fmt.Errorf("signing in: %w", err)
	}
	return user, session, nil
}

// DevIdentity is the identity a local sign-in bypass signs in as: the address
// the caller named, or [defaultDevEmail], under a subject no real provider
// can issue. It reports [ErrBadEmail] when the address is not one, and names
// the identity after the local part when the caller gave no name.
func DevIdentity(email, name string) (Identity, error) {
	email = strings.TrimSpace(email)
	if email == "" {
		email = defaultDevEmail
	}
	local, _, ok := strings.Cut(email, "@")
	if !ok || local == "" {
		return Identity{}, ErrBadEmail
	}

	name = strings.TrimSpace(name)
	if name == "" {
		name = local
	}
	return Identity{
		Sub:   devSubPrefix + email,
		Email: email,
		Name:  name,
	}, nil
}
