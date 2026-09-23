package account

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"time"
)

// SessionTTL is how long a session lives before the player signs in again.
const SessionTTL = 30 * 24 * time.Hour

// tokenBytes is the entropy behind a session token.
const tokenBytes = 32

// ErrNotFound is returned when no user or session matches.
var ErrNotFound = errors.New("not found")

// ErrUnverifiedEmail is returned for an identity whose provider has not
// verified the address. A person is keyed on that address, so an unverified
// one is refused.
var ErrUnverifiedEmail = errors.New("email not verified")

// ErrBadEmail is returned when an address is not one.
var ErrBadEmail = errors.New("email must be an address")

// User is one signed-in player, as Google describes them.
type User struct {
	ID         string
	GoogleSub  string
	Email      string
	Name       string
	PictureURL string
	CreatedAt  time.Time
}

// Session is a session that has just been opened: the raw token to hand to
// the browser, and when it stops being accepted. Only [HashToken] of the
// token is stored.
type Session struct {
	Token     string
	ExpiresAt time.Time
}

// Identity is what a provider asserts about someone who has just signed in.
// It is deliberately provider-neutral: a second provider fills the same shape.
type Identity struct {
	Sub        string
	Email      string
	Name       string
	PictureURL string
}

// NewToken returns a fresh session token. The caller hands it to the browser
// and stores only [HashToken] of it.
func NewToken() (string, error) {
	buf := make([]byte, tokenBytes)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("reading random bytes: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

// HashToken returns the digest a token is stored and looked up by, so that a
// dump of the sessions table hands over no live session.
func HashToken(token string) []byte {
	sum := sha256.Sum256([]byte(token))
	return sum[:]
}
